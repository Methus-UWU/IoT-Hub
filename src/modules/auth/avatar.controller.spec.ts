import { type INestApplication, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AvatarController } from './avatar.controller';
import { AvatarService } from './avatar.service';
import { SupabaseAuthGuard } from './supabase-auth.guard';
import { SupabaseAdminService } from './supabase-admin.service';
import { UserRepository } from '../users/user.repository';

// JWT verification has its own suite; this suite exercises routing and upload validation.
jest.mock('jose', () => ({}));
// Use Node's native ESM bridge for the real detector; Jest's CJS VM cannot import it.
jest.mock('load-esm', () => ({
  loadEsm: () =>
    process.getBuiltinModule('module').createRequire(__filename)(
      'file-type',
    ) as unknown,
}));

const USER_ID = '55555555-5555-4555-8555-555555555555';
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMwDC3/DwADtQH9hgAMDAAAAABJRU5ErkJggg==',
  'base64',
);

describe('Account avatar endpoints', () => {
  let app: INestApplication;
  const users = { findProfileById: jest.fn() };
  const storage = {
    readAvatar: jest.fn(),
    saveAvatar: jest.fn(),
    removeAvatar: jest.fn(),
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AvatarController],
      providers: [
        AvatarService,
        { provide: UserRepository, useValue: users },
        { provide: SupabaseAdminService, useValue: storage },
      ],
    })
      .overrideGuard(SupabaseAuthGuard)
      .useValue({
        canActivate: (context: {
          switchToHttp: () => {
            getRequest: () => {
              headers: Record<string, string>;
              user?: { id: string };
            };
          };
        }) => {
          const req = context.switchToHttp().getRequest();
          if (!req.headers.authorization) throw new UnauthorizedException();
          req.user = { id: USER_ID };
          return true;
        },
      })
      .compile();
    app = module.createNestApplication();
    await app.init();
  });
  beforeEach(() => {
    jest.clearAllMocks();
    users.findProfileById.mockResolvedValue({ id: USER_ID, isActive: true });
    storage.readAvatar.mockResolvedValue(PNG);
    storage.saveAvatar.mockResolvedValue(undefined);
    storage.removeAvatar.mockResolvedValue(undefined);
  });
  afterAll(async () => app.close());

  it('requires authentication on reads, writes, and deletion', async () => {
    await request(app.getHttpServer()).get('/auth/me/avatar').expect(401);
    await request(app.getHttpServer())
      .put('/auth/me/avatar')
      .attach('file', PNG, 'avatar.png')
      .expect(401);
    await request(app.getHttpServer()).delete('/auth/me/avatar').expect(401);
    expect(storage.readAvatar).not.toHaveBeenCalled();
    expect(storage.saveAvatar).not.toHaveBeenCalled();
    expect(storage.removeAvatar).not.toHaveBeenCalled();
  });
  it('returns only the authenticated account image with private response headers', async () => {
    await request(app.getHttpServer())
      .get('/auth/me/avatar')
      .set('Authorization', 'test')
      .expect(200)
      .expect('Content-Type', 'image/png')
      .expect('Cache-Control', 'private, no-store');
    expect(storage.readAvatar).toHaveBeenCalledWith(USER_ID);
  });
  it('writes a real PNG to the authenticated owner regardless of filename', async () => {
    await request(app.getHttpServer())
      .put('/auth/me/avatar')
      .set('Authorization', 'test')
      .attach('file', PNG, '../../another-user.png')
      .expect(204);
    expect(storage.saveAvatar).toHaveBeenCalledWith(USER_ID, PNG);
  });
  it('rejects forged image MIME types and missing files', async () => {
    await request(app.getHttpServer())
      .put('/auth/me/avatar')
      .set('Authorization', 'test')
      .attach('file', Buffer.from('<svg onload="alert(1)"/>'), {
        filename: 'avatar.png',
        contentType: 'image/png',
      })
      .expect(400);
    await request(app.getHttpServer())
      .put('/auth/me/avatar')
      .set('Authorization', 'test')
      .expect(400);
    expect(storage.saveAvatar).not.toHaveBeenCalled();
  });
  it('rejects oversized files, excessive dimensions, and client owner fields', async () => {
    await request(app.getHttpServer())
      .put('/auth/me/avatar')
      .set('Authorization', 'test')
      .attach('file', Buffer.alloc(512 * 1024 + 1), 'avatar.png')
      .expect(413);
    const large = Buffer.from(PNG);
    large.writeUInt32BE(10000, 16);
    await request(app.getHttpServer())
      .put('/auth/me/avatar')
      .set('Authorization', 'test')
      .attach('file', large, 'avatar.png')
      .expect(400);
    await request(app.getHttpServer())
      .put('/auth/me/avatar')
      .set('Authorization', 'test')
      .field('userId', 'another-user')
      .attach('file', PNG, 'avatar.png')
      .expect(400);
    expect(storage.saveAvatar).not.toHaveBeenCalled();
  });
  it('blocks suspended or missing profiles before reaching storage', async () => {
    users.findProfileById.mockResolvedValue({ isActive: false });
    await request(app.getHttpServer())
      .get('/auth/me/avatar')
      .set('Authorization', 'test')
      .expect(403);
    await request(app.getHttpServer())
      .put('/auth/me/avatar')
      .set('Authorization', 'test')
      .attach('file', PNG, 'avatar.png')
      .expect(403);
    await request(app.getHttpServer())
      .delete('/auth/me/avatar')
      .set('Authorization', 'test')
      .expect(403);
    expect(storage.readAvatar).not.toHaveBeenCalled();
    expect(storage.saveAvatar).not.toHaveBeenCalled();
    expect(storage.removeAvatar).not.toHaveBeenCalled();
  });
  it('returns 404 for absent avatars and deletes only the current account image', async () => {
    storage.readAvatar.mockResolvedValue(null);
    await request(app.getHttpServer())
      .get('/auth/me/avatar')
      .set('Authorization', 'test')
      .expect(404);
    await request(app.getHttpServer())
      .delete('/auth/me/avatar')
      .set('Authorization', 'test')
      .expect(204);
    expect(storage.removeAvatar).toHaveBeenCalledWith(USER_ID);
  });
});
