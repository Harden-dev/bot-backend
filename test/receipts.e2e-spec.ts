import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { Env, ReceiptFormat } from '../src/config/index.js';
import { OrdersService } from '../src/orders/index.js';
import { PrismaService } from '../src/prisma/index.js';
import { ReceiptsService } from '../src/receipts/receipts.service.js';
import { addDays } from '../src/stats/stats-period.js';
import { createApp, seedAdminWithToken } from './helpers/create-app.js';
import { binaryParser, readPdf } from './helpers/read-pdf.js';
import { resetDb } from './helpers/reset-db.js';

const PAGE_WIDTH: Record<ReceiptFormat, number> = {
  A5: 419.53,
  TICKET80: 226.77,
};

/** Reçus : jamais mis en cache, type MIME non deviné. */
function expectNoCacheHeaders(headers: Record<string, string>): void {
  expect(headers['cache-control']).toBe('no-store');
  expect(headers['x-content-type-options']).toBe('nosniff');
}

/** Application dont `RECEIPT_FORMAT` est imposé (le reste de la config est réel). */
function createAppWithFormat(format: ReceiptFormat) {
  return createApp((builder) =>
    builder.overrideProvider(ReceiptsService).useFactory({
      factory: (orders: OrdersService, config: ConfigService<Env, true>) =>
        new ReceiptsService(orders, {
          get: (key: keyof Env) =>
            key === 'RECEIPT_FORMAT' ? format : config.get(key),
        } as ConfigService<Env, true>),
      inject: [OrdersService, ConfigService],
    }),
  );
}

