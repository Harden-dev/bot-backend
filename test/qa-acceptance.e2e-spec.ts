import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { MockInstance } from 'vitest';
import {
  ORDER_TEMPLATE,
  orderConfirmedMessage,
  UNAUTHORIZED_MESSAGE,
} from '../src/bot/messages.js';
import type { Env } from '../src/config/index.js';
import { OrdersService } from '../src/orders/index.js';
import { PrismaService } from '../src/prisma/index.js';
import { WhatsappClient } from '../src/whatsapp/client/index.js';
import { MessageProcessor } from '../src/whatsapp/message-processor.js';
import { createApp, seedAdminWithToken } from './helpers/create-app.js';
import { resetDb } from './helpers/reset-db.js';
import { signMetaBody } from './helpers/sign.js';

/**
 * Tests ajoutés par la QA (QA-001) pour des critères d'acceptation non
 * couverts ou couverts seulement en partie par les suites existantes.
 */

const WEBHOOK = '/api/v1/whatsapp/webhook';
const ORDER_TEXT = [
  'Nom: Awa Koné',
  'Téléphone: 07 07 07 07 07',
  'Lieu: Cocody Angré 8e tranche',
  'Articles: 2 robes bleues x 15000, 1 sac noir x 8000',
].join('\n');

const ORDER_INPUT = {
  customerName: 'Client QA',
  customerPhone: '0707070707',
  deliveryLocation: 'Cocody',
  items: [{ label: 'sac', quantity: 2, unitPrice: 1_500 }],
};

// Les 14 routes protégées (US-AUTH-03) ; les 4 publiques sont testées à part.
const PROTECTED_ROUTES = [
  ['get', '/api/v1/auth/me'],
  ['get', '/api/v1/vendors'],
  ['post', '/api/v1/vendors'],
  ['patch', '/api/v1/vendors/1'],
  ['get', '/api/v1/orders'],
  ['get', '/api/v1/orders/counts'],
  ['get', '/api/v1/orders/1'],
  ['patch', '/api/v1/orders/1'],
  ['patch', '/api/v1/orders/1/status'],
  ['get', '/api/v1/receipts/1'],
  ['post', '/api/v1/receipts/batch'],
  ['get', '/api/v1/stats/overview'],
  ['get', '/api/v1/stats/by-vendor'],
  ['get', '/api/v1/stats/by-day'],
] as const;

const CAMEL_CASE = /^[a-z][a-zA-Z0-9]*$/;

/** Clés JSON qui ne sont pas en camelCase (hors exceptions actées N-36). */
function nonCamelKeys(value: unknown, path = '$'): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, i) => nonCamelKeys(item, `${path}[${i}]`));
  }
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) => {
    // Exception camelCase actée (N-36, N-58) : clés = valeurs de statut.
    if (key === 'byStatus') return [];
    const own = CAMEL_CASE.test(key) ? [] : [`${path}.${key}`];
    return [...own, ...nonCamelKeys(child, `${path}.${key}`)];
  });
}

