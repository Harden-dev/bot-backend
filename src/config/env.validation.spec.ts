import { Injectable } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { envValidationSchema, type Env } from './env.validation.js';

const VALID_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  TZ: 'Africa/Abidjan',
  DATABASE_URL: 'mysql://user:pass@127.0.0.1:3306/commandes_test',
  JWT_SECRET: 'a'.repeat(32),
  CORS_ORIGIN: 'http://localhost:5173',
  META_APP_SECRET: 'meta-secret',
  WEBHOOK_VERIFY_TOKEN: 'verify-token',
  WHATSAPP_TOKEN: 'whatsapp-token',
  PHONE_NUMBER_ID: '123',
  WABA_ID: '456',
  GRAPH_API_VERSION: 'v1.0',
  ADMIN_EMAIL: 'admin@example.com',
  ADMIN_NAME: 'Admin',
  ADMIN_PASSWORD: 'a'.repeat(12),
  RECEIPT_COMPANY_NAME: 'Société',
};

const REQUIRED_KEYS = Object.keys(VALID_ENV);

function validate(env: Record<string, string>) {
  return envValidationSchema.validate(env, {
    abortEarly: false,
    allowUnknown: true,
  });
}

@Injectable()
class ConfigConsumer {
  constructor(readonly config: ConfigService<Env, true>) {}
}

describe('envValidationSchema', () => {
  it('accepte une configuration complète et applique les valeurs par défaut', () => {
    const { error, value } = validate(VALID_ENV);

    expect(error).toBeUndefined();
    expect(value).toMatchObject({
      PORT: 3000,
      DRAFT_TTL_MINUTES: 30,
      RECEIPT_FORMAT: 'A5',
      JWT_EXPIRES_IN: '8h',
    });
  });

  it.each(REQUIRED_KEYS)('refuse la configuration si %s manque', (key) => {
    const env = { ...VALID_ENV };
    delete env[key];

    const { error } = validate(env);

    expect(error?.message).toContain(`"${key}" is required`);
  });

  it('liste toutes les variables manquantes à la fois', () => {
    const { error } = validate({});

    expect(error?.details).toHaveLength(REQUIRED_KEYS.length);
  });

  it.each([
    ['NODE_ENV', 'staging'],
    ['DATABASE_URL', 'postgres://u:p@localhost/db'],
    ['JWT_SECRET', 'trop-court'],
    ['CORS_ORIGIN', 'pas-une-url'],
    ['CORS_ORIGIN', 'https://admin.example.com/'],
    ['CORS_ORIGIN', 'https://admin.example.com/backoffice'],
    ['GRAPH_API_VERSION', '21'],
    ['ADMIN_EMAIL', 'pas-un-email'],
    ['ADMIN_PASSWORD', 'a'.repeat(11)],
    ['RECEIPT_FORMAT', 'A4'],
    ['DRAFT_TTL_MINUTES', '0'],
    ['PORT', 'abc'],
    ['JWT_EXPIRES_IN', '28800'],
    ['JWT_EXPIRES_IN', 'abc'],
  ])('refuse une valeur invalide pour %s', (key, value) => {
    const { error } = validate({ ...VALID_ENV, [key]: value });

    const invalidKeys = new Set(
      error?.details.map((detail) => detail.context?.key),
    );
    expect([...invalidKeys]).toEqual([key]);
  });
});

describe('envValidationSchema : JWT_EXPIRES_IN', () => {
  it.each(['8h', '30m', '3600s', '1d'])('accepte la durée %s', (duration) => {
    expect(
      validate({ ...VALID_ENV, JWT_EXPIRES_IN: duration }).error,
    ).toBeUndefined();
  });
});

describe('envValidationSchema : CORS_ORIGIN', () => {
  it.each(['http://localhost:5173', 'https://admin.example.com'])(
    'accepte l’origine %s',
    (origin) => {
      expect(
        validate({ ...VALID_ENV, CORS_ORIGIN: origin }).error,
      ).toBeUndefined();
    },
  );
});

describe('envValidationSchema : CORS_ORIGIN en production (B-06)', () => {
  const production = { ...VALID_ENV, NODE_ENV: 'production' };

  it('exige https://', () => {
    const { error } = validate({
      ...production,
      CORS_ORIGIN: 'http://admin.example.com',
    });

    expect(error?.message).toContain('CORS_ORIGIN');
  });

  it('accepte une origine https://', () => {
    expect(
      validate({ ...production, CORS_ORIGIN: 'https://admin.example.com' })
        .error,
    ).toBeUndefined();
  });

  it('refuse toujours un chemin après l’origine', () => {
    expect(
      validate({ ...production, CORS_ORIGIN: 'https://admin.example.com/' })
        .error,
    ).toBeDefined();
  });
});

describe('ConfigModule avec le schéma Joi', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('refuse de démarrer s’il manque une variable', async () => {
    const env = { ...VALID_ENV };
    delete env.JWT_SECRET;
    vi.stubEnv('JWT_SECRET', undefined);
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);

    await expect(
      Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({
            ignoreEnvFile: true,
            validationSchema: envValidationSchema,
          }),
        ],
      }).compile(),
    ).rejects.toThrow(/"JWT_SECRET" is required/);
  });

  // Premier module Nest compilé du fichier : démarrage à froid, parfois plus
  // de 5 s sous charge (suite complète en parallèle).
  it(
    'injecte ConfigService typé par le constructeur (V-1)',
    { timeout: 20_000 },
    async () => {
      for (const [key, value] of Object.entries(VALID_ENV))
        vi.stubEnv(key, value);
      vi.stubEnv('PORT', undefined);

      const moduleRef = await Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({
            ignoreEnvFile: true,
            validationSchema: envValidationSchema,
          }),
        ],
        providers: [ConfigConsumer],
      }).compile();

      const consumer = moduleRef.get(ConfigConsumer);
      expect(consumer.config).toBeInstanceOf(ConfigService);
      expect(consumer.config.get('PORT', { infer: true })).toBe(3000);
      expect(consumer.config.get('DRAFT_TTL_MINUTES', { infer: true })).toBe(
        30,
      );
    },
  );
});
