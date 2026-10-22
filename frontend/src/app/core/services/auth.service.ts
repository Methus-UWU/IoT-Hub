import { DOCUMENT } from '@angular/common';
import { Service, computed, effect, inject, signal } from '@angular/core';
import { Observable, defer, from, map, switchMap, tap, throwError } from 'rxjs';
import type { Session } from '@supabase/supabase-js';

import { CrudService } from './crud.service';
import { SupabaseClientService } from './supabase-client.service';

export type OAuthProvider = 'google' | 'github';
const DISPLAY_NAME_CACHE_KEY = 'iot-hub:account-display';
interface CachedAccountDisplay {
  username: string;
  displayName: string | null;
}

export interface LoginPayload {
  email: string;
  password: string;
}

export interface RegisterPayload {
  username: string;
  email: string;
  password: string;
}

/** The application profile, owned by the API rather than by Supabase. */
export interface AuthUser {
  id: string;
  username: string;
  displayName?: string | null;
  bio?: string | null;
  email: string;
  isActive: boolean;
  role: { name: string };
}

export interface UpdateProfilePayload {
  username: string;
  displayName: string;
  bio: string;
}

/** One sign-in, as recorded by the API from the request that reported it. */
export interface LoginEvent {
  id: string;
  ipAddress: string;
  userAgent: string;
  createdAt: string;
}

export interface ChangePasswordPayload {
  currentPassword: string;
  newPassword: string;
}

/**
 * Authentication is Supabase Auth; authorization is the API.
 *
 * This service no longer issues, stores, or refreshes tokens. Supabase owns the
 * session — including refresh, email verification, password reset, and the OAuth
 * redirect flow — and the API is asked only for the application profile.
 *
 * The role on `currentUser` is for shaping the UI. It is not a security boundary:
 * every protected action is authorized again by NestJS against the database.
 */
@Service()
export class AuthService {
  private readonly supabase = inject(SupabaseClientService);
  private readonly crud = inject(CrudService);
  private readonly document = inject(DOCUMENT);

  private readonly sessionState = signal<Session | null>(null);
  private readonly currentUserState = signal<AuthUser | null>(null);
  private readonly sessionReady = signal(false);
  private readonly cachedDisplay = signal<CachedAccountDisplay | null>(null);
  private readonly profileFailed = signal(false);
  private readonly credentialSession = signal<{
    token: string;
    password: boolean;
    oauth: boolean;
  } | null>(null);
  private listening = false;
  /** Last sign-in reported, as `userId:last_sign_in_at`, so each is sent once. */
  private reportedSignIn: string | null = null;

  private readonly authEndpoint = this.crud.resource<AuthUser>('auth');
  private readonly loginEvents = this.crud.resource<LoginEvent, Record<string, never>>(
    'auth/login-events',
  );

  readonly isAuthenticated = computed(() => this.sessionState() !== null);
  /** Known as soon as the session is restored, before the API profile arrives. */
  readonly sessionUserId = computed(() => this.sessionState()?.user.id ?? null);
  readonly currentUser = this.currentUserState.asReadonly();
  readonly accountEmail = computed(
    () => this.sessionState()?.user.email ?? this.currentUser()?.email ?? '',
  );
  readonly pendingEmail = computed(() => this.sessionState()?.user.new_email ?? '');
  /** Product UI policy only. Supabase remains the authority for credential writes. */
  readonly credentialSettingsReady = computed(() =>
    Boolean(
      this.sessionState() && this.credentialSession()?.token === this.sessionState()?.access_token,
    ),
  );
  readonly canEditCredentials = computed(
    () => this.credentialSettingsReady() && this.credentialSession()?.password === true,
  );
  readonly usesExternalLogin = computed(
    () => this.credentialSettingsReady() && this.credentialSession()?.oauth === true,
  );

  constructor() {
    // Supabase signs in inside the browser, so the API learns of a sign-in only when
    // told. The API keys the record by the verified session and reads address and
    // device from the request; this call carries no data of its own. Best effort:
    // failing to record history must never block the user.
    effect(() => {
      const user = this.sessionState()?.user;
      const key = user ? `${user.id}:${user.last_sign_in_at ?? ''}` : null;
      if (!key || key === this.reportedSignIn) return;
      this.reportedSignIn = key;
      this.loginEvents.create({}).subscribe({ error: () => undefined });
    });

    effect(() => {
      const token = this.sessionState()?.access_token;
      if (!token) {
        this.credentialSession.set(null);
        return;
      }
      // Outside onAuthStateChange: calling the SDK inside its callback can deadlock.
      void this.readCredentialSession(token).then((state) => {
        if (this.sessionState()?.access_token === token) this.credentialSession.set(state);
      });
    });
  }

