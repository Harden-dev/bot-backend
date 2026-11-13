import {
  Body,
  Controller,
  Get,
  Post,
  type RawBodyRequest,
  Req,
} from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { IsString } from 'class-validator';
import type { Request } from 'express';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { Public } from '../src/common/index.js';

class ProbeDto {
  @IsString()
  name: string;
}

// Contrôleur de test du socle HTTP : public pour ne pas dépendre du JWT.
@Public()
@Controller('probe')
class ProbeController {
  @Get()
  get() {
    return { ok: true };
  }

  @Post()
  post(@Body() dto: ProbeDto, @Req() req: RawBodyRequest<Request>) {
    return { name: dto.name, rawLength: req.rawBody?.length ?? 0 };
  }

  @Get('boom')
  boom() {
    throw new Error('détail interne SELECT * FROM users');
  }
}

describe('Socle HTTP (e2e)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [ProbeController],
    }).compile();

    app = moduleRef.createNestApplication<NestExpressApplication>({
      rawBody: true,
    });
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('expose les routes sous /api/v1', async () => {
    await request(app.getHttpServer()).get('/api/v1/probe').expect(200, {
      ok: true,
    });
    await request(app.getHttpServer()).get('/probe').expect(404);
  });

  it('renvoie une route inconnue au format { statusCode, message, error }', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/inconnue')
      .expect(404);

    expect(res.body).toMatchObject({ statusCode: 404, error: 'Not Found' });
  });

  it('refuse un champ non autorisé (forbidNonWhitelisted)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/probe')
      .send({ name: 'a', extra: 1 })
      .expect(400);

    expect(res.body).toMatchObject({ statusCode: 400, error: 'Bad Request' });
  });

  it('conserve le corps brut de la requête (rawBody)', async () => {
    const payload = JSON.stringify({ name: 'abc' });

    const res = await request(app.getHttpServer())
      .post('/api/v1/probe')
      .set('Content-Type', 'application/json')
      .send(payload)
      .expect(201);

    expect(res.body).toEqual({ name: 'abc', rawLength: payload.length });
  });

  it('accepte un corps JSON de 200 ko', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/probe')
      .send({ name: 'x'.repeat(200 * 1024) })
      .expect(201);
  });

  it('refuse un corps JSON de plus de 256 ko', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/probe')
      .send({ name: 'x'.repeat(300 * 1024) })
      .expect(413);

    expect(res.body).toEqual({
      statusCode: 413,
      message: 'request entity too large',
      error: 'Payload Too Large',
    });
  });

  it('n’expose pas l’en-tête X-Powered-By', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/probe')
      .expect(200);

    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it.each([
    ['une réponse 200', '/api/v1/probe', 200],
    ['une erreur 500', '/api/v1/probe/boom', 500],
    ['une route inconnue (404)', '/api/v1/inexistante', 404],
  ])(
    'pose les en-têtes de sécurité sur %s (B-03)',
    async (_label, path, status) => {
      const res = await request(app.getHttpServer()).get(path).expect(status);

      expect(res.headers).toMatchObject({
        'x-content-type-options': 'nosniff',
        'x-frame-options': 'DENY',
        'referrer-policy': 'no-referrer',
        'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
      });
    },
  );

  it('pose les en-têtes de sécurité sur une erreur de l’analyseur JSON (400 générique, I-04)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/probe')
      .set('Content-Type', 'application/json')
      .send('{"name":"Awa 0707070707')
      .expect(400, {
        statusCode: 400,
        message: 'Corps de requête JSON invalide',
        error: 'Bad Request',
      });

    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('ne pose pas la CSP sur l’interface Swagger (hors production)', async () => {
    const res = await request(app.getHttpServer()).get('/api/docs').expect(200);

    expect(res.headers['content-security-policy']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('masque le détail d’une erreur inattendue (500)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/probe/boom')
      .expect(500);

    expect(res.body).toEqual({
      statusCode: 500,
      message: 'Erreur interne',
      error: 'Internal Server Error',
    });
  });
});