describe.each<ReceiptFormat>(['A5', 'TICKET80'])(
  'Receipts (e2e, %s)',
  (format) => {
    let app: NestExpressApplication;
    let prisma: PrismaService;
    let token: string;
    let companyName: string;
    let ids: number[];
    let references: string[];

    const api = () => request(app.getHttpServer());
    const auth = () => ({ Authorization: `Bearer ${token}` });

    const getPdf = (orderId: number | string) =>
      api()
        .get(`/api/v1/receipts/${orderId}`)
        .set(auth())
        .buffer(true)
        .parse(binaryParser);

    const postBatch = (orderIds: unknown) =>
      api()
        .post('/api/v1/receipts/batch')
        .set(auth())
        .send({ orderIds })
        .buffer(true)
        .parse(binaryParser);

    beforeAll(async () => {
      app = await createAppWithFormat(format);
      prisma = app.get(PrismaService);
      companyName = app
        .get<ConfigService<Env, true>>(ConfigService)
        .get('RECEIPT_COMPANY_NAME', { infer: true });
    });

    beforeEach(async () => {
      await resetDb(prisma);
      token = await seedAdminWithToken(app);
      const vendor = await prisma.vendor.create({
        data: { name: 'Boutique Awa', whatsappNumber: '2250707070707' },
      });
      const orders = app.get(OrdersService);
      const created = [];
      for (const name of ['Aya Kouassi', 'Koffi Yao', 'Adjoua Konan']) {
        created.push(
          await orders.create({
            vendorId: vendor.id,
            customerName: name,
            customerPhone: '0707070707',
            deliveryLocation: 'Cocody Angré, près de la pharmacie',
            notes: 'Appeler avant — portail bleu',
            items: [
              { label: 'Robe wax', quantity: 2, unitPrice: 15_000 },
              { label: 'Sac à main', quantity: 1, unitPrice: 8_000 },
            ],
          }),
        );
      }
      ids = created.map((order) => Number(order.id));
      references = created.map((order) => order.reference);
      // Une commande annulée reste imprimable (PO-19).
      await prisma.order.update({
        where: { id: created[2].id },
        data: { status: 'annulee' },
      });
    });

    afterAll(async () => {
      await app.close();
    });

    describe('GET /api/v1/receipts/:orderId', () => {
      it('renvoie le reçu PDF complet, nommé par la référence', async () => {
        const res = await getPdf(ids[0]).expect(200);

        expect(res.headers['content-type']).toBe('application/pdf');
        expect(res.headers['content-disposition']).toBe(
          `inline; filename="${references[0]}.pdf"`,
        );
        expectNoCacheHeaders(res.headers);
        const pdf = await readPdf(res.body as Buffer);
        expect(pdf.header).toBe('%PDF-');
        expect(pdf.pages).toHaveLength(1);
        expect(pdf.pages[0].width).toBeCloseTo(PAGE_WIDTH[format], 1);
        for (const expected of [
          companyName,
          references[0],
          'Créée le ',
          'Boutique Awa',
          'Aya Kouassi',
          '0707070707',
          'Cocody Angré, près de la pharmacie',
          'Robe wax',
          '15 000 F',
          '30 000 F',
          'Sac à main',
          'Total : 38 000 F',
          'Appeler avant — portail bleu',
        ]) {
          expect(pdf.pages[0].text).toContain(expected);
        }
      });

      it('répond 404 pour une commande inconnue et 400 pour un identifiant invalide', async () => {
        const notFound = await api()
          .get('/api/v1/receipts/999')
          .set(auth())
          .expect(404);
        expect(notFound.body.message).toBe('Commande introuvable');

        await api().get('/api/v1/receipts/abc').set(auth()).expect(400);
        await api().get('/api/v1/receipts/0').set(auth()).expect(400);
      });

      it('répond 401 sans jeton', async () => {
        await api().get(`/api/v1/receipts/${ids[0]}`).expect(401);
      });
    });

    describe('POST /api/v1/receipts/batch (PO-19)', () => {
      it("renvoie un seul PDF, un reçu par page, dans l'ordre reçu, sans doublon", async () => {
        const order = [ids[2], ids[0], ids[2], ids[1], ids[0]];

        const today = new Date().toISOString().slice(0, 10);
        const res = await postBatch(order).expect(200);

        expect(res.headers['content-type']).toBe('application/pdf');
        // Jour UTC de la génération (le test peut passer minuit).
        const filenames = [today, addDays(today, 1)].map(
          (day) => `inline; filename="recus-${day.replaceAll('-', '')}.pdf"`,
        );
        expect(filenames).toContain(res.headers['content-disposition']);
        expectNoCacheHeaders(res.headers);
        const pdf = await readPdf(res.body as Buffer);
        expect(pdf.header).toBe('%PDF-');
        expect(pdf.pages).toHaveLength(3);
        [references[2], references[0], references[1]].forEach(
          (reference, page) => {
            expect(pdf.pages[page].text).toContain(reference);
            expect(pdf.pages[page].width).toBeCloseTo(PAGE_WIDTH[format], 1);
          },
        );
      });

      it('répond 404 sans rien générer si un identifiant est inconnu', async () => {
        const res = await api()
          .post('/api/v1/receipts/batch')
          .set(auth())
          .send({ orderIds: [ids[0], 999] })
          .expect(404);

        expect(res.headers['content-type']).toContain('application/json');
        expect(res.body.message).toBe('Commande introuvable');
      });

      it('limite du DTO : accepte 100 identifiants (doublons compris) et refuse 0, 101 ou des valeurs invalides en 400', async () => {
        const hundred = Array.from(
          { length: 100 },
          (_, index) => ids[index % 3],
        );
        const ok = await postBatch(hundred).expect(200);
        expect((await readPdf(ok.body as Buffer)).pages).toHaveLength(3);

        for (const invalid of [
          [],
          [...hundred, ids[0]],
          [0],
          [-1],
          [1.5],
          ['1'],
          [Number.MAX_SAFE_INTEGER + 1],
          'abc',
          null,
        ]) {
          await api()
            .post('/api/v1/receipts/batch')
            .set(auth())
            .send({ orderIds: invalid })
            .expect(400);
        }
        await api()
          .post('/api/v1/receipts/batch')
          .set(auth())
          .send({ orderIds: [ids[0]], extra: true })
          .expect(400);
      });

      it(
        'performance : 100 commandes distinctes de 30 articles donnent au moins 100 pages',
        { timeout: 120_000 },
        async ({ annotate }) => {
          const orders = app.get(OrdersService);
          const vendorId = (await prisma.vendor.findFirstOrThrow()).id;
          const items = Array.from({ length: 30 }, (_, index) => ({
            label: `Pagne super wax hollandais ${index + 1}`,
            quantity: 2,
            unitPrice: 12_500,
          }));
          const hundred: number[] = [];
          for (let index = 0; index < 100; index += 1) {
            const order = await orders.create({
              vendorId,
              customerName: `Client ${index + 1}`,
              customerPhone: '0707070707',
              deliveryLocation: 'Cocody Angré, près de la pharmacie',
              notes: 'Appeler avant — portail bleu',
              items,
            });
            hundred.push(Number(order.id));
          }

          const startedAt = performance.now();
          const res = await postBatch(hundred).expect(200);
          const elapsedMs = Math.round(performance.now() - startedAt);
          const pdf = await readPdf(res.body as Buffer);
          await annotate(
            `${format} : ${pdf.pages.length} pages, ${Math.round(res.body.length / 1024)} Ko, ${elapsedMs} ms`,
          );

          expect(pdf.pages.length).toBeGreaterThanOrEqual(100);
          // Chaque reçu commence sur une nouvelle page, dans l'ordre reçu (en
          // A5, 30 articles débordent sur une page de suite, N-60 point 2).
          const firstPages = hundred.map((_, index) =>
            pdf.pages.findIndex((page) =>
              page.text.includes(`Client ${index + 1}\n`),
            ),
          );
          expect(firstPages[0]).toBe(0);
          expect(new Set(firstPages).size).toBe(100);
          expect(firstPages).toEqual([...firstPages].sort((a, b) => a - b));
          expect(elapsedMs).toBeLessThan(60_000);
        },
      );

      it('répond 401 sans jeton', async () => {
        await api()
          .post('/api/v1/receipts/batch')
          .send({ orderIds: [ids[0]] })
          .expect(401);
      });
    });
  },
);