  private async readCredentialSession(token: string) {
    try {
      const { data, error } = await this.supabase.client.auth.mfa.getAuthenticatorAssuranceLevel();
      const methods =
        data?.currentAuthenticationMethods.map((entry) =>
          typeof entry === 'string' ? entry : entry.method,
        ) ?? [];
      const oauth = methods.includes('oauth');
      return { token, password: !error && methods.includes('password') && !oauth, oauth };
    } catch {
      return { token, password: false, oauth: false };
    }
  }

  private async requirePasswordSession(): Promise<void> {
    const token = this.sessionState()?.access_token;
    if (!token) throw new Error('No active session');
    const state = await this.readCredentialSession(token);
    if (!state.password || this.sessionState()?.access_token !== token) {
      throw new Error('PASSWORD_SIGN_IN_REQUIRED');
    }
  }
  /** Presentation only: cached names never populate the authorized profile. */
  readonly displayUsername = computed(
    () => this.currentUser()?.username ?? this.cachedDisplay()?.username ?? null,
  );
  readonly accountDisplayName = computed(() => {
    const user = this.currentUser();
    return user
      ? user.displayName || user.username
      : this.cachedDisplay()?.displayName || this.displayUsername();
  });
  readonly identityLoading = computed(
    () =>
      !this.sessionReady() ||
      (this.isAuthenticated() && !this.displayUsername() && !this.profileFailed()),
  );

  /**
   * Restores a persisted session and keeps the signal in step with Supabase.
   *
   * Called by the route guards rather than in a constructor, so the first
   * navigation waits for a real answer instead of racing an unresolved session.
   */
  restoreSession(): Observable<Session | null> {
    this.startListening();

    return from(this.supabase.client.auth.getSession()).pipe(
      map(({ data }) => data.session),
      tap({
        next: (session) => this.applySession(session),
        error: () => this.sessionReady.set(true),
      }),
    );
  }

  private startListening(): void {
    if (this.listening) return;
    this.listening = true;

    this.supabase.client.auth.onAuthStateChange((_event, session) => {
      this.applySession(session);
    });
  }

  loginWithPassword(payload: LoginPayload): Observable<Session> {
    return from(
      this.supabase.client.auth.signInWithPassword({
        email: payload.email.trim().toLowerCase(),
        password: payload.password,
      }),
    ).pipe(
      map(({ data, error }) => {
        if (error || !data.session) {
          throw new Error(error?.message ?? 'Sign-in failed');
        }
        return data.session;
      }),
      tap((session) => this.applySession(session)),
    );
  }

  /**
   * Starts an OAuth redirect. The browser leaves the application here, so nothing
   * after this emits; the session is picked up by `detectSessionInUrl` on return.
   */
  loginWithProvider(provider: OAuthProvider): Observable<void> {
    return from(
      this.supabase.client.auth.signInWithOAuth({
        provider,
        options: { redirectTo: `${window.location.origin}/auth/callback` },
      }),
    ).pipe(
      map(({ error }) => {
        if (error) throw new Error(error.message);
      }),
    );
  }

