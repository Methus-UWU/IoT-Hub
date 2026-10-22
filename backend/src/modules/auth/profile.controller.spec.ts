import {
  type INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { LoginHistoryService } from './login-history.service';
import { SupabaseAuthGuard } from './supabase-auth.guard';
import { UserRepository } from '../users/user.repository';

jest.mock('jose', () => ({}));

const USER_ID = '55555555-5555-4555-8555-555555555555';
const profile = {
  id: USER_ID,
  username: 'maker',
  displayName: null,
  bio: null,
  email: 'maker@example.com',
  isActive: true,
  role: { name: 'user' },
};

describe('Account profile', () => {
  let app: INestApplication;
  const users = {
    findProfileById: jest.fn(),
    findOtherIdByUsernameOrEmail: jest.fn(),
    updateProfile: jest.fn(),
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        AuthService,
        { provide: UserRepository, useValue: users },
        { provide: LoginHistoryService, useValue: {} },
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
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });
  beforeEach(() => {
    jest.clearAllMocks();
    users.findProfileById.mockResolvedValue(profile);
    users.findOtherIdByUsernameOrEmail.mockResolvedValue(null);
    users.updateProfile.mockImplementation((id: string, input: object) =>
      Promise.resolve({ ...profile, ...input, id }),
    );
  });
  afterAll(async () => app.close());

  it('requires authentication and rejects owner, role, or email overrides', async () => {
    await request(app.getHttpServer())
      .patch('/auth/me')
      .send({ username: 'maker' })
      .expect(401);
    for (const extra of [
      { id: 'another-user' },
      { role: 'admin' },
      { email: 'other@example.com' },
    ]) {
      await request(app.getHttpServer())
        .patch('/auth/me')
        .set('Authorization', 'test')
        .send({ username: 'maker', ...extra })
        .expect(400);
    }
    expect(users.updateProfile).not.toHaveBeenCalled();
  });

  it('trims and stores Thai profile details only for the verified account', async () => {
    const response = await request(app.getHttpServer())
      .patch('/auth/me')
      .set('Authorization', 'test')
      .send({
        username: 'maker',
        displayName: '  นักประดิษฐ์  ',
        bio: '  สนใจ IoT\nและ ESP32  ',
      })
      .expect(200);
    expect(users.updateProfile).toHaveBeenCalledWith(USER_ID, {
      username: 'maker',
      displayName: 'นักประดิษฐ์',
      bio: 'สนใจ IoT\nและ ESP32',
    });
    expect(response.body).toMatchObject({
      displayName: 'นักประดิษฐ์',
      bio: 'สนใจ IoT\nและ ESP32',
    });
  });

  it('preserves omitted details for old clients and allows clearing optional details', async () => {
    await request(app.getHttpServer())
      .patch('/auth/me')
      .set('Authorization', 'test')
      .send({ username: 'maker' })
      .expect(200);
    expect(users.updateProfile).toHaveBeenLastCalledWith(USER_ID, {
      username: 'maker',
    });
    await request(app.getHttpServer())
      .patch('/auth/me')
      .set('Authorization', 'test')
      .send({ username: 'maker', displayName: '  ', bio: null })
      .expect(200);
    expect(users.updateProfile).toHaveBeenLastCalledWith(USER_ID, {
      username: 'maker',
      displayName: null,
      bio: null,
    });
  });

  it.each([
    { displayName: 'a'.repeat(61) },
    { bio: 'a'.repeat(281) },
    { displayName: 1 },
    { bio: {} },
  ])('rejects invalid details: %j', async (details) => {
    await request(app.getHttpServer())
      .patch('/auth/me')
      .set('Authorization', 'test')
      .send({ username: 'maker', ...details })
      .expect(400);
    expect(users.updateProfile).not.toHaveBeenCalled();
  });

  it('refuses suspended accounts and conflicting usernames without writing details', async () => {
    users.findProfileById.mockResolvedValue({ ...profile, isActive: false });
    await request(app.getHttpServer())
      .patch('/auth/me')
      .set('Authorization', 'test')
      .send({ username: 'maker', bio: 'draft' })
      .expect(403);
    users.findProfileById.mockResolvedValue(profile);
    users.findOtherIdByUsernameOrEmail.mockResolvedValue('another-user');
    await request(app.getHttpServer())
      .patch('/auth/me')
      .set('Authorization', 'test')
      .send({ username: 'taken', bio: 'draft' })
      .expect(409);
    expect(users.updateProfile).not.toHaveBeenCalled();
  });
});