describe('QA : critères complémentaires (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let token: string;
  let appSecret: string;
  let corsOrigin: string;
  let processSpy: MockInstance<MessageProcessor['process']>;
  const client = { sendText: vi.fn(), sendButtons: vi.fn() };
  let wamidSequence = 0;

  const api = () => request(app.getHttpServer());
  const auth = () => ({ Authorization: `Bearer ${token}` });

  function message(from: string, fields: Record<string, unknown>) {
    wamidSequence += 1;
    return {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                messages: [
                  {
                    id: `wamid.qa.${wamidSequence}`,
                    from,
                    timestamp: '1763000000',
                    ...fields,
                  },
                ],
              },
            },
          ],
        },
      ],
    };
  }

  async function send(body: unknown): Promise<void> {
    const raw = JSON.stringify(body);
    await api()
      .post(WEBHOOK)
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', signMetaBody(raw, appSecret))
      .send(raw)
      .expect(200);
    await Promise.all(processSpy.mock.results.map((r) => r.value));
  }

  beforeAll(async () => {
    app = await createApp((builder) =>
      builder.overrideProvider(WhatsappClient).useValue(client),
    );
    prisma = app.get(PrismaService);
    const config = app.get<ConfigService<Env, true>>(ConfigService);
    appSecret = config.get('META_APP_SECRET', { infer: true });
    corsOrigin = config.get('CORS_ORIGIN', { infer: true });
    processSpy = vi.spyOn(app.get(MessageProcessor), 'process');
  });

  beforeEach(async () => {
    await resetDb(prisma);
    token = await seedAdminWithToken(app);
    processSpy.mockClear();
    client.sendText.mockReset().mockResolvedValue(undefined);
    client.sendButtons.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('US-AUTH-03 : routes protégées et CORS', () => {
    it.each(PROTECTED_ROUTES)(
      '%s %s répond 401 sans jeton, au format { statusCode, message, error }',
      async (method, url) => {
        const res = await api()[method](url).expect(401);
        expect(res.body).toEqual({
          statusCode: 401,
          message: expect.any(String),
          error: 'Unauthorized',
        });
      },
    );

    it('les 4 routes publiques répondent sans jeton (jamais 401)', async () => {
      await api().get('/api/v1/health').expect(200);
      await api()
        .get(WEBHOOK)
        .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'faux' })
        .expect(403);
      await api().post(WEBHOOK).send({}).expect(403);
      await api()
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', '203.0.113.250')
        .send({ email: 'inconnu@example.com', password: 'x' })
        .expect(401); // identifiants faux, pas jeton manquant
    });

    it('CORS : seule CORS_ORIGIN est autorisée par le navigateur', async () => {
      const allowed = await api()
        .options('/api/v1/orders')
        .set('Origin', corsOrigin)
        .set('Access-Control-Request-Method', 'GET')
        .set('Access-Control-Request-Headers', 'authorization');
      expect(allowed.status).toBe(204);
      expect(allowed.headers['access-control-allow-origin']).toBe(corsOrigin);

      const foreign = 'https://evil.example.com';
      const preflight = await api()
        .options('/api/v1/orders')
        .set('Origin', foreign)
        .set('Access-Control-Request-Method', 'GET');
      expect(preflight.headers['access-control-allow-origin']).not.toBe(
        foreign,
      );
      expect(preflight.headers['access-control-allow-origin']).not.toBe('*');

      const simple = await api()
        .get('/api/v1/health')
        .set('Origin', foreign)
        .expect(200);
      expect(simple.headers['access-control-allow-origin']).not.toBe(foreign);
      expect(simple.headers['access-control-allow-origin']).not.toBe('*');
    });
  });

  describe('US-CMD-01 / US-CMD-02 : référence journalière', () => {
    it('3e commande du 10/11/2026 = CMD-20261110-003, puis 001 le lendemain, recherche par préfixe', async () => {
      const orders = app.get(OrdersService);
      const vendor = await prisma.vendor.create({
        data: { name: 'V', whatsappNumber: '2250707070707' },
      });
      // Seule l'horloge Date est simulée (pas les timers : I/O MySQL réelles).
      vi.useFakeTimers({ toFake: ['Date'] });

      vi.setSystemTime(new Date('2026-11-10T09:00:00.000Z'));
      const day1: Awaited<ReturnType<OrdersService['create']>>[] = [];
      for (let i = 0; i < 3; i += 1) {
        day1.push(await orders.create({ ...ORDER_INPUT, vendorId: vendor.id }));
      }
      vi.setSystemTime(new Date('2026-11-11T00:00:00.500Z'));
      const day2 = await orders.create({ ...ORDER_INPUT, vendorId: vendor.id });
      vi.useRealTimers();

      expect(day1.map((o) => o.reference)).toEqual([
        'CMD-20261110-001',
        'CMD-20261110-002',
        'CMD-20261110-003',
      ]);
      expect(day2.reference).toBe('CMD-20261111-001');
      expect(day2.totalAmount).toBe(3_000); // 2 × 1 500, calculé serveur

      const res = await api()
        .get('/api/v1/orders')
        .query({ search: 'CMD-20261110' })
        .set(auth())
        .expect(200);
      expect(
        (res.body.data as { reference: string }[]).map((o) => o.reference),
      ).toEqual(['CMD-20261110-003', 'CMD-20261110-002', 'CMD-20261110-001']);
      expect(res.body.meta).toEqual({ page: 1, limit: 20, total: 3 });
    });
  });

  describe('US-VEN-02 / US-VEN-03 : vendeur créé par l’API et bot', () => {
    it('reconnu par le bot après création, refusé après désactivation, commandes conservées', async () => {
      const created = await api()
        .post('/api/v1/vendors')
        .set(auth())
        .send({ name: 'Boutique QA', whatsappNumber: '+225 07-07.07 07 07' })
        .expect(201);
      expect(created.body).toMatchObject({
        whatsappNumber: '2250707070707',
        isActive: true,
      });
      const from = created.body.whatsappNumber as string;

      await send(message(from, { type: 'text', text: { body: 'modele' } }));
      expect(client.sendText).toHaveBeenLastCalledWith(from, ORDER_TEMPLATE);

      await send(message(from, { type: 'text', text: { body: ORDER_TEXT } }));
      const buttons = client.sendButtons.mock.lastCall?.[2] as {
        id: string;
      }[];
      expect(buttons.map((b) => b.id.split(':')[0])).toEqual([
        'valider',
        'modifier',
        'annuler',
      ]);
      await send(
        message(from, {
          type: 'interactive',
          interactive: {
            type: 'button_reply',
            button_reply: { id: buttons[0].id, title: 'Valider' },
          },
        }),
      );
      const order = await prisma.order.findFirstOrThrow();
      expect(order.totalAmount).toBe(38_000);
      expect(client.sendText).toHaveBeenLastCalledWith(
        from,
        orderConfirmedMessage(order.reference),
      );

      await api()
        .patch(`/api/v1/vendors/${created.body.id}`)
        .set(auth())
        .send({ isActive: false })
        .expect(200);
      client.sendText.mockClear();
      client.sendButtons.mockClear();
      await send(message(from, { type: 'text', text: { body: ORDER_TEXT } }));
      expect(client.sendText.mock.calls).toEqual([
        [from, UNAUTHORIZED_MESSAGE],
      ]);
      expect(client.sendButtons).not.toHaveBeenCalled();
      await expect(prisma.orderDraft.count()).resolves.toBe(1);

      // Les anciennes commandes restent consultables et rattachées.
      const detail = await api()
        .get(`/api/v1/orders/${order.id}`)
        .set(auth())
        .expect(200);
      expect(detail.body.vendor).toEqual({
        id: created.body.id,
        name: 'Boutique QA',
      });
      const list = await api()
        .get('/api/v1/orders')
        .query({ vendorId: created.body.id })
        .set(auth())
        .expect(200);
      expect(list.body.meta.total).toBe(1);
    });
  });

  describe('Conventions d’API', () => {
    it('réponses JSON en camelCase (hors exceptions byStatus / counts actées)', async () => {
      const vendor = await prisma.vendor.create({
        data: { name: 'V', whatsappNumber: '2250707070707' },
      });
      const order = await app
        .get(OrdersService)
        .create({ ...ORDER_INPUT, vendorId: vendor.id, notes: 'n' });
      await api()
        .patch(`/api/v1/orders/${order.id}/status`)
        .set(auth())
        .send({ status: 'validee', comment: 'ok' })
        .expect(200);

      const urls = [
        '/api/v1/auth/me',
        '/api/v1/vendors',
        '/api/v1/orders',
        `/api/v1/orders/${order.id}`,
        '/api/v1/stats/overview',
        '/api/v1/stats/by-vendor',
        '/api/v1/stats/by-day',
        '/api/v1/health',
      ];
      for (const url of urls) {
        const res = await api().get(url).set(auth()).expect(200);
        expect({ url, keys: nonCamelKeys(res.body) }).toEqual({
          url,
          keys: [],
        });
      }
    });

    it.each([
      ['404', 'get', '/api/v1/orders/999', undefined, 404, 'Not Found'],
      ['400', 'get', '/api/v1/orders?limit=101', undefined, 400, 'Bad Request'],
      [
        '400 (champ interdit)',
        'post',
        '/api/v1/vendors',
        { name: 'X', whatsappNumber: '0707070707', isAdmin: true },
        400,
        'Bad Request',
      ],
    ] as const)(
      'erreur %s au format { statusCode, message, error }',
      async (_label, method, url, body, status, error) => {
        const res = await api()
          [method](url)
          .set(auth())
          .send(body)
          .expect(status);
        expect(res.body).toEqual({
          statusCode: status,
          message: expect.anything(),
          error,
        });
      },
    );

    it('erreur 409 au format { statusCode, message, error }', async () => {
      const vendor = await prisma.vendor.create({
        data: { name: 'V', whatsappNumber: '2250707070707' },
      });
      const order = await app
        .get(OrdersService)
        .create({ ...ORDER_INPUT, vendorId: vendor.id });
      const res = await api()
        .patch(`/api/v1/orders/${order.id}/status`)
        .set(auth())
        .send({ status: 'livree' })
        .expect(409);
      expect(res.body).toEqual({
        statusCode: 409,
        message: expect.any(String),
        error: 'Conflict',
      });
    });
  });

  describe('Montants (XOF entiers, US-CMD-05)', () => {
    it.each([
      [{ label: 'A', quantity: 1, unitPrice: 0 }],
      [{ label: 'A', quantity: 1, unitPrice: -1_000 }],
      [{ label: 'A', quantity: 1, unitPrice: 1_500.5 }],
      [{ label: 'A', quantity: 1, unitPrice: '15000' }],
      [{ label: 'A', quantity: -1, unitPrice: 1_000 }],
      [{ label: 'A', quantity: 1.5, unitPrice: 1_000 }],
      [{ label: 'A', quantity: 1_000, unitPrice: 1 }],
      [{ label: '', quantity: 1, unitPrice: 1 }],
    ])('refuse l’article %j en 400 sans modifier la commande', async (item) => {
      const vendor = await prisma.vendor.create({
        data: { name: 'V', whatsappNumber: '2250707070707' },
      });
      const order = await app
        .get(OrdersService)
        .create({ ...ORDER_INPUT, vendorId: vendor.id });

      await api()
        .patch(`/api/v1/orders/${order.id}`)
        .set(auth())
        .send({ items: [item] })
        .expect(400);

      await expect(
        prisma.order.findUniqueOrThrow({
          where: { id: order.id },
          include: { items: true },
        }),
      ).resolves.toMatchObject({
        totalAmount: 3_000,
        items: [{ label: 'sac', quantity: 2, unitPrice: 1_500 }],
      });
    });

    it('recalcule le total côté serveur au remplacement des articles', async () => {
      const vendor = await prisma.vendor.create({
        data: { name: 'V', whatsappNumber: '2250707070707' },
      });
      const order = await app
        .get(OrdersService)
        .create({ ...ORDER_INPUT, vendorId: vendor.id });

      const res = await api()
        .patch(`/api/v1/orders/${order.id}`)
        .set(auth())
        .send({
          items: [
            { label: 'robe', quantity: 2, unitPrice: 15_000 },
            { label: 'sac', quantity: 1, unitPrice: 8_000 },
          ],
        })
        .expect(200);
      expect(res.body.totalAmount).toBe(38_000);
    });
  });
});
