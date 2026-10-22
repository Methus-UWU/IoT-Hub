# 02 · การเชื่อมต่อ Supabase

ระบบใช้ Supabase 3 ส่วน และแต่ละส่วนใช้ key ต่างกัน:

| ส่วน | ใครเรียก | Key ที่ใช้ |
| --- | --- | --- |
| Auth (login, session) | Browser โดยตรง | publishable key (เปิดเผยได้) |
| Postgres | NestJS ผ่าน Prisma | `DATABASE_URL` (ใน `backend/.env`) |
| Admin API + Storage | NestJS เท่านั้น | `SUPABASE_SECRET_KEY` (ห้ามไปถึง frontend) |

## 1. Login ฝั่ง Browser

[`supabase-client.service.ts`](../frontend/src/app/core/services/supabase-client.service.ts)

- บรรทัด 32–45: สร้าง `createClient(supabaseUrl, publishableKey)` ครั้งเดียวทั้งแอป
  - `persistSession: true` เก็บ session ใน browser storage
  - `autoRefreshToken: true` ให้ SDK refresh token ก่อนหมดอายุเอง
  - `flowType: 'pkce'` ใช้กับ OAuth login

[`auth.service.ts`](../frontend/src/app/core/services/auth.service.ts) — ฟังก์ชันหลัก:

| บรรทัด | ฟังก์ชัน | ทำอะไร |
| --- | --- | --- |
| 165 | `restoreSession()` | อ่าน session เดิมตอนเปิดแอป (`auth.getSession()`) |
| 177–181 | `startListening()` | `onAuthStateChange` ฟังทุกครั้งที่ session เปลี่ยน (login, refresh, logout) |
| 186 | `loginWithPassword()` | `signInWithPassword` |
| 207 | `loginWithProvider()` | `signInWithOAuth` (Google/GitHub) |
| 224 | `register()` | สมัครสมาชิก |
| 309 | `getCurrentUser()` | `GET /api/auth/me` ขอโปรไฟล์จาก backend |
| 348 | `getAccessToken()` | interceptor เรียกเพื่อแนบ Bearer token |
| 356 | `refreshAccessToken()` | `auth.refreshSession()` ใช้ตอนเจอ 401 |
| 338 | `logout()` | ออกจากระบบ |

หลัง login frontend จะเรียก `POST /api/auth/login-events` (บรรทัด 81) เพื่อบันทึกประวัติการเข้าสู่ระบบ

## 2. Backend ตรวจ token

[`supabase-auth.guard.ts`](../backend/src/modules/auth/supabase-auth.guard.ts)

```
canActivate (49)
 ├─ bearerToken(request)         อ่าน header Authorization
 ├─ verify(token) (80)
 │    └─ jwtVerify(token, JWKS, { issuer, audience: 'authenticated' })   (84)
 ├─ ปฏิเสธ anonymous session (67)
 └─ request.user = { id: sub, email, sessionId }   (71)
```

