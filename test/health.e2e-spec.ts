import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { PrismaService } from '../src/prisma/index.js';

describe('GET /api/v1/health (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication<NestExpressApplication>({
      rawBody: true,
    });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  it('répond 200 sans jeton quand l’application et MySQL répondent', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200, { status: 'ok' });
  });

  it('répond 503 sans détail interne quand la requête SQL échoue (échec simulé de $queryRaw)', async () => {
    vi.spyOn(prisma, '$queryRaw').mockRejectedValueOnce(
      new Error('connect ECONNREFUSED 127.0.0.1:3306'),
    );

    const res = await request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(503);

    expect(res.body).toEqual({
      statusCode: 503,
      message: 'Base de données indisponible',
      error: 'Service Unavailable',
    });
  });
});
