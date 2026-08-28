import { Service, computed, inject, signal } from '@angular/core';
import { Observable, from, map, switchMap, tap, throwError } from 'rxjs';
import type { Session } from '@supabase/supabase-js';

import { CrudService } from './crud.service';
import { SupabaseClientService } from './supabase-client.service';

export type OAuthProvider = 'google' | 'github';

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
  email: string;
  isActive: boolean;
  role: { name: string };
}

export interface UpdateProfilePayload {
  username: string;
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

  private readonly sessionState = signal<Session | null>(null);
  private readonly currentUserState = signal<AuthUser | null>(null);
  private listening = false;

  private readonly authEndpoint = this.crud.resource<AuthUser>('auth');

  readonly isAuthenticated = computed(() => this.sessionState() !== null);
  readonly currentUser = this.currentUserState.asReadonly();

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
      tap((session) => {
        this.sessionState.set(session);
        if (!session) this.currentUserState.set(null);
      }),
    );
  }

  private startListening(): void {
    if (this.listening) return;
    this.listening = true;

    this.supabase.client.auth.onAuthStateChange((_event, session) => {
      this.sessionState.set(session);
      if (!session) this.currentUserState.set(null);
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
      tap((session) => this.sessionState.set(session)),
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
      this.supabase.client.auth.resetPasswordForEmail(
        email.trim().toLowerCase(),
        { redirectTo: `${window.location.origin}/auth/reset-password` },
      ),
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
   * cosmetic form field. An account created through Google or GitHub has no
   * password to verify, and is told to use the reset flow instead.
   */
  changePassword(payload: ChangePasswordPayload): Observable<void> {
    const email = this.sessionState()?.user.email;
    if (!email) {
      return throwError(() => new Error('No active session'));
    }

    return from(
      this.supabase.client.auth.signInWithPassword({
        email,
        password: payload.currentPassword,
      }),
    ).pipe(
      switchMap(({ error }) => {
        if (error) throw new Error('CURRENT_PASSWORD_INVALID');
        return this.updatePassword(payload.newPassword);
      }),
    );
  }

  updatePassword(newPassword: string): Observable<void> {
    return from(
      this.supabase.client.auth.updateUser({ password: newPassword }),
    ).pipe(
      map(({ error }) => {
        if (error) throw new Error(error.message);
      }),
    );
  }

  getCurrentUser(): Observable<AuthUser> {
    return this.authEndpoint
      .get('me')
      .pipe(tap((user) => this.currentUserState.set(user)));
  }

  updateCurrentUser(payload: UpdateProfilePayload): Observable<AuthUser> {
    return this.authEndpoint
      .patch<AuthUser, UpdateProfilePayload>('me', payload)
      .pipe(tap((user) => this.currentUserState.set(user)));
  }

  logout(): Observable<void> {
    return from(this.supabase.client.auth.signOut()).pipe(
      map(() => undefined),
      tap(() => {
        this.sessionState.set(null);
        this.currentUserState.set(null);
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
        if (error || !data.session) {
          throw new Error(error?.message ?? 'Session refresh failed');
        }
        this.sessionState.set(data.session);
        return data.session.access_token;
      }),
    );
  }

  clearSession(): void {
    this.sessionState.set(null);
    this.currentUserState.set(null);
  }
}
