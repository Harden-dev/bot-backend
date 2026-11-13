import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import {
  INVALID_PERIOD_MESSAGE,
  MAX_ORDER_TOTAL,
} from '../src/common/index.js';
import type { OrderStatus } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/index.js';
import { addDays, PERIOD_TOO_LONG_MESSAGE } from '../src/stats/stats-period.js';
import { createApp, seedAdminWithToken } from './helpers/create-app.js';
import { resetDb } from './helpers/reset-db.js';

const HOUR_MS = 3_600_000;
const ZERO_STATUSES = {
  non_traitee: 0,
  validee: 0,
  prete: 0,
  livree: 0,
  echec: 0,
  annulee: 0,
};

interface OrderSeed {
  vendorId: bigint;
  status: OrderStatus;
  createdAt: string | Date;
  totalAmount?: number;
  /** Heures entre la création et chaque entrée `validee` de l'historique. */
  validatedAfterHours?: number[];
}

describe('Stats (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let token: string;
  let sequence = 0;

  const api = () => request(app.getHttpServer());
  const auth = () => ({ Authorization: `Bearer ${token}` });

  const createVendor = async (name: string, isActive = true) =>
    (
      await prisma.vendor.create({
        data: {
          name,
          whatsappNumber: `22507000000${String(sequence++).padStart(2, '0')}`,
          isActive,
        },
      })
    ).id;

  /** Commande insérée directement : date, statut et historique maîtrisés. */
  async function insertOrder(seed: OrderSeed): Promise<void> {
    sequence += 1;
    const createdAt = new Date(seed.createdAt);
    await prisma.order.create({
      data: {
        reference: `CMD-TEST-${sequence}`,
        vendorId: seed.vendorId,
        customerName: 'Client',
        customerPhone: '0707070707',
        deliveryLocation: 'Cocody',
        status: seed.status,
        totalAmount: seed.totalAmount ?? 10_000,
        createdAt,
        statusHistory: {
          create: [
            { fromStatus: null, toStatus: 'non_traitee', changedAt: createdAt },
            ...(seed.validatedAfterHours ?? []).map((hours) => ({
              fromStatus: 'non_traitee',
              toStatus: 'validee',
              changedAt: new Date(createdAt.getTime() + hours * HOUR_MS),
            })),
          ],
        },
      },
    });
  }

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDb(prisma);
    token = await seedAdminWithToken(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it.each(['overview', 'by-vendor', 'by-day'])(
    'GET /stats/%s répond 401 sans jeton',
    async (route) => {
      await api().get(`/api/v1/stats/${route}`).expect(401);
    },
  );

  it.each(['overview', 'by-vendor', 'by-day'])(
    'GET /stats/%s refuse from > to et une date invalide en 400',
    async (route) => {
      const res = await api()
        .get(`/api/v1/stats/${route}`)
        .query({ from: '2026-10-04', to: '2026-10-03' })
        .set(auth())
        .expect(400);
      expect(res.body.message).toBe(INVALID_PERIOD_MESSAGE);

      await api()
        .get(`/api/v1/stats/${route}`)
        .query({ from: '2026-02-30' })
        .set(auth())
        .expect(400);
      await api()
        .get(`/api/v1/stats/${route}`)
        .query({ to: '2026-10-03T00:00:00Z' })
        .set(auth())
        .expect(400);
    },
  );

  describe('jeu de données calculé à la main (période 2026-10-01 à 2026-10-03)', () => {
    const PERIOD = { from: '2026-10-01', to: '2026-10-03' };
    let awa: bigint;
    let kofi: bigint;
    let inactive: bigint;

    beforeEach(async () => {
      awa = await createVendor('Awa');
      kofi = await createVendor('Kofi');
      inactive = await createVendor('Inactif', false);
      const seeds: OrderSeed[] = [
        // Borne basse incluse ; délais de validation 1 h, 2 h et 3 h.
        {
          vendorId: awa,
          status: 'livree',
          createdAt: '2026-10-01T00:00:00.000Z',
          validatedAfterHours: [1],
        },
        {
          vendorId: awa,
          status: 'livree',
          createdAt: '2026-10-01T08:00:00.000Z',
          validatedAfterHours: [2],
        },
        // Seule la première entrée `validee` compte (3 h, pas 5 h).
        {
          vendorId: awa,
          status: 'livree',
          createdAt: '2026-10-01T09:00:00.000Z',
          validatedAfterHours: [5, 3],
        },
        { vendorId: awa, status: 'livree', createdAt: '2026-10-01T10:00:00Z' },
        { vendorId: awa, status: 'livree', createdAt: '2026-10-03T10:00:00Z' },
        { vendorId: kofi, status: 'livree', createdAt: '2026-10-03T11:00:00Z' },
        { vendorId: kofi, status: 'livree', createdAt: '2026-10-03T12:00:00Z' },
        // Borne haute incluse.
        {
          vendorId: kofi,
          status: 'livree',
          createdAt: '2026-10-03T23:59:59.999Z',
        },
        { vendorId: awa, status: 'echec', createdAt: '2026-10-01T11:00:00Z' },
        { vendorId: kofi, status: 'echec', createdAt: '2026-10-03T13:00:00Z' },
        // Annulée : comptée, exclue du montant.
        {
          vendorId: awa,
          status: 'annulee',
          createdAt: '2026-10-01T12:00:00Z',
          totalAmount: 50_000,
        },
        {
          vendorId: kofi,
          status: 'non_traitee',
          createdAt: '2026-10-03T14:00:00Z',
          totalAmount: 20_000,
        },
        {
          vendorId: kofi,
          status: 'validee',
          createdAt: '2026-10-03T15:00:00Z',
          totalAmount: 30_000,
        },
        {
          vendorId: awa,
          status: 'prete',
          createdAt: '2026-10-01T13:00:00Z',
          totalAmount: 40_000,
        },
        // Hors période, juste avant et juste après.
        {
          vendorId: awa,
          status: 'livree',
          createdAt: '2026-09-30T23:59:59.999Z',
          totalAmount: 1_000_000,
          validatedAfterHours: [10],
        },
        {
          vendorId: kofi,
          status: 'echec',
          createdAt: '2026-10-04T00:00:00.000Z',
          totalAmount: 1_000_000,
          validatedAfterHours: [10],
        },
      ];
      for (const seed of seeds) {
        await insertOrder(seed);
      }
    });

    it('overview : totaux, statuts, taux 80 % / 20 %, délai moyen 2 h', async () => {
      const res = await api()
        .get('/api/v1/stats/overview')
        .query(PERIOD)
        .set(auth())
        .expect(200);

      expect(res.body).toEqual({
        ...PERIOD,
        totalOrders: 14,
        totalAmount: 190_000,
        byStatus: {
          non_traitee: 1,
          validee: 1,
          prete: 1,
          livree: 8,
          echec: 2,
          annulee: 1,
        },
        deliveryRate: 80,
        failureRate: 20,
        averageValidationHours: 2,
      });
    });

    it('by-vendor : tous les vendeurs, inactif sans commande à 0', async () => {
      const res = await api()
        .get('/api/v1/stats/by-vendor')
        .query(PERIOD)
        .set(auth())
        .expect(200);

      expect(res.body).toEqual({
        ...PERIOD,
        data: [
          {
            vendorId: Number(awa),
            vendorName: 'Awa',
            count: 8,
            amount: 100_000,
          },
          {
            vendorId: Number(kofi),
            vendorName: 'Kofi',
            count: 6,
            amount: 90_000,
          },
          {
            vendorId: Number(inactive),
            vendorName: 'Inactif',
            count: 0,
            amount: 0,
          },
        ],
      });
    });

    it('by-day : chaque jour, jour sans commande à 0', async () => {
      const res = await api()
        .get('/api/v1/stats/by-day')
        .query(PERIOD)
        .set(auth())
        .expect(200);

      expect(res.body).toEqual({
        ...PERIOD,
        data: [
          { day: '2026-10-01', count: 7, amount: 90_000 },
          { day: '2026-10-02', count: 0, amount: 0 },
          { day: '2026-10-03', count: 7, amount: 100_000 },
        ],
      });
    });

    it('un jour unique inclut ses deux bornes', async () => {
      const res = await api()
        .get('/api/v1/stats/by-day')
        .query({ from: '2026-09-30', to: '2026-09-30' })
        .set(auth())
        .expect(200);

      expect(res.body.data).toEqual([
        { day: '2026-09-30', count: 1, amount: 1_000_000 },
      ]);
    });
  });

  it('période vide : zéros, taux et délai à null', async () => {
    const vendorId = await createVendor('Awa');
    const query = { from: '2026-10-01', to: '2026-10-02' };

    const overview = await api()
      .get('/api/v1/stats/overview')
      .query(query)
      .set(auth())
      .expect(200);
    const byVendor = await api()
      .get('/api/v1/stats/by-vendor')
      .query(query)
      .set(auth())
      .expect(200);
    const byDay = await api()
      .get('/api/v1/stats/by-day')
      .query(query)
      .set(auth())
      .expect(200);

    expect(overview.body).toEqual({
      ...query,
      totalOrders: 0,
      totalAmount: 0,
      byStatus: ZERO_STATUSES,
      deliveryRate: null,
      failureRate: null,
      averageValidationHours: null,
    });
    expect(byVendor.body.data).toEqual([
      { vendorId: Number(vendorId), vendorName: 'Awa', count: 0, amount: 0 },
    ]);
    expect(byDay.body.data).toEqual([
      { day: '2026-10-01', count: 0, amount: 0 },
      { day: '2026-10-02', count: 0, amount: 0 },
    ]);
  });

  it('dénominateur nul : taux à null même avec des commandes', async () => {
    const vendorId = await createVendor('Awa');
    await insertOrder({
      vendorId,
      status: 'prete',
      createdAt: '2026-10-01T09:00:00Z',
      validatedAfterHours: [0.25],
    });

    const res = await api()
      .get('/api/v1/stats/overview')
      .query({ from: '2026-10-01', to: '2026-10-01' })
      .set(auth())
      .expect(200);

    expect(res.body).toMatchObject({
      totalOrders: 1,
      deliveryRate: null,
      failureRate: null,
      averageValidationHours: 0.3,
    });
  });

  it('taux à une décimale (1 livrée, 2 échecs)', async () => {
    const vendorId = await createVendor('Awa');
    for (const status of ['livree', 'echec', 'echec'] as const) {
      await insertOrder({
        vendorId,
        status,
        createdAt: '2026-10-01T09:00:00Z',
      });
    }

    const res = await api()
      .get('/api/v1/stats/overview')
      .query({ from: '2026-10-01', to: '2026-10-01' })
      .set(auth())
      .expect(200);

    expect(res.body).toMatchObject({ deliveryRate: 33.3, failureRate: 66.7 });
  });

  it('additionne des montants au-delà du type INT UNSIGNED sans perte', async () => {
    const vendorId = await createVendor('Awa');
    for (let index = 0; index < 3; index += 1) {
      await insertOrder({
        vendorId,
        status: 'livree',
        createdAt: '2026-10-01T09:00:00Z',
        totalAmount: MAX_ORDER_TOTAL,
      });
    }
    const query = { from: '2026-10-01', to: '2026-10-01' };
    const expected = 3 * MAX_ORDER_TOTAL;

    const overview = await api()
      .get('/api/v1/stats/overview')
      .query(query)
      .set(auth())
      .expect(200);
    const byVendor = await api()
      .get('/api/v1/stats/by-vendor')
      .query(query)
      .set(auth())
      .expect(200);
    const byDay = await api()
      .get('/api/v1/stats/by-day')
      .query(query)
      .set(auth())
      .expect(200);

    expect(overview.body.totalAmount).toBe(expected);
    expect(byVendor.body.data[0].amount).toBe(expected);
    expect(byDay.body.data[0].amount).toBe(expected);
  });

  it.each(['overview', 'by-vendor', 'by-day'])(
    'GET /stats/%s accepte 366 jours et refuse 367 jours en 400',
    async (route) => {
      const ok = await api()
        .get(`/api/v1/stats/${route}`)
        .query({ from: '2026-01-01', to: '2027-01-01' })
        .set(auth())
        .expect(200);
      if (route === 'by-day') {
        expect(ok.body.data).toHaveLength(366);
      }

      const res = await api()
        .get(`/api/v1/stats/${route}`)
        .query({ from: '2026-01-01', to: '2027-01-02' })
        .set(auth())
        .expect(400);
      expect(res.body.message).toBe(PERIOD_TOO_LONG_MESSAGE);
    },
  );

  // Attentes déduites de la période renvoyée : indépendant d'un passage de
  // minuit UTC pendant le test.
  it("sans période : les 30 derniers jours, aujourd'hui inclus", async () => {
    const vendorId = await createVendor('Awa');
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const firstDay = addDays(today, -29);
    const createdAt = [
      now,
      new Date(`${firstDay}T00:00:00.000Z`),
      // La veille du premier jour : hors période.
      new Date(Date.parse(`${firstDay}T00:00:00.000Z`) - 1),
    ];
    for (const date of createdAt) {
      await insertOrder({ vendorId, status: 'livree', createdAt: date });
    }
    const countIn = (from: string, to: string) =>
      createdAt
        .map((date) => date.toISOString().slice(0, 10))
        .filter((day) => day >= from && day <= to).length;

    const overview = await api()
      .get('/api/v1/stats/overview')
      .set(auth())
      .expect(200);
    const byDay = await api()
      .get('/api/v1/stats/by-day')
      .set(auth())
      .expect(200);

    for (const body of [overview.body, byDay.body]) {
      expect([today, addDays(today, 1)]).toContain(body.to);
      expect(body.from).toBe(addDays(body.to, -29));
    }
    expect(overview.body.totalOrders).toBe(
      countIn(overview.body.from, overview.body.to),
    );
    if (overview.body.to === today) {
      expect(overview.body.totalOrders).toBe(2);
    }
    const days = byDay.body.data as { day: string; count: number }[];
    expect(days).toHaveLength(30);
    expect(days[0].day).toBe(byDay.body.from);
    expect(days[29].day).toBe(byDay.body.to);
    expect(days.reduce((sum, day) => sum + day.count, 0)).toBe(
      countIn(byDay.body.from, byDay.body.to),
    );
  });
});
