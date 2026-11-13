import { JwtService } from '@nestjs/jwt';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { PrismaService } from '../src/prisma/index.js';
import {
  createApp,
  seedAdminWithToken,
  TEST_ADMIN,
} from './helpers/create-app.js';
import { resetDb } from './helpers/reset-db.js';

const EIGHT_HOURS_IN_SECONDS = 8 * 60 * 60;

const UNAUTHORIZED = {
  statusCode: 401,
  message: 'Authentification requise',
  error: 'Unauthorized',
};

const INVALID_CREDENTIALS = {
  statusCode: 401,
  message: 'E-mail ou mot de passe incorrect',
  error: 'Unauthorized',
};

function decodePayload(token: string): Record<string, unknown> {
  const [, payload = ''] = token.split('.');
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
}

describe('Auth (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let token: string;
  // IP distincte par test : la connexion est limitée à 5 appels par minute et
  // par IP (voir throttler.e2e-spec.ts).
  let clientIp: string;
  let ipSuffix = 0;

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    ipSuffix += 1;
    clientIp = `198.51.100.${ipSuffix}`;
    await resetDb(prisma);
    token = await seedAdminWithToken(app);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/v1/auth/login', () => {
    it('renvoie { accessToken, user } avec un JWT HS256 valable 8 h', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', clientIp)
        .send({ email: TEST_ADMIN.email, password: TEST_ADMIN.password })
        .expect(200);

      expect(res.body).toEqual({
        accessToken: expect.any(String),
        user: {
          id: expect.any(Number),
          email: TEST_ADMIN.email,
          name: TEST_ADMIN.name,
          role: 'admin',
        },
      });
      const payload = decodePayload(res.body.accessToken);
      expect(payload['sub']).toBe(String(res.body.user.id));
      expect(Number(payload['exp']) - Number(payload['iat'])).toBe(
        EIGHT_HOURS_IN_SECONDS,
      );
      const [header = ''] = String(res.body.accessToken).split('.');
      expect(
        JSON.parse(Buffer.from(header, 'base64url').toString('utf8')),
      ).toMatchObject({ alg: 'HS256' });
    });

    it.each([
      ['mot de passe faux', TEST_ADMIN.email, 'mauvais-mot-de-passe'],
      ['e-mail inconnu', 'inconnu@example.com', TEST_ADMIN.password],
    ])(
      'refuse en 401 sans dire lequel est faux : %s',
      async (_, email, password) => {
        await request(app.getHttpServer())
          .post('/api/v1/auth/login')
          .set('X-Forwarded-For', clientIp)
          .send({ email, password })
          .expect(401, INVALID_CREDENTIALS);
      },
    );

    it('refuse un compte inactif avec le même message (PO-17)', async () => {
      await prisma.user.updateMany({ data: { isActive: false } });

      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', clientIp)
        .send({ email: TEST_ADMIN.email, password: TEST_ADMIN.password })
        .expect(401, INVALID_CREDENTIALS);
    });

    it('refuse un corps invalide en 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', clientIp)
        .send({ email: 'pas-un-email', password: '' })
        .expect(400);

      expect(res.body).toMatchObject({ statusCode: 400, error: 'Bad Request' });
    });

    it('stocke le mot de passe haché en argon2id', async () => {
      const admin = await prisma.user.findUniqueOrThrow({
        where: { email: TEST_ADMIN.email },
      });

      expect(admin.passwordHash).toMatch(/^\$argon2id\$/);
    });
  });

  describe('GET /api/v1/auth/me', () => {
    it('renvoie l’utilisateur courant sans hachage', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body).toEqual({
        id: expect.any(Number),
        email: TEST_ADMIN.email,
        name: TEST_ADMIN.name,
        role: 'admin',
      });
    });

    it('répond 401 sans jeton', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .expect(401, UNAUTHORIZED);
    });

    it('répond 401 avec un jeton mal formé', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', 'Bearer abc.def.ghi')
        .expect(401, UNAUTHORIZED);
    });

    it('répond 401 avec un jeton signé par une autre clé', async () => {
      const forged = await new JwtService({
        secret: 'une-autre-cle-de-signature-de-32-caracteres',
      }).signAsync({ sub: decodePayload(token)['sub'] });

      await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${forged}`)
        .expect(401, UNAUTHORIZED);
    });

    it('répond 401 avec un jeton HS512 signé par la bonne clé (algorithme imposé)', async () => {
      const hs512 = await new JwtService({
        secret: process.env['JWT_SECRET'],
      }).signAsync(
        { sub: decodePayload(token)['sub'] },
        { algorithm: 'HS512' },
      );

      await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${hs512}`)
        .expect(401, UNAUTHORIZED);
    });

    it('répond 401 avec un jeton non signé (alg none)', async () => {
      const [, payload] = token.split('.');
      const header = Buffer.from(
        JSON.stringify({ alg: 'none', typ: 'JWT' }),
      ).toString('base64url');

      await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${header}.${payload}.`)
        .expect(401, UNAUTHORIZED);
    });

    it('répond 401 avec un jeton expiré', async () => {
      const expired = await new JwtService({
        secret: process.env['JWT_SECRET'],
      }).signAsync({
        sub: decodePayload(token)['sub'],
        exp: Math.floor(Date.now() / 1000) - 60,
      });

      await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${expired}`)
        .expect(401, UNAUTHORIZED);
    });

    it('répond 401 avec un jeton signé par la bonne clé mais sans exp (B-01)', async () => {
      const withoutExp = await new JwtService({
        secret: process.env['JWT_SECRET'],
      }).signAsync({ sub: decodePayload(token)['sub'] });
      expect(decodePayload(withoutExp)).not.toHaveProperty('exp');

      await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${withoutExp}`)
        .expect(401, UNAUTHORIZED);
    });

    it('répond 401 avec un jeton émis il y a plus de JWT_EXPIRES_IN, même avec un exp futur (B-01)', async () => {
      const now = Math.floor(Date.now() / 1000);
      const tooOld = await new JwtService({
        secret: process.env['JWT_SECRET'],
      }).signAsync({
        sub: decodePayload(token)['sub'],
        iat: now - EIGHT_HOURS_IN_SECONDS - 60,
        exp: now + 3600,
      });

      await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${tooOld}`)
        .expect(401, UNAUTHORIZED);
    });

    it('répond 401 avec le jeton d’un compte désactivé depuis (PO-17)', async () => {
      await prisma.user.updateMany({ data: { isActive: false } });

      await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(401, UNAUTHORIZED);
    });
  });

  describe('Routes protégées par la garde globale', () => {
    it.each([
      ['get', '/api/v1/auth/me'],
      ['get', '/api/v1/vendors'],
      ['post', '/api/v1/vendors'],
      ['patch', '/api/v1/vendors/1'],
    ] as const)('%s %s répond 401 sans jeton', async (method, url) => {
      await request(app.getHttpServer())[method](url).expect(401, UNAUTHORIZED);
    });

    it('laisse GET /api/v1/health public', async () => {
      await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    });

    it('n’expose aucune route d’inscription', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email: 'x@example.com', password: 'x' })
        .expect(404);
    });
  });
});