- JWKS URL มาจาก [`supabase.config.ts:52`](../backend/src/common/config/supabase.config.ts#L52) → `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`
- backend ไม่ถือ secret ที่ใช้เซ็น token จึงปลอม token ไม่ได้แม้ config รั่ว
- ถ้าดึง JWKS ไม่ได้จะตอบ 503 ไม่ใช่ 401 (บรรทัด 97) frontend จึงไม่สั่ง logout เพราะเน็ตกระตุก

Endpoint ของ auth อยู่ที่ [`auth.controller.ts`](../backend/src/modules/auth/auth.controller.ts):
`GET /auth/me` (41), `PATCH /auth/me` (47), `POST /auth/login-events` (60), `GET /auth/login-events` (71), `GET /auth/availability` (81)

## 3. ฐานข้อมูลผ่าน Prisma

[`prisma.service.ts`](../backend/src/prisma/prisma.service.ts)

- บรรทัด 15–18: `PrismaClient` ต่อ Postgres ผ่าน driver adapter `@prisma/adapter-pg`
- บรรทัด 31–50: อ่าน `DATABASE_URL` ถ้ามี `DATABASE_REPLICA_URL` จะส่ง query อ่านไป replica และเขียนไป primary
- บรรทัด 60: `prisma.db` คือ client ที่ repository ทุกตัวใช้

Schema มีที่เดียวคือ [`backend/prisma/schema.prisma`](../backend/prisma/schema.prisma) Prisma ดูแลเฉพาะ schema `public`
ส่วน schema `auth` เป็นของ Supabase และ Prisma จะไม่แตะ

ตอนสมัครสมาชิก trigger `on_auth_user_created` บน `auth.users` จะเรียก `public.handle_new_auth_user()`
([`migration.sql:195`](../backend/prisma/migrations/20260828000000_supabase_auth_and_workspaces/migration.sql#L195))
เพื่อสร้างแถว `public.users` และ workspace ส่วนตัวให้อัตโนมัติ

## 4. Admin API และ Storage (ใช้ secret key)

[`supabase-admin.service.ts`](../backend/src/modules/auth/supabase-admin.service.ts)

- บรรทัด 212–227: `requireClient()` สร้าง client ด้วย `SUPABASE_SECRET_KEY` และปิด session/refresh
- ใช้เมื่อ: ระงับบัญชี `setBanned` (38), สร้างผู้ใช้ `createUser` (61), ลบผู้ใช้ `deleteUser` (90),
  อ่านเวลา login ล่าสุด `listUserLastSignIns` (103), รูปโปรไฟล์ใน Storage `readAvatar/saveAvatar/removeAvatar` (145–188)

IP ของการเข้าสู่ระบบล่าสุดในหน้า admin อ่านจาก `auth.sessions` โดยตรง
([`prisma-sign-in-ip.repository.ts`](../backend/src/modules/auth/prisma-sign-in-ip.repository.ts)) เพราะ Admin API ไม่ส่ง IP มาให้

## โค้ดจริง

โค้ดด้านล่างคัดลอกจากไฟล์จริงตามเลขบรรทัดที่ระบุ ตัด comment ออกแล้ว ส่วนอื่นไม่ได้แก้

### สร้าง Supabase client ฝั่ง browser

[`supabase-client.service.ts:17–49`](../frontend/src/app/core/services/supabase-client.service.ts#L17)

```ts
@Service()
export class SupabaseClientService {
  private cached: SupabaseClient | null = null;

  get isConfigured(): boolean {
    return Boolean(environment.supabaseUrl && environment.supabasePublishableKey);
  }

  get client(): SupabaseClient {
    if (!this.isConfigured) {
      throw new Error(
        'Supabase is not configured. Set supabaseUrl and supabasePublishableKey in src/environments.',
      );
    }

    this.cached ??= createClient(
      environment.supabaseUrl,
      environment.supabasePublishableKey,
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          flowType: 'pkce',
        },
      },
    );

    return this.cached;
  }
}
```

### ฟังการเปลี่ยน session และ login ด้วยรหัสผ่าน

[`auth.service.ts:177–184`](../frontend/src/app/core/services/auth.service.ts#L177)

```ts
  private startListening(): void {
    if (this.listening) return;
    this.listening = true;

    this.supabase.client.auth.onAuthStateChange((_event, session) => {
      this.applySession(session);
    });
  }
```

[`auth.service.ts:186–201`](../frontend/src/app/core/services/auth.service.ts#L186)

```ts
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
```

### ให้ token กับ interceptor และ refresh เมื่อ 401

[`auth.service.ts:348–350`](../frontend/src/app/core/services/auth.service.ts#L348)

```ts
  getAccessToken(): string | null {
    return this.sessionState()?.access_token ?? null;
  }
```

[`auth.service.ts:356–367`](../frontend/src/app/core/services/auth.service.ts#L356)

```ts
  refreshAccessToken(): Observable<string> {
    return from(this.supabase.client.auth.refreshSession()).pipe(
      map(({ data, error }) => {
        if (error) throw error;
        if (!data.session) throw new Error('Session refresh failed');
        this.applySession(data.session);
        return data.session.access_token;
      }),
    );
  }
```

### Backend ตรวจ JWT ของ Supabase

[`supabase-auth.guard.ts:49–78`](../backend/src/modules/auth/supabase-auth.guard.ts#L49)

```ts
  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.config.canVerifyTokens) {
      throw new ServiceUnavailableException({
        code: 'AUTH_NOT_CONFIGURED',
        message: 'Authentication is not configured on this server',
      });
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = bearerToken(request);
    if (!token) throw new UnauthorizedException('Missing access token');

    const payload = await this.verify(token);

    if (!payload.sub) throw new UnauthorizedException('Invalid access token');
    if (payload.is_anonymous) {
      throw new UnauthorizedException('Anonymous sessions are not permitted');
    }

    request.user = {
      id: payload.sub,
      email: payload.email ?? '',
      sessionId: payload.session_id,
    };

    return true;
  }
```

### URL ของ JWKS และ issuer

[`supabase.config.ts:52–60`](../backend/src/common/config/supabase.config.ts#L52)

```ts
  get jwksUrl(): string {
    return `${this.url.replace(/\/$/, '')}/auth/v1/.well-known/jwks.json`;
  }

  get issuer(): string {
    return `${this.url.replace(/\/$/, '')}/auth/v1`;
  }
```

### Prisma ต่อ Postgres

[`prisma.service.ts:15–63`](../backend/src/prisma/prisma.service.ts#L15)

```ts
function createClient(connectionString: string): PrismaClient {
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

function createExtendedClient() {
  const primaryUrl = process.env.DATABASE_URL;
  if (!primaryUrl) {
    throw new Error('DATABASE_URL is not set');
  }

  const client = createClient(primaryUrl);

  const replicaUrl = process.env.DATABASE_REPLICA_URL;
  if (!replicaUrl) {
    return client;
  }

  return client.$extends(
    readReplicas({
      replicas: [createClient(replicaUrl)],
    }),
  );
}

type ExtendedPrismaClient = ReturnType<typeof createExtendedClient>;

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private readonly client: ExtendedPrismaClient = createExtendedClient();

  get db(): ExtendedPrismaClient {
    return this.client;
  }
```

### Client ที่ใช้ secret key (Admin API / Storage)

[`supabase-admin.service.ts:212–226`](../backend/src/modules/auth/supabase-admin.service.ts#L212)

```ts
  private requireClient(): SupabaseClient {
    if (!this.isAvailable) {
      throw new ServiceUnavailableException({
        code: 'SUPABASE_ADMIN_NOT_CONFIGURED',
        message:
          'Administrative identity operations require SUPABASE_SECRET_KEY to be configured',
      });
    }

    this.client ??= createClient(this.config.url, this.config.secretKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    return this.client;
  }
```

### ตัวอย่างใช้ Admin API: อ่านเวลา login ล่าสุด

[`supabase-admin.service.ts:103–129`](../backend/src/modules/auth/supabase-admin.service.ts#L103)

```ts
  async listUserLastSignIns(): Promise<ReadonlyMap<string, string | null>> {
    const client = this.requireClient();
    const lastSignIns = new Map<string, string | null>();
    let page = 1;

    while (page > 0) {
      const { data, error } = await client.auth.admin.listUsers({
        page,
        perPage: 1000,
      });

      if (error) {
        this.logger.error(
          `Failed to list identity users on page ${page}: ${error.message}`,
        );
        throw this.identityReadFailure();
      }

      for (const user of data.users) {
        lastSignIns.set(user.id, user.last_sign_in_at ?? null);
      }

      page = data.nextPage ?? 0;
    }

    return lastSignIns;
  }
```

### Trigger สร้างโปรไฟล์และ workspace ตอนสมัคร

[`migration.sql:195–269`](../backend/prisma/migrations/20260828000000_supabase_auth_and_workspaces/migration.sql#L195)

```sql
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  default_role_id UUID;
  candidate_username TEXT;
  final_username TEXT;
  final_slug TEXT;
  suffix INT := 0;
  new_workspace_id UUID;
BEGIN
  SELECT id INTO default_role_id FROM roles WHERE name = 'user';
  IF default_role_id IS NULL THEN
    RAISE EXCEPTION 'Default role "user" is not configured';
  END IF;

  candidate_username := COALESCE(
    NULLIF(NEW.raw_user_meta_data ->> 'user_name', ''),
    NULLIF(NEW.raw_user_meta_data ->> 'preferred_username', ''),
    NULLIF(NEW.raw_user_meta_data ->> 'full_name', ''),
    NULLIF(split_part(COALESCE(NEW.email, ''), '@', 1), ''),
    NEW.id::TEXT
  );

  candidate_username := regexp_replace(lower(candidate_username), '[^a-z0-9._-]', '', 'g');
  IF candidate_username = '' THEN
    candidate_username := 'user';
  END IF;
  candidate_username := left(candidate_username, 40);

  final_username := candidate_username;
  WHILE EXISTS (SELECT 1 FROM users WHERE username = final_username) LOOP
    suffix := suffix + 1;
    final_username := left(candidate_username, 34) || '-' || suffix::TEXT;
  END LOOP;

  INSERT INTO users (id, username, email, is_active, role_id, created_at, updated_at)
  VALUES (
    NEW.id,
    final_username,
    COALESCE(NEW.email, NEW.id::TEXT || '@placeholder.local'),
    TRUE,
    default_role_id,
    now(),
    now()
  );

  final_slug := final_username;
  suffix := 0;
  WHILE EXISTS (SELECT 1 FROM workspaces WHERE slug = final_slug) LOOP
    suffix := suffix + 1;
    final_slug := left(final_username, 34) || '-' || suffix::TEXT;
  END LOOP;

  INSERT INTO workspaces (id, name, slug, owner_id, created_at, updated_at)
  VALUES (gen_random_uuid(), final_username, final_slug, NEW.id, now(), now())
  RETURNING id INTO new_workspace_id;

  INSERT INTO workspace_members (id, workspace_id, user_id, role, created_at, updated_at)
  VALUES (gen_random_uuid(), new_workspace_id, NEW.id, 'owner', now(), now());

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();
```
