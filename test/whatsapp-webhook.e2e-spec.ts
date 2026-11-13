import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { MockInstance } from 'vitest';
import type { Env } from '../src/config/index.js';
import { PrismaService } from '../src/prisma/index.js';
import { WhatsappClient } from '../src/whatsapp/client/index.js';
import { MESSAGE_HANDLER } from '../src/whatsapp/index.js';
import { PROCESSING_ERROR_MESSAGE } from '../src/bot/index.js';
import { MessageProcessor } from '../src/whatsapp/message-processor.js';
import { WebhookLogsCleanup } from '../src/whatsapp/webhook-logs.cleanup.js';
import { createApp } from './helpers/create-app.js';
import { resetDb } from './helpers/reset-db.js';
import { signMetaBody } from './helpers/sign.js';

const WEBHOOK = '/api/v1/whatsapp/webhook';
const FROM = '2250707070707';
const DAY_MS = 24 * 60 * 60 * 1000;

function textPayload(wamid: string, body = 'Bonjour') {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'waba-id',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              contacts: [{ wa_id: FROM, profile: { name: 'Awa' } }],
              messages: [
                {
                  id: wamid,
                  from: FROM,
                  timestamp: '1763000000',
                  type: 'text',
                  text: { body },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

describe('Webhook WhatsApp (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let appSecret: string;
  let verifyToken: string;
  let processSpy: MockInstance<MessageProcessor['process']>;
  const handler = { handle: vi.fn() };
  const client = { sendText: vi.fn(), sendButtons: vi.fn() };

  const api = () => request(app.getHttpServer());

  function post(body: string, signature?: string) {
    const req = api().post(WEBHOOK).set('Content-Type', 'application/json');
    if (signature !== undefined) {
      req.set('X-Hub-Signature-256', signature);
    }
    return req.send(body);
  }

  function postSigned(payload: unknown) {
    const body = JSON.stringify(payload);
    return post(body, signMetaBody(body, appSecret));
  }

  /** Attend la fin de tous les traitements lancés après les réponses. */
  async function processed(): Promise<void> {
    await Promise.all(processSpy.mock.results.map((result) => result.value));
  }

  beforeAll(async () => {
    app = await createApp((builder) =>
      builder
        .overrideProvider(WhatsappClient)
        .useValue(client)
        .overrideProvider(MESSAGE_HANDLER)
        .useValue(handler),
    );
    prisma = app.get(PrismaService);
    const config = app.get<ConfigService<Env, true>>(ConfigService);
    appSecret = config.get('META_APP_SECRET', { infer: true });
    verifyToken = config.get('WEBHOOK_VERIFY_TOKEN', { infer: true });
    processSpy = vi.spyOn(app.get(MessageProcessor), 'process');
  });

  beforeEach(async () => {
    await resetDb(prisma);
    processSpy.mockClear();
    handler.handle.mockReset().mockResolvedValue(undefined);
    client.sendText.mockReset().mockResolvedValue(undefined);
    client.sendButtons.mockReset();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /api/v1/whatsapp/webhook', () => {
    it('renvoie le challenge en texte brut, sans JWT', async () => {
      const res = await api()
        .get(WEBHOOK)
        .query({
          'hub.mode': 'subscribe',
          'hub.verify_token': verifyToken,
          'hub.challenge': '1158201444',
        })
        .expect(200);

      expect(res.text).toBe('1158201444');
      expect(res.headers['content-type']).toMatch(/^text\/plain/);
      await expect(prisma.webhookLog.count()).resolves.toBe(0);
    });

    // Requêtes construites à l'exécution : le jeton n'est connu qu'après beforeAll.
    it.each([
      [
        'un jeton différent',
        () => ({
          'hub.mode': 'subscribe',
          'hub.verify_token': 'faux',
          'hub.challenge': 'c',
        }),
      ],
      [
        'un mode différent',
        () => ({
          'hub.mode': 'unsubscribe',
          'hub.verify_token': verifyToken,
          'hub.challenge': 'c',
        }),
      ],
      [
        'le bon jeton sans hub.challenge',
        () => ({ 'hub.mode': 'subscribe', 'hub.verify_token': verifyToken }),
      ],
      ['aucun paramètre', () => ({})],
    ])('refuse en 403 %s', async (_label, query) => {
      await api().get(WEBHOOK).query(query()).expect(403);
    });
  });

  describe('POST /api/v1/whatsapp/webhook', () => {
    it('accepte un POST signé, le journalise puis transmet le message', async () => {
      const payload = textPayload('wamid.A1');

      const res = await postSigned(payload).expect(200);
      await processed();

      expect(res.text).toBe('');
      const logs = await prisma.webhookLog.findMany();
      expect(logs).toEqual([
        expect.objectContaining({ signatureValid: true, payload }),
      ]);
      await expect(
        prisma.processedMessage.count({ where: { wamid: 'wamid.A1' } }),
      ).resolves.toBe(1);
      expect(handler.handle).toHaveBeenCalledExactlyOnceWith({
        wamid: 'wamid.A1',
        from: FROM,
        type: 'text',
        text: 'Bonjour',
      });
    });

    it('répond 200 avant la fin du traitement', async () => {
      let release: () => void = () => {};
      handler.handle.mockReturnValue(
        new Promise<void>((resolve) => {
          release = resolve;
        }),
      );

      await postSigned(textPayload('wamid.LENT')).expect(200);
      await vi.waitFor(() => expect(handler.handle).toHaveBeenCalledOnce());

      release();
      await processed();
    });

    it('refuse un POST non signé : 403, signature_valid = 0, aucun traitement', async () => {
      const payload = textPayload('wamid.B1');

      await post(JSON.stringify(payload)).expect(403);

      const logs = await prisma.webhookLog.findMany();
      expect(logs).toEqual([
        expect.objectContaining({ signatureValid: false, payload }),
      ]);
      expect(processSpy).not.toHaveBeenCalled();
      await expect(prisma.processedMessage.count()).resolves.toBe(0);
    });

    it('refuse une signature falsifiée : 403, signature_valid = 0', async () => {
      const body = JSON.stringify(textPayload('wamid.C1'));

      await post(body, signMetaBody(body, 'autre-secret')).expect(403);

      await expect(
        prisma.webhookLog.count({ where: { signatureValid: false } }),
      ).resolves.toBe(1);
      expect(processSpy).not.toHaveBeenCalled();
    });

    it('refuse un corps modifié d’un seul octet après signature', async () => {
      const body = JSON.stringify(textPayload('wamid.D1', 'Bonjour'));
      const signature = signMetaBody(body, appSecret);

      await post(body.replace('Bonjour', 'Bonjouq'), signature).expect(403);

      await expect(
        prisma.webhookLog.count({ where: { signatureValid: false } }),
      ).resolves.toBe(1);
      expect(processSpy).not.toHaveBeenCalled();
    });

    it('refuse une signature de longueur différente sans erreur 500', async () => {
      const body = JSON.stringify(textPayload('wamid.E1'));

      await post(body, `${signMetaBody(body, appSecret)}00`).expect(403);
      await post(body, 'sha256=abc').expect(403);
    });

    it('refuse un POST signé en text/plain : 403, journalisé avec {}', async () => {
      const body = JSON.stringify(textPayload('wamid.T1'));

      await api()
        .post(WEBHOOK)
        .set('Content-Type', 'text/plain')
        .set('X-Hub-Signature-256', signMetaBody(body, appSecret))
        .send(body)
        .expect(403);

      const logs = await prisma.webhookLog.findMany();
      expect(logs).toEqual([
        expect.objectContaining({ signatureValid: false, payload: {} }),
      ]);
      expect(processSpy).not.toHaveBeenCalled();
    });

    it('tronque à 4 ko le payload journalisé d’un POST non signé', async () => {
      const body = JSON.stringify({ data: 'x'.repeat(10_000) });

      await post(body).expect(403);

      const [log] = await prisma.webhookLog.findMany();
      expect(log.payload).toMatchObject({
        truncated: true,
        size: Buffer.byteLength(body),
      });
      expect(
        Buffer.byteLength(JSON.stringify(log.payload)),
      ).toBeLessThanOrEqual(4096);
    });

    it('ne traite qu’une fois un même wamid reçu deux fois simultanément', async () => {
      const payload = textPayload('wamid.SIMULT');

      await Promise.all([
        postSigned(payload).expect(200),
        postSigned(payload).expect(200),
      ]);
      await processed();

      expect(handler.handle).toHaveBeenCalledOnce();
      await expect(prisma.processedMessage.count()).resolves.toBe(1);
      await expect(prisma.webhookLog.count()).resolves.toBe(2);
    });

    it('traite les messages valides d’un payload contenant un message mal formé (PO-29)', async () => {
      const payload = textPayload('wamid.OK');
      payload.entry[0].changes[0].value.messages.unshift({
        id: 'w'.repeat(121),
        from: FROM,
        timestamp: '1763000000',
        type: 'text',
        text: { body: 'x' },
      });

      await postSigned(payload).expect(200);
      await processed();

      expect(handler.handle).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ wamid: 'wamid.OK' }),
      );
      await expect(prisma.processedMessage.count()).resolves.toBe(1);
    });

    it('ne traite qu’une fois un même wamid envoyé deux fois', async () => {
      const payload = textPayload('wamid.F1');

      await postSigned(payload).expect(200);
      await processed();
      await postSigned(payload).expect(200);
      await processed();

      expect(handler.handle).toHaveBeenCalledOnce();
      await expect(prisma.processedMessage.count()).resolves.toBe(1);
      await expect(prisma.webhookLog.count()).resolves.toBe(2);
    });

    it('ignore un événement ne contenant que des statuses[]', async () => {
      const payload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            changes: [
              {
                field: 'messages',
                value: {
                  statuses: [{ id: 'wamid.G1', status: 'read' }],
                },
              },
            ],
          },
        ],
      };

      await postSigned(payload).expect(200);
      await processed();

      expect(handler.handle).not.toHaveBeenCalled();
      await expect(prisma.processedMessage.count()).resolves.toBe(0);
      await expect(prisma.webhookLog.count()).resolves.toBe(1);
    });

    it('journalise un payload de structure inattendue, répond 200 et ne traite rien (PO-29)', async () => {
      await postSigned({ entry: 'inattendu' }).expect(200);
      await processed();

      expect(handler.handle).not.toHaveBeenCalled();
      await expect(
        prisma.webhookLog.count({ where: { signatureValid: true } }),
      ).resolves.toBe(1);
    });

    it('garde le 200 si le traitement échoue et prévient le vendeur (PO-24)', async () => {
      handler.handle.mockRejectedValue(new Error('échec du bot'));

      await postSigned(textPayload('wamid.H1')).expect(200);
      await processed();

      expect(client.sendText).toHaveBeenCalledExactlyOnceWith(
        FROM,
        PROCESSING_ERROR_MESSAGE,
      );
      await expect(prisma.processedMessage.count()).resolves.toBe(1);
    });

    it('rejette en 400 un corps JSON syntaxiquement invalide, avant le contrôleur', async () => {
      await post('{"entry":', 'sha256=00').expect(400);

      await expect(prisma.webhookLog.count()).resolves.toBe(0);
    });
  });

  describe('Purge de webhook_logs', () => {
    it('supprime les journaux de plus de 90 jours et conserve processed_messages (PO-25)', async () => {
      const now = new Date();
      await prisma.webhookLog.createMany({
        data: [
          {
            signatureValid: true,
            payload: { age: 91 },
            createdAt: new Date(now.getTime() - 91 * DAY_MS),
          },
          {
            signatureValid: false,
            payload: { age: 89 },
            createdAt: new Date(now.getTime() - 89 * DAY_MS),
          },
        ],
      });
      await prisma.processedMessage.create({
        data: {
          wamid: 'wamid.ANCIEN',
          receivedAt: new Date(now.getTime() - 365 * DAY_MS),
        },
      });

      await expect(app.get(WebhookLogsCleanup).purge(now)).resolves.toBe(1);

      const logs = await prisma.webhookLog.findMany();
      expect(logs.map((log) => log.payload)).toEqual([{ age: 89 }]);
      await expect(prisma.processedMessage.count()).resolves.toBe(1);
    });
  });
});
