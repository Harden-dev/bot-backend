import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { Env } from '../src/config/index.js';
import { PrismaService } from '../src/prisma/index.js';
import { WhatsappClient } from '../src/whatsapp/client/index.js';
import { UNSIGNED_LOG_LIMIT_PER_MINUTE } from '../src/whatsapp/unsigned-log-budget.js';
import { UNSIGNED_LOG_PREVIEW_BYTES } from '../src/whatsapp/webhook.service.js';
import { createApp } from './helpers/create-app.js';
import { resetDb } from './helpers/reset-db.js';
import { signMetaBody } from './helpers/sign.js';

const WEBHOOK = '/api/v1/whatsapp/webhook';

/** Application neuve : le plafond des POST non signés est propre à l'instance. */
async function startApp(): Promise<NestExpressApplication> {
  const app = await createApp((builder) =>
    builder
      .overrideProvider(WhatsappClient)
      .useValue({ sendText: vi.fn(), sendButtons: vi.fn() }),
  );
  await resetDb(app.get(PrismaService));
  return app;
}

function postUnsigned(app: NestExpressApplication, body: string) {
  return request(app.getHttpServer())
    .post(WEBHOOK)
    .set('Content-Type', 'application/json')
    .send(body);
}

describe('POST non signés : aperçu seul (e2e, H-01, B-05)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await startApp();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDb(prisma);
  });

  afterAll(async () => {
    await resetDb(prisma);
    await app.close();
  });

  it.each([101, 1_000])(
    'refuse en 403 et journalise un JSON imbriqué sur %i niveaux (plus de 500)',
    async (depth) => {
      const body = '['.repeat(depth) + ']'.repeat(depth);

      await postUnsigned(app, body).expect(403);

      const logs = await prisma.webhookLog.findMany();
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        signatureValid: false,
        payload: {
          unsigned: true,
          size: 2 * depth,
          preview: body.slice(0, UNSIGNED_LOG_PREVIEW_BYTES),
        },
      });
    },
  );

  it('limite l’aperçu à 256 octets, sans couper un caractère', async () => {
    const body = JSON.stringify({ texte: 'é'.repeat(5_000) });

    await postUnsigned(app, body).expect(403);

    const [log] = await prisma.webhookLog.findMany();
    const { preview, size } = log.payload as { preview: string; size: number };
    expect(size).toBe(Buffer.byteLength(body));
    expect(Buffer.byteLength(preview)).toBeLessThanOrEqual(
      UNSIGNED_LOG_PREVIEW_BYTES,
    );
    expect(body.startsWith(preview)).toBe(true);
  });
});

describe('POST non signés : plafond par minute (e2e, H-01)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await startApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await resetDb(prisma);
    await app.close();
  });

  it('n’écrit plus en base au-delà de 60 POST non signés dans la minute, garde le 403 et les POST signés', async () => {
    const extra = 15;
    for (let i = 0; i < UNSIGNED_LOG_LIMIT_PER_MINUTE + extra; i += 1) {
      await postUnsigned(app, JSON.stringify({ i })).expect(403);
    }

    await expect(
      prisma.webhookLog.count({ where: { signatureValid: false } }),
    ).resolves.toBe(UNSIGNED_LOG_LIMIT_PER_MINUTE);

    const appSecret = app
      .get<ConfigService<Env, true>>(ConfigService)
      .get('META_APP_SECRET', { infer: true });
    const signed = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [],
    });
    await postUnsigned(app, signed)
      .set('X-Hub-Signature-256', signMetaBody(signed, appSecret))
      .expect(200);
    await expect(
      prisma.webhookLog.count({ where: { signatureValid: true } }),
    ).resolves.toBe(1);
  });
});