  /**
   * Registers through Supabase. The username is passed as user metadata, where the
   * database sign-up trigger reads it when creating the profile row.
   */
  register(payload: RegisterPayload): Observable<void> {
    return from(
      this.supabase.client.auth.signUp({
        email: payload.email.trim().toLowerCase(),
        password: payload.password,
        options: {
          data: { user_name: payload.username.trim() },
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      }),
    ).pipe(
      map(({ error }) => {
        if (error) throw new Error(error.message);
      }),
    );
  }

  requestPasswordReset(email: string): Observable<void> {
    return from(
      this.supabase.client.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
        redirectTo: `${window.location.origin}/auth/reset-password`,
      }),
    ).pipe(
      map(({ error }) => {
        if (error) throw new Error(error.message);
      }),
    );
  }

  /**
   * Changes the password, proving current ownership first.
   *
   * Supabase's updateUser() accepts a new password on the strength of the session
   * alone, so a hijacked session could silently take over the account. Re-signing
   * in with the current password closes that: it is a genuine check, not a
   * cosmetic form field. OAuth sessions manage credentials with their provider.
   */
  changePassword(payload: ChangePasswordPayload): Observable<void> {
    const email = this.sessionState()?.user.email;
    if (!email) {
      return throwError(() => new Error('No active session'));
    }

    return defer(() => this.requirePasswordSession()).pipe(
      switchMap(() =>
        this.supabase.client.auth.signInWithPassword({
          email,
          password: payload.currentPassword,
        }),
      ),
      switchMap(({ error }) => {
        if (error) throw new Error('CURRENT_PASSWORD_INVALID');
        return this.updatePassword(payload.newPassword);
      }),
    );
  }

  updatePassword(newPassword: string): Observable<void> {
    return defer(() => this.requirePasswordSession()).pipe(
      switchMap(() => this.supabase.client.auth.updateUser({ password: newPassword })),
      map(({ error }) => {
        if (error) throw new Error(error.message);
      }),
    );
  }

  /** Supabase verifies address changes; the profile API never accepts an email. */
  changeEmail(email: string): Observable<void> {
    return defer(() => this.requirePasswordSession()).pipe(
      switchMap(() =>
        this.supabase.client.auth.updateUser(
          { email: email.trim().toLowerCase() },
          { emailRedirectTo: `${this.document.location.origin}/auth/callback` },
        ),
      ),
      map(({ data, error }) => {
        if (error) throw error;
        const session = this.sessionState();
        if (session && data.user?.id === session.user.id) {
          this.applySession({ ...session, user: data.user });
        }
      }),
    );
  }

  getCurrentUser(): Observable<AuthUser> {
    return defer(() => {
      const userId = this.sessionState()?.user.id;
      this.profileFailed.set(false);
      return this.authEndpoint.get('me').pipe(
        tap({
          next: (user) => this.acceptProfile(user, userId),
          error: () => {
            if (this.sessionState()?.user.id === userId) this.profileFailed.set(true);
          },
        }),
      );
    });
  }

  updateCurrentUser(payload: UpdateProfilePayload): Observable<AuthUser> {
    return defer(() => {
      const userId = this.sessionState()?.user.id;
      return this.authEndpoint
        .patch<AuthUser, UpdateProfilePayload>('me', payload)
        .pipe(tap((user) => this.acceptProfile(user, userId)));
    });
  }

  /** The signed-in user's own sign-in history, newest first. */
  listLoginHistory(): Observable<LoginEvent[]> {
    return this.loginEvents.list();
  }

  logout(): Observable<void> {
    return from(this.supabase.client.auth.signOut()).pipe(
      map(() => undefined),
      tap(() => {
        this.applySession(null);
      }),
    );
  }

  /** Current access token, or null. Supabase refreshes it in the background. */
  getAccessToken(): string | null {
    return this.sessionState()?.access_token ?? null;
  }

  /**
   * Forces a refresh and returns the new token. Used by the HTTP interceptor when
   * the API rejects a token that the client still believed was valid.
   */
  refreshAccessToken(): Observable<string> {
    return from(this.supabase.client.auth.refreshSession()).pipe(
      map(({ data, error }) => {
        // The Supabase error is rethrown as-is, so a caller can tell a network
        // fault from a refresh token Supabase actually rejected.
        if (error) throw error;
        if (!data.session) throw new Error('Session refresh failed');
        this.applySession(data.session);
        return data.session.access_token;
      }),
    );
  }

  clearSession(): void {
    this.applySession(null);
  }

  private applySession(session: Session | null): void {
    const userId = session?.user.id;
    if (userId !== this.sessionState()?.user.id || !session) {
      this.currentUserState.set(null);
      this.profileFailed.set(false);
      this.cachedDisplay.set(this.readCachedDisplay(userId));
    }
    this.sessionState.set(session);
    this.sessionReady.set(true);
  }

  private acceptProfile(user: AuthUser, requestedUserId: string | undefined): void {
    // A response from before logout/account switching cannot replace the new identity.
    if (
      !requestedUserId ||
      user.id !== requestedUserId ||
      this.sessionState()?.user.id !== requestedUserId
    )
      return;
    this.currentUserState.set(user);
    this.cachedDisplay.set({ username: user.username, displayName: user.displayName ?? null });
    this.profileFailed.set(false);
    try {
      this.document.defaultView?.sessionStorage.setItem(
        DISPLAY_NAME_CACHE_KEY,
        JSON.stringify({
          userId: user.id,
          username: user.username,
          ...(user.displayName ? { displayName: user.displayName } : {}),
        }),
      );
    } catch {
      // In-memory identity still works when browser storage is unavailable.
    }
  }

  private readCachedDisplay(userId: string | undefined): CachedAccountDisplay | null {
    try {
      const storage = this.document.defaultView?.sessionStorage;
      const cached: unknown = JSON.parse(storage?.getItem(DISPLAY_NAME_CACHE_KEY) ?? 'null');
      if (
        userId &&
        cached &&
        typeof cached === 'object' &&
        'userId' in cached &&
        cached.userId === userId &&
        'username' in cached &&
        typeof cached.username === 'string' &&
        cached.username.trim() &&
        cached.username.length <= 200
      ) {
        const displayName =
          'displayName' in cached &&
          typeof cached.displayName === 'string' &&
          cached.displayName.length <= 60
            ? cached.displayName.trim() || null
            : null;
        return { username: cached.username, displayName };
      }
      storage?.removeItem(DISPLAY_NAME_CACHE_KEY);
    } catch {
      // Corrupt or blocked storage falls back to loading the profile from the API.
    }
    return null;
  }
}
