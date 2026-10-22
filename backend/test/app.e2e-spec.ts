import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';

jest.mock('./../src/prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      // This smoke test exercises Nest's full module graph and HTTP pipeline.
      // Database integration has its own repository tests; connecting here made
      // the otherwise local health check retry PostgreSQL for twenty seconds.
      .overrideProvider(PrismaService)
      .useValue({ db: {}, onModuleInit: jest.fn(), onModuleDestroy: jest.fn() })
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  afterEach(async () => {
    await app.close();
  });

  it('/health (GET) remains available beyond the normal rate limit', async () => {
    for (let attempt = 0; attempt < 125; attempt++) {
      await request(app.getHttpServer())
        .get('/health')
        .expect(200)
        .expect({ data: { status: 'ok' } });
    }
  });
});
