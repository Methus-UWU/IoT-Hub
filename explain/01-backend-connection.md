# 01 · Frontend เชื่อมต่อ Backend อย่างไร

## เส้นทางของ request

```
Browser ── https://unity-hub.connectdb.xyz/api/... 
   └─ Cloudflare Tunnel (container cloudflared)
        └─ caddy:80
             └─ unity-hub-nginx:80        ← เสิร์ฟไฟล์ Angular และส่งต่อ /api
                  └─ nestjs:3000          ← NestJS (global prefix "api")
```

- frontend กับ API อยู่ origin เดียวกัน จึงไม่ต้องตั้ง CORS ข้ามโดเมน
- รายละเอียดการ deploy อยู่ที่ [`docs/DEPLOYMENT.md`](../docs/DEPLOYMENT.md)

## ฝั่ง Angular

| ขั้น | โค้ด | ทำอะไร |
| --- | --- | --- |
| 1 | [`environment.ts:10`](../frontend/src/environments/environment.ts#L10) | `apiUrl: '/api/'` ทุก service ต่อ URL จากค่านี้ |
| 2 | [`app.config.ts:13`](../frontend/src/app/app.config.ts#L13) | `provideHttpClient(withInterceptors([authInterceptor]))` ลงทะเบียน interceptor ตัวเดียวของแอป |
| 3 | [`auth.interceptor.ts:22`](../frontend/src/app/core/interceptors/auth.interceptor.ts#L22) | แนบ `Authorization: Bearer <access token>` เฉพาะ request ที่ขึ้นต้นด้วย `apiUrl` (บรรทัด 23) เพื่อไม่ให้ token รั่วไปโดเมนอื่น |
| 4 | [`auth.interceptor.ts:48`](../frontend/src/app/core/interceptors/auth.interceptor.ts#L48) | ถ้าได้ 401 จะ refresh token หนึ่งครั้งแล้วยิงซ้ำ ถ้า refresh ไม่ผ่านจะล้าง session และพาไป `/auth/login` (บรรทัด 63–71) |
| 5 | [`crud.service.ts:14`](../frontend/src/app/core/services/crud.service.ts#L14) | `CrudResource<T>` ห่อ `list/get/create/update/patch/delete` ใช้กับ resource มาตรฐาน |
| 6 | [`projects-api.service.ts`](../frontend/src/app/core/services/projects-api.service.ts) | API ของโปรเจกต์ทั้งหมด เช่น `createProject` (บรรทัด 232), `addComponent` (140), `addConnection` (191), `saveFile` (263) |

URL ของโปรเจกต์มี workspace อยู่ในนั้นเสมอ: `/api/workspaces/:workspaceId/projects/:projectId/...`
(ดูตัวสร้าง URL ที่ `projects-api.service.ts:301–316`)

## ฝั่ง nginx

[`deploy/nginx.conf`](../deploy/nginx.conf)

- บรรทัด 36: `resolver 127.0.0.11` ให้ nginx หา IP ของ container `nestjs` ใหม่ทุกครั้งที่ container ถูกแทนที่
- บรรทัด 58: `/api/internal/` ตอบ 404 เสมอ route นี้ให้ build worker ใช้ภายใน Docker เท่านั้น
- บรรทัด 62–63: `location ~ ^/api` → `proxy_pass http://nestjs_backend`
- บรรทัด 93: `location /` ส่ง `index.html` สำหรับ SPA deep link

## ฝั่ง NestJS

[`main.ts`](../backend/src/main.ts)

| บรรทัด | ทำอะไร |
| --- | --- |
| 24–25 | `trust proxy` ให้ Express เห็น IP จริงของผู้ใช้หลัง nginx |
| 28 | `app.setGlobalPrefix('api')` ทุก controller จึงอยู่ใต้ `/api` |
| 29 | `helmet()` ใส่ security headers |
| 35–40 | จำกัดขนาด body (route ของ build worker ได้เพดานใหญ่กว่า) |
| 42–48 | `ValidationPipe` ทั่วระบบ: `whitelist` + `forbidNonWhitelisted` ตัด/ปฏิเสธฟิลด์ที่ DTO ไม่ได้ประกาศ |
| 49 | `AllExceptionsFilter` จัดรูป error ให้เหมือนกันทุก endpoint |
| 59–62 | CORS ตาม `CORS_ORIGINS` ถ้าไม่ได้ตั้งจะปิดทั้งหมด (fail closed) |
| 65 | `app.listen(port, '0.0.0.0')` |

### ลำดับการตรวจใน 1 request (ตัวอย่าง: สร้างโปรเจกต์)

[`projects.controller.ts:48–85`](../backend/src/modules/projects/projects.controller.ts#L48)

1. `@UseGuards(SupabaseAuthGuard)` (บรรทัด 49) ตรวจ JWT และใส่ `request.user` (ดู [02-supabase.md](02-supabase.md))
2. `ParseUUIDPipe` ตรวจว่า `workspaceId` เป็น UUID
3. `ValidationPipe` ตรวจ body กับ `CreateProjectDto`
4. `authorization.requireWorkspaceRole(userId, workspaceId, 'editor')` ตรวจสิทธิ์จากตาราง membership ใน DB ([`authorization.service.ts:34`](../backend/src/modules/authorization/authorization.service.ts#L34))
5. เรียก service ทำงานจริง

Guard ยืนยันแค่ว่า "คุณคือใคร" ส่วน "ทำอะไรได้" อ่านจากฐานข้อมูลทุกครั้ง เปลี่ยนสิทธิ์ใน DB แล้วมีผลทันที ไม่ต้องรอ token ใหม่

## โค้ดจริง

โค้ดด้านล่างคัดลอกจากไฟล์จริงตามเลขบรรทัดที่ระบุ ตัด comment ออกแล้ว ส่วนอื่นไม่ได้แก้

### Angular แนบ token ทุก request ไป /api

[`auth.interceptor.ts:22–77`](../frontend/src/app/core/interceptors/auth.interceptor.ts#L22)

```ts
export const authInterceptor: HttpInterceptorFn = (request, next) => {
  if (!request.url.startsWith(environment.apiUrl)) {
    return next(request);
  }

  const auth = inject(AuthService);
  const router = inject(Router);
  const accessToken = auth.getAccessToken();

  const authenticatedRequest = request.clone({
    setHeaders: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
  });

  return next(authenticatedRequest).pipe(
    catchError((error: unknown) => {
      const path = request.url.slice(environment.apiUrl.length).split('?')[0];

      if (
        !(error instanceof HttpErrorResponse) ||
        error.status !== 401 ||
        PUBLIC_API_PATHS.includes(path) ||
        !accessToken
      ) {
        return throwError(() => error);
      }

      return auth.refreshAccessToken().pipe(
        switchMap((refreshedToken) =>
          next(
            request.clone({
              setHeaders: { Authorization: `Bearer ${refreshedToken}` },
            }),
          ),
        ),
        catchError((refreshError: unknown) => {
          if (isAuthRetryableFetchError(refreshError)) {
            return throwError(() => error);
          }
          auth.clearSession();
          if (!headingToAuth(router)) {
            void router.navigate(['/auth/login']);
          }
          return throwError(() => refreshError);
        }),
      );
    }),
  );
};
```

### เรียก API สร้างโปรเจกต์ และสร้าง URL

[`projects-api.service.ts:232–247`](../frontend/src/app/core/services/projects-api.service.ts#L232)

```ts
  createProject(
    workspaceId: string,
    body: {
      name: string;
      description?: string;
      boardId: string;
      framework?: string;
      deviceIds?: string[];
    },
  ): Observable<RemoteProject & { components: RemoteComponent[] }> {
    return this.http.post<RemoteProject & { components: RemoteComponent[] }>(
      this.projectsUrl(workspaceId),
      body,
    );
  }
```

[`projects-api.service.ts:301–316`](../frontend/src/app/core/services/projects-api.service.ts#L301)

```ts
  private connectionsUrl(workspaceId: string, projectId: string): string {
    return this.projectUrl(workspaceId, projectId) + '/connections';
  }

  private connectionUrl(workspaceId: string, projectId: string, connectionId: string): string {
    return this.connectionsUrl(workspaceId, projectId) + '/' + encodeURIComponent(connectionId);
  }

  private projectsUrl(workspaceId: string): string {
    return `${environment.apiUrl}workspaces/${encodeURIComponent(workspaceId)}/projects`;
  }

  private projectUrl(workspaceId: string, projectId: string): string {
    return `${this.projectsUrl(workspaceId)}/${encodeURIComponent(projectId)}`;
  }
}
```

### nginx ส่ง /api ต่อให้ NestJS

[`nginx.conf:58–75`](../deploy/nginx.conf#L58)

```nginx
        location ^~ /api/internal/ {
            return 404;
        }

        location ~ ^/api(?:/|$) {
            proxy_pass http://nestjs_backend;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $forwarded_proto;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection $connection_upgrade;
            proxy_connect_timeout 5s;
            proxy_read_timeout 240s;
            proxy_send_timeout 240s;
            proxy_buffering off;
        }
```

### NestJS bootstrap

[`main.ts:18–67`](../backend/src/main.ts#L18)

```ts
async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  const trustProxy = trustProxySetting();
  if (trustProxy !== undefined) app.set('trust proxy', trustProxy);
  app.enableShutdownHooks();

  app.setGlobalPrefix('api');
  app.use(helmet());

  app.use(
    '/api/internal/build-jobs',
    express.json({ limit: BUILD_RESULT_BODY_LIMIT }),
  );
  app.use(express.json({ limit: REQUEST_BODY_LIMIT }));
  app.use(express.urlencoded({ extended: false, limit: REQUEST_BODY_LIMIT }));

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());

  const origins = corsOrigins();
  if (origins.length === 0) {
    logger.warn(
      'No CORS origin configured. Set CORS_ORIGINS before serving a browser client.',
    );
  }
  app.enableCors({
    origin: origins,
    credentials: true,
  });

  const port = process.env.PORT ?? 3000;
  await app.listen(port, '0.0.0.0');
  logger.log(`API listening on port ${port} (production=${isProduction()})`);
}
```

### Controller: guard → ตรวจสิทธิ์ → service

[`projects.controller.ts:73–85`](../backend/src/modules/projects/projects.controller.ts#L73)

```ts
  @Post()
  async create(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Body() body: CreateProjectDto,
  ) {
    await this.authorization.requireWorkspaceRole(
      request.user.id,
      workspaceId,
      'editor',
    );
    return this.projects.create(request.user.id, workspaceId, body);
  }
```

### ตรวจสิทธิ์ใน workspace จากฐานข้อมูล

[`authorization.service.ts:34–61`](../backend/src/modules/authorization/authorization.service.ts#L34)

```ts
  async requireWorkspaceRole(
    userId: string,
    workspaceId: string,
    required: WorkspaceRole,
  ): Promise<WorkspaceRole> {
    const membership = await this.workspaces.findMembership(
      workspaceId,
      userId,
    );

    if (!membership) {
      throw new NotFoundException({
        code: 'WORKSPACE_NOT_FOUND',
        message: 'Workspace not found',
      });
    }

    if (!satisfies(membership.role, required)) {
      throw new ForbiddenException({
        code: 'INSUFFICIENT_WORKSPACE_ROLE',
        message: `This action requires the ${required} role or higher`,
      });
    }

    return membership.role;
  }
```
