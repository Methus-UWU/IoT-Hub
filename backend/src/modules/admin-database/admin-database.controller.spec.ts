import { INestApplication, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { jwtVerify } from 'jose';
import request from 'supertest';
import type { App } from 'supertest/types';

import { SupabaseConfig } from '../../common/config/supabase.config';
import { AllExceptionsFilter } from '../../common/filters/all-exceptions.filter';
import type { ApiErrorBody } from '../../common/filters/all-exceptions.filter';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { AuthorizationService } from '../authorization/authorization.service';
import { PlatformAdminGuard } from '../authorization/platform-admin.guard';
import { UserRepository } from '../users/user.repository';
import { WorkspaceRepository } from '../workspaces/workspace.repository';
import { AdminDatabaseController } from './admin-database.controller';
import { AdminDatabaseService } from './admin-database.service';
import { DatabaseOverviewRepository } from './database-overview.repository';

jest.mock('jose', () => ({
  ...jest.requireActual<typeof import('jose')>('jose'),
  createRemoteJWKSet: jest.fn(),
  jwtVerify: jest.fn(),
}));

describe('Admin database HTTP authorization and responses', () => {
  let app: INestApplication<App>;
  const readSnapshot = jest.fn();
  const findProfileById = jest.fn();
  const verify = jest.mocked(jwtVerify);
  const snapshot = {
    version: '17.6',
    sizeBytes: 1048576,
    databaseConnections: 7,
    maxConnections: 100,
    checkedAt: new Date('2026-09-06T05:00:00Z'),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AdminDatabaseController],
      providers: [
        AdminDatabaseService,
        SupabaseAuthGuard,
        PlatformAdminGuard,
        AuthorizationService,
        { provide: DatabaseOverviewRepository, useValue: { readSnapshot } },
        { provide: UserRepository, useValue: { findProfileById } },
        { provide: WorkspaceRepository, useValue: {} },
        {
          provide: SupabaseConfig,
          useValue: {
            canVerifyTokens: true,
            jwksUrl: 'https://auth.example.test/jwks',
            issuer: 'https://auth.example.test',
          },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    verify.mockResolvedValue({
      payload: { sub: 'test-user', email: 'admin@example.test' },
      protectedHeader: { alg: 'ES256' },
    });
    findProfileById.mockResolvedValue({
      isActive: true,
      role: { name: 'admin' },
    });
    readSnapshot.mockResolvedValue(snapshot);
  });

  afterAll(async () => app.close());

  it('rejects an unauthenticated request before accessing profiles or metrics', async () => {
    await request(app.getHttpServer())
      .get('/api/admin/database/overview')
      .expect(401);
    expect(findProfileById).not.toHaveBeenCalled();
    expect(readSnapshot).not.toHaveBeenCalled();
  });

  it('rejects an invalid token before accessing metrics', async () => {
    const { errors } = jest.requireActual<typeof import('jose')>('jose');
    verify.mockRejectedValueOnce(new errors.JWSSignatureVerificationFailed());
    await request(app.getHttpServer())
      .get('/api/admin/database/overview')
      .set('Authorization', 'Bearer test-invalid-token')
      .expect(401);
    expect(readSnapshot).not.toHaveBeenCalled();
  });

  it.each([
    { isActive: true, role: { name: 'user' } },
    { isActive: false, role: { name: 'admin' } },
    null,
  ])(
    'rejects a non-admin, suspended or missing profile: %j',
    async (profile) => {
      findProfileById.mockResolvedValueOnce(profile);
      const response = await request(app.getHttpServer())
        .get('/api/admin/database/overview')
        .set('Authorization', 'Bearer test-token')
        .expect(403);
      expect((response.body as ApiErrorBody).error.code).toBe(
        'ADMIN_ROLE_REQUIRED',
      );
      expect(readSnapshot).not.toHaveBeenCalled();
    },
  );

  it('returns only aggregate metrics, with a database timestamp and no caching', async () => {
    readSnapshot.mockResolvedValueOnce({
      ...snapshot,
      internalDetail: 'must not escape',
    });
    const response = await request(app.getHttpServer())
      .get('/api/admin/database/overview')
      .set('Authorization', 'Bearer test-token')
      .expect(200)
      .expect('Cache-Control', 'no-store');
    expect(response.body).toEqual({
      ...snapshot,
      checkedAt: snapshot.checkedAt.toISOString(),
    });
    expect(findProfileById).toHaveBeenCalledWith('test-user');
  });

  it('checks the role again after an administrator is demoted', async () => {
    await request(app.getHttpServer())
      .get('/api/admin/database/overview')
      .set('Authorization', 'Bearer test-token')
      .expect(200);
    findProfileById.mockResolvedValueOnce({
      isActive: true,
      role: { name: 'user' },
    });
    await request(app.getHttpServer())
      .get('/api/admin/database/overview')
      .set('Authorization', 'Bearer test-token')
      .expect(403);
    expect(readSnapshot).toHaveBeenCalledTimes(1);
  });

  it('returns a safe 503 when statistics cannot be read, even in development', async () => {
    const logger = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    try {
      readSnapshot.mockRejectedValueOnce(new Error('sensitive-driver-detail'));
      const response = await request(app.getHttpServer())
        .get('/api/admin/database/overview')
        .set('Authorization', 'Bearer test-token')
        .expect(503);
      expect((response.body as ApiErrorBody).error.code).toBe(
        'DATABASE_OVERVIEW_UNAVAILABLE',
      );
      expect(JSON.stringify(response.body)).not.toContain(
        'sensitive-driver-detail',
      );
      expect(JSON.stringify(logger.mock.calls)).not.toContain(
        'sensitive-driver-detail',
      );
    } finally {
      logger.mockRestore();
    }
  });
});
