import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { LOGIN_RATE_LIMIT_MESSAGE } from '../src/auth/login-rate-limit.js';
import type { Env } from '../src/config/index.js';
import { PrismaService } from '../src/prisma/index.js';
import { WhatsappClient } from '../src/whatsapp/client/index.js';
import {
  createApp,
  seedAdminWithToken,
  TEST_ADMIN,
} from './helpers/create-app.js';
import { resetDb } from './helpers/reset-db.js';
import { signMetaBody } from './helpers/sign.js';

const LOGIN = '/api/v1/auth/login';
const WEBHOOK = '/api/v1/whatsapp/webhook';
const LIMIT = 5;
const TOO_MANY_REQUESTS = {
  statusCode: 429,
  message: LOGIN_RATE_LIMIT_MESSAGE,
  error: 'Too Many Requests',
};
const WRONG_PASSWORD = { email: TEST_ADMIN.email, password: 'mauvais-mdp' };
const GOOD_PASSWORD = {
  email: TEST_ADMIN.email,
  password: TEST_ADMIN.password,
};

/**
 * Le compteur est en mémoire, par IP : chaque test utilise sa propre IP
 * (`X-Forwarded-For`, `trust proxy` à 1 comme derrière Nginx).
 */
describe('Limitation de débit (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let token: string;

  function login(ip: string, body: object = WRONG_PASSWORD) {
    return request(app.getHttpServer())
      .post(LOGIN)
      .set('X-Forwarded-For', ip)
      .send(body);
  }

  beforeAll(async () => {
    app = await createApp((builder) =>
      builder
        .overrideProvider(WhatsappClient)
        .useValue({ sendText: vi.fn(), sendButtons: vi.fn() }),
    );
    prisma = app.get(PrismaService);
    await resetDb(prisma);
    token = await seedAdminWithToken(app);
  });

  afterAll(async () => {
    await resetDb(prisma);
    await app.close();
  });

  it('refuse la 6e tentative de connexion de la minute en 429, même avec le bon mot de passe', async () => {
    const ip = '203.0.113.10';
    for (let attempt = 1; attempt <= LIMIT; attempt += 1) {
      await login(ip).expect(401);
    }

    await login(ip, GOOD_PASSWORD).expect(429, TOO_MANY_REQUESTS);
  });

  it('compte aussi les connexions réussies et les corps invalides', async () => {
    const ip = '203.0.113.11';
    await login(ip, GOOD_PASSWORD).expect(200);
    await login(ip, { email: 'pas-un-email' }).expect(400);
    for (let attempt = 3; attempt <= LIMIT; attempt += 1) {
      await login(ip).expect(401);
    }

    await login(ip).expect(429, TOO_MANY_REQUESTS);
  });

  it('compte par IP réelle du client (X-Forwarded-For posé par Nginx)', async () => {
    const blocked = '203.0.113.12';
    for (let attempt = 1; attempt <= LIMIT; attempt += 1) {
      await login(blocked).expect(401);
    }
    await login(blocked).expect(429);

    await login('203.0.113.13', GOOD_PASSWORD).expect(200);
  });

  it('ignore une IP ajoutée par le client devant celle de Nginx', async () => {
    const proxied = '203.0.113.14';
    for (let attempt = 1; attempt <= LIMIT; attempt += 1) {
      await login(`198.51.100.${attempt}, ${proxied}`).expect(401);
    }

    await login(`198.51.100.99, ${proxied}`).expect(429, TOO_MANY_REQUESTS);
  });

  it('indique le délai d’attente (Retry-After)', async () => {
    const ip = '203.0.113.15';
    for (let attempt = 1; attempt <= LIMIT; attempt += 1) {
      await login(ip).expect(401);
    }

    const res = await login(ip).expect(429);
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('ne limite pas le webhook WhatsApp', async () => {
    const appSecret = app
      .get<ConfigService<Env, true>>(ConfigService)
      .get('META_APP_SECRET', { infer: true });
    const raw = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [],
    });
    const ip = '203.0.113.16';

    for (let attempt = 1; attempt <= 3 * LIMIT; attempt += 1) {
      await request(app.getHttpServer())
        .post(WEBHOOK)
        .set('X-Forwarded-For', ip)
        .set('Content-Type', 'application/json')
        .set('X-Hub-Signature-256', signMetaBody(raw, appSecret))
        .send(raw)
        .expect(200);
    }
  });

  it('ne limite pas les routes authentifiées (GET /auth/me)', async () => {
    const ip = '203.0.113.18';
    for (let attempt = 1; attempt <= LIMIT + 1; attempt += 1) {
      await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('X-Forwarded-For', ip)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    }
  });

  it('ne limite pas les autres routes', async () => {
    const ip = '203.0.113.17';
    for (let attempt = 1; attempt <= 3 * LIMIT; attempt += 1) {
      await request(app.getHttpServer())
        .get('/api/v1/health')
        .set('X-Forwarded-For', ip)
        .expect(200);
    }
  });
});
