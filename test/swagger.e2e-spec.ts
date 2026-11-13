import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PARAMS_PROVIDER_TOKEN } from 'nestjs-pino';
import request from 'supertest';
import type { Env } from '../src/config/index.js';
import { createApp } from './helpers/create-app.js';

const DOCS = '/api/docs';
const DOCS_JSON = '/api/docs-json';
const PUBLIC_OPERATIONS = [
  'post /api/v1/auth/login',
  'get /api/v1/health',
  'get /api/v1/whatsapp/webhook',
  'post /api/v1/whatsapp/webhook',
];
const SECRET_KEYS = [
  'DATABASE_URL',
  'JWT_SECRET',
  'META_APP_SECRET',
  'WEBHOOK_VERIFY_TOKEN',
  'WHATSAPP_TOKEN',
  'PHONE_NUMBER_ID',
  'WABA_ID',
  'ADMIN_PASSWORD',
] as const;

interface OpenApiOperation {
  security?: Record<string, string[]>[];
}

interface OpenApiDocument {
  openapi: string;
  paths: Record<string, Record<string, OpenApiOperation>>;
  components: { securitySchemes: Record<string, unknown> };
}

describe('Swagger hors production (e2e)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('sert l’interface sur /api/docs, hors préfixe /api/v1', async () => {
    const res = await request(app.getHttpServer()).get(DOCS).expect(200);

    expect(res.headers['content-type']).toContain('text/html');
    await request(app.getHttpServer()).get('/api/v1/docs').expect(404);
  });

  it('décrit toutes les routes, avec l’auth Bearer sauf sur les routes publiques', async () => {
    const res = await request(app.getHttpServer()).get(DOCS_JSON).expect(200);
    const document = res.body as OpenApiDocument;

    expect(document.openapi).toMatch(/^3\./);
    expect(document.components.securitySchemes).toHaveProperty('bearer');
    const operations = Object.entries(document.paths).flatMap(
      ([path, methods]) =>
        Object.entries(methods).map(([method, operation]) => ({
          key: `${method} ${path}`,
          operation,
        })),
    );
    expect(operations.map(({ key }) => key).sort()).toEqual(
      [
        ...PUBLIC_OPERATIONS,
        'get /api/v1/auth/me',
        'get /api/v1/orders',
        'get /api/v1/orders/counts',
        'get /api/v1/orders/{id}',
        'patch /api/v1/orders/{id}',
        'patch /api/v1/orders/{id}/status',
        'get /api/v1/receipts/{orderId}',
        'post /api/v1/receipts/batch',
        'get /api/v1/stats/overview',
        'get /api/v1/stats/by-vendor',
        'get /api/v1/stats/by-day',
        'get /api/v1/vendors',
        'post /api/v1/vendors',
        'patch /api/v1/vendors/{id}',
      ].sort(),
    );
    for (const { key, operation } of operations) {
      if (PUBLIC_OPERATIONS.includes(key)) {
        expect(operation.security, key).toBeUndefined();
      } else {
        expect(operation.security, key).toEqual([{ bearer: [] }]);
      }
    }
  });

  it('documente les DTO de requête et de réponse', async () => {
    const res = await request(app.getHttpServer()).get(DOCS_JSON).expect(200);
    const schemas = Object.keys(
      (res.body as { components: { schemas: object } }).components.schemas,
    );

    expect(schemas).toEqual(
      expect.arrayContaining([
        'LoginDto',
        'LoginResponseDto',
        'UserResponseDto',
        'CreateVendorDto',
        'UpdateVendorDto',
        'VendorResponseDto',
        'OrderPageDto',
        'OrderDetailDto',
        'OrderCountsDto',
        'UpdateOrderDto',
        'ChangeStatusDto',
        'BatchReceiptsDto',
        'StatsOverviewDto',
        'StatsByVendorDto',
        'StatsByDayDto',
        'HealthResponseDto',
        'ErrorResponseDto',
      ]),
    );
  });

  it('type chaque propriété : ni objet générique (hors byStatus), ni propriété sans type ni référence', async () => {
    const res = await request(app.getHttpServer()).get(DOCS_JSON).expect(200);
    const schemas = (
      res.body as {
        components: {
          schemas: Record<
            string,
            {
              properties?: Record<
                string,
                { type?: string; $ref?: string; oneOf?: unknown[] }
              >;
            }
          >;
        };
      }
    ).components.schemas;

    const untyped = Object.entries(schemas).flatMap(([name, schema]) =>
      Object.entries(schema.properties ?? {})
        .filter(([, property]) => property.type === 'object')
        .map(([property]) => `${name}.${property}`),
    );
    expect(untyped).toEqual(['StatsOverviewDto.byStatus']);

    const withoutType = Object.entries(schemas).flatMap(([name, schema]) =>
      Object.entries(schema.properties ?? {})
        .filter(
          ([, property]) =>
            property.type === undefined &&
            property.$ref === undefined &&
            property.oneOf === undefined,
        )
        .map(([property]) => `${name}.${property}`),
    );
    expect(withoutType).toEqual([]);
  });

  it('n’expose aucune valeur de configuration', async () => {
    const res = await request(app.getHttpServer()).get(DOCS_JSON).expect(200);
    const config = app.get<ConfigService<Env, true>>(ConfigService);

    for (const key of SECRET_KEYS) {
      const value = String(config.get(key, { infer: true }));
      expect(res.text, key).not.toContain(value);
    }
  });
});

describe('Swagger en production (e2e)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    // NODE_ENV=production pour la seule application de ce bloc.
    const get = ConfigService.prototype.get as (
      this: ConfigService,
      ...args: unknown[]
    ) => unknown;
    vi.spyOn(ConfigService.prototype, 'get').mockImplementation(function (
      this: ConfigService,
      ...args: unknown[]
    ) {
      return args[0] === 'NODE_ENV' ? 'production' : get.apply(this, args);
    });
    app = await createApp((builder) =>
      builder
        .overrideProvider(PARAMS_PROVIDER_TOKEN)
        .useValue({ pinoHttp: { level: 'silent' } }),
    );
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await app.close();
  });

  it.each([DOCS, DOCS_JSON, `${DOCS}-yaml`])('%s répond 404', async (path) => {
    await request(app.getHttpServer()).get(path).expect(404);
  });

  it('l’API reste servie', async () => {
    await request(app.getHttpServer()).get('/api/v1/health').expect(200);
  });
});
