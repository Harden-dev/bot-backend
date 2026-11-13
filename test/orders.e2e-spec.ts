import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import {
  INVALID_PERIOD_MESSAGE,
  MAX_ORDER_TOTAL,
} from '../src/common/index.js';
import type { OrderStatus } from '../src/generated/prisma/client.js';
import { type CreateOrderInput, OrdersService } from '../src/orders/index.js';
import { PrismaService, type PrismaTx } from '../src/prisma/index.js';
import { createApp, seedAdminWithToken } from './helpers/create-app.js';
import { resetDb } from './helpers/reset-db.js';

interface OrderBody {
  id: number;
  reference: string;
  status: OrderStatus;
  customerName: string;
  customerPhone: string;
  deliveryLocation: string;
  totalAmount: number;
  notes: string | null;
  vendor: { id: number; name: string };
  items: { id: number; label: string; quantity: number; unitPrice: number }[];
  history: {
    fromStatus: string | null;
    toStatus: string;
    changedByUserId: number | null;
    comment: string | null;
  }[];
}

interface PageBody {
  data: OrderBody[];
  meta: { page: number; limit: number; total: number };
}

describe('Orders (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let orders: OrdersService;
  let token: string;
  let vendorId: bigint;
  // Jour UTC relu avant chaque test (pas de décalage si la suite passe minuit).
  let today: string;
  let todayCompact: string;

  const api = () => request(app.getHttpServer());
  const auth = () => ({ Authorization: `Bearer ${token}` });

  function input(overrides: Partial<CreateOrderInput> = {}): CreateOrderInput {
    return {
      vendorId,
      customerName: 'Aya Kouassi',
      customerPhone: '0707070707',
      deliveryLocation: 'Cocody Angré',
      items: [
        { label: 'Robe wax', quantity: 2, unitPrice: 15_000 },
        { label: 'Sac', quantity: 1, unitPrice: 8_000 },
      ],
      ...overrides,
    };
  }

  async function createOrder(
    overrides: Partial<CreateOrderInput> = {},
  ): Promise<bigint> {
    const order = await orders.create(input(overrides));
    return order.id;
  }

  async function setStatus(id: bigint, status: OrderStatus): Promise<void> {
    await prisma.order.update({ where: { id }, data: { status } });
  }

  const historyCount = (id: bigint) =>
    prisma.orderStatusHistory.count({ where: { orderId: id } });

  async function counterValue(): Promise<number | null> {
    const rows = await prisma.$queryRaw<{ last_seq: number | bigint }[]>`
      SELECT last_seq FROM daily_counters WHERE day = ${today}`;
    return rows.length === 0 ? null : Number(rows[0].last_seq);
  }

  /**
   * Attend que `count` transactions soient bloquées sur un verrou de ligne.
   * `performance_schema.data_lock_waits` n'est pas mis en cache, contrairement
   * à `information_schema.INNODB_TRX` (rafraîchi seulement s'il n'a pas été
   * lu depuis 0,1 s).
   */
  async function waitForLockWaits(count: number): Promise<void> {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const rows = await prisma.$queryRaw<{ n: number | bigint }[]>`
        SELECT COUNT(DISTINCT REQUESTING_ENGINE_TRANSACTION_ID) AS n
        FROM performance_schema.data_lock_waits`;
      if (Number(rows[0].n) >= count) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`${count} attente(s) de verrou non observée(s)`);
  }

  // Transactions tenues par un test : toujours libérées dans afterEach.
  const openHolders: { release: () => void; done: Promise<void> }[] = [];

  /**
   * Ouvre une transaction qui exécute `work` puis garde ses verrous jusqu'à
   * `release()` ; `finish()` attend la fin (COMMIT, ou ROLLBACK si `rollback`).
   */
  async function holdTransaction(
    work: (tx: PrismaTx) => Promise<unknown>,
    { rollback = false } = {},
  ) {
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let ready!: () => void;
    const started = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const ROLLBACK = new Error('rollback volontaire');
    const done = prisma
      .$transaction(
        async (tx) => {
          await work(tx);
          ready();
          await released;
          if (rollback) {
            throw ROLLBACK;
          }
        },
        { timeout: 20_000 },
      )
      .catch((error: unknown) => {
        if (error !== ROLLBACK) {
          throw error;
        }
      });
    openHolders.push({ release, done });
    await Promise.race([started, done]);
    return { release, finish: () => done };
  }

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
    orders = app.get(OrdersService);
  });

  beforeEach(async () => {
    today = new Date().toISOString().slice(0, 10);
    todayCompact = today.replaceAll('-', '');
    await resetDb(prisma);
    token = await seedAdminWithToken(app);
    const vendor = await prisma.vendor.create({
      data: { name: 'Boutique Awa', whatsappNumber: '2250707070707' },
    });
    vendorId = vendor.id;
  });

  afterEach(async () => {
    const holders = openHolders.splice(0);
    for (const holder of holders) {
      holder.release();
    }
    await Promise.allSettled(holders.map((holder) => holder.done));
  });

  afterAll(async () => {
    await app.close();
  });

  describe('OrdersService.create', () => {
    it('crée une commande non_traitee avec articles, total et historique initial', async () => {
      const id = await createOrder();

      const order = await prisma.order.findUniqueOrThrow({
        where: { id },
        include: { items: true, statusHistory: true },
      });
      expect(order).toMatchObject({
        reference: `CMD-${todayCompact}-001`,
        status: 'non_traitee',
        totalAmount: 38_000,
        notes: null,
      });
      expect(order.items).toHaveLength(2);
      expect(order.statusHistory).toMatchObject([
        { fromStatus: null, toStatus: 'non_traitee', changedByUserId: null },
      ]);
    });

    it('donne des références distinctes et consécutives à 10 créations simultanées', async () => {
      const created = await Promise.all(
        Array.from({ length: 10 }, () => orders.create(input())),
      );

      const references = created.map((order) => order.reference).sort();
      expect(references).toEqual(
        Array.from(
          { length: 10 },
          (_, index) =>
            `CMD-${todayCompact}-${String(index + 1).padStart(3, '0')}`,
        ),
      );
      await expect(counterValue()).resolves.toBe(10);
    });

    it('passe à 4 chiffres au-delà de 999 (PO-23)', async () => {
      await prisma.$executeRaw`INSERT INTO daily_counters (day, last_seq) VALUES (${today}, 999)`;

      const order = await orders.create(input());

      expect(order.reference).toBe(`CMD-${todayCompact}-1000`);
    });

    it('s’annule avec la transaction de l’appelant (commande et compteur)', async () => {
      const rollback = new Error('annulation volontaire');

      await expect(
        prisma.$transaction(async (tx) => {
          await orders.create(input(), tx);
          throw rollback;
        }),
      ).rejects.toBe(rollback);

      await expect(prisma.order.count()).resolves.toBe(0);
      // La ligne du jour est créée hors transaction (autocommit), à 0.
      await expect(counterValue()).resolves.toBe(0);
    });

    it('n’interbloque pas les créations en attente quand la première du jour est annulée', async () => {
      const first = await holdTransaction((tx) => orders.create(input(), tx), {
        rollback: true,
      });
      const waiting = Promise.all([
        orders.create(input()),
        orders.create(input()),
      ]);
      await waitForLockWaits(2);

      first.release();
      await first.finish();
      const created = await waiting;

      expect(created.map((order) => order.reference).sort()).toEqual([
        `CMD-${todayCompact}-001`,
        `CMD-${todayCompact}-002`,
      ]);
      await expect(counterValue()).resolves.toBe(2);
    });
  });

  describe('authentification', () => {
    it.each([
      ['get', '/api/v1/orders'],
      ['get', '/api/v1/orders/counts'],
      ['get', '/api/v1/orders/1'],
      ['patch', '/api/v1/orders/1'],
      ['patch', '/api/v1/orders/1/status'],
    ] as const)('%s %s répond 401 sans jeton', async (method, url) => {
      await api()[method](url).expect(401);
    });
  });

  describe('GET /api/v1/orders', () => {
    it('trie par date décroissante et pagine (page=1, limit=20 par défaut)', async () => {
      const first = await createOrder();
      const second = await createOrder();
      await prisma.order.update({
        where: { id: first },
        data: { createdAt: new Date('2026-01-01T10:00:00Z') },
      });

      const res = await api().get('/api/v1/orders').set(auth()).expect(200);
      const body = res.body as PageBody;

      expect(body.meta).toEqual({ page: 1, limit: 20, total: 2 });
      expect(body.data.map((order) => order.id)).toEqual([
        Number(second),
        Number(first),
      ]);
      expect(body.data[0]).toMatchObject({
        status: 'non_traitee',
        totalAmount: 38_000,
        vendor: { id: Number(vendorId), name: 'Boutique Awa' },
      });
    });

    it('découpe en pages', async () => {
      for (let index = 0; index < 3; index += 1) {
        await createOrder();
      }

      const res = await api()
        .get('/api/v1/orders?page=2&limit=2')
        .set(auth())
        .expect(200);
      const body = res.body as PageBody;

      expect(body.meta).toEqual({ page: 2, limit: 2, total: 3 });
      expect(body.data).toHaveLength(1);
      expect(body.data[0].reference).toBe(`CMD-${todayCompact}-001`);
    });

    it.each([
      'limit=101',
      'page=0',
      'status=inconnu',
      'vendorId=0',
      'from=2026-02-30',
      'to=10/11/2026',
      'tri=asc',
    ])('refuse %s en 400', async (params) => {
      await api().get(`/api/v1/orders?${params}`).set(auth()).expect(400);
    });

    it('filtre par statut, vendeur et période (cumulables, bornes incluses)', async () => {
      const other = await prisma.vendor.create({
        data: { name: 'Kofi', whatsappNumber: '2250505050505' },
      });
      const inRange = await createOrder();
      const otherStatus = await createOrder();
      const otherVendor = await createOrder({ vendorId: other.id });
      const beforeRange = await createOrder();
      await setStatus(inRange, 'validee');
      await setStatus(otherVendor, 'validee');
      await setStatus(beforeRange, 'validee');
      await prisma.order.update({
        where: { id: inRange },
        data: { createdAt: new Date('2026-11-10T23:59:59.999Z') },
      });
      await prisma.order.update({
        where: { id: otherStatus },
        data: { createdAt: new Date('2026-11-01T00:00:00.000Z') },
      });
      await prisma.order.update({
        where: { id: otherVendor },
        data: { createdAt: new Date('2026-11-05T12:00:00.000Z') },
      });
      await prisma.order.update({
        where: { id: beforeRange },
        data: { createdAt: new Date('2026-10-31T23:59:59.999Z') },
      });

      const list = async (params: string) => {
        const res = await api()
          .get(`/api/v1/orders?${params}`)
          .set(auth())
          .expect(200);
        return (res.body as PageBody).data.map((order) => order.id).sort();
      };

      expect(await list('from=2026-11-01&to=2026-11-10')).toEqual(
        [inRange, otherStatus, otherVendor].map(Number).sort(),
      );
      expect(await list('status=validee')).toEqual(
        [inRange, otherVendor, beforeRange].map(Number).sort(),
      );
      expect(
        await list(
          `status=validee&vendorId=${vendorId}&from=2026-11-01&to=2026-11-10`,
        ),
      ).toEqual([Number(inRange)]);
      expect(await list(`vendorId=${other.id}`)).toEqual([Number(otherVendor)]);
    });

    it('recherche sur la référence, le nom et le téléphone du client', async () => {
      const aya = await createOrder();
      const kofi = await createOrder({
        customerName: 'Kofi Yao',
        customerPhone: '0102030405',
      });

      const search = async (term: string) => {
        const res = await api()
          .get('/api/v1/orders')
          .query({ search: term })
          .set(auth())
          .expect(200);
        return (res.body as PageBody).data.map((order) => order.id);
      };

      expect(await search(`CMD-${todayCompact}-002`)).toEqual([Number(kofi)]);
      expect(await search(`CMD-${todayCompact}`)).toHaveLength(2);
      expect(await search('kofi')).toEqual([Number(kofi)]);
      expect(await search('01 02 03')).toEqual([Number(kofi)]);
      expect(await search('0707')).toEqual([Number(aya)]);
      expect(await search('+225 01 02 03 04 05')).toEqual([Number(kofi)]);
      expect(await search('00225 07.07.07.07.07')).toEqual([Number(aya)]);
      expect(await search('inconnu')).toEqual([]);
    });

    // Non échappés, `%` et `_` (joker LIKE) remonteraient « Aya Kouassi ».
    it.each([
      ['%', ['Kofi_100%']],
      ['_', ['Kofi_100%']],
      ['%%', []],
      ['A_a', []],
    ])('traite %s comme un caractère, pas un joker', async (term, expected) => {
      await createOrder();
      await createOrder({ customerName: 'Kofi_100%' });

      const res = await api()
        .get('/api/v1/orders')
        .query({ search: term })
        .set(auth())
        .expect(200);
      const names = (res.body as PageBody).data.map(
        (order) => order.customerName,
      );

      expect(names).toEqual(expected);
    });

    it('refuse from > to en 400 (PO-20)', async () => {
      const res = await api()
        .get('/api/v1/orders?from=2026-11-11&to=2026-11-10')
        .set(auth())
        .expect(400);

      expect(res.body).toEqual({
        statusCode: 400,
        message: INVALID_PERIOD_MESSAGE,
        error: 'Bad Request',
      });
    });

    it('accepte from = to (un seul jour)', async () => {
      await createOrder();

      const res = await api()
        .get(`/api/v1/orders?from=${today}&to=${today}`)
        .set(auth())
        .expect(200);

      expect((res.body as PageBody).meta.total).toBe(1);
    });
  });

  describe('GET /api/v1/orders/counts', () => {
    it('renvoie les 6 statuts, 0 pour un statut vide', async () => {
      const ids = await Promise.all([
        createOrder(),
        createOrder(),
        createOrder(),
      ]);
      await setStatus(ids[0], 'livree');

      const res = await api()
        .get('/api/v1/orders/counts')
        .set(auth())
        .expect(200);

      expect(res.body).toEqual({
        non_traitee: 2,
        validee: 0,
        prete: 0,
        livree: 1,
        echec: 0,
        annulee: 0,
      });
    });
  });

  describe('GET /api/v1/orders/:id', () => {
    it('renvoie le détail : articles, vendeur, historique', async () => {
      const id = await createOrder({ notes: 'Fragile' });

      const res = await api()
        .get(`/api/v1/orders/${id}`)
        .set(auth())
        .expect(200);

      expect(res.body).toEqual({
        id: Number(id),
        reference: `CMD-${todayCompact}-001`,
        status: 'non_traitee',
        customerName: 'Aya Kouassi',
        customerPhone: '0707070707',
        deliveryLocation: 'Cocody Angré',
        notes: 'Fragile',
        totalAmount: 38_000,
        vendor: { id: Number(vendorId), name: 'Boutique Awa' },
        items: [
          {
            id: expect.any(Number),
            label: 'Robe wax',
            quantity: 2,
            unitPrice: 15_000,
          },
          {
            id: expect.any(Number),
            label: 'Sac',
            quantity: 1,
            unitPrice: 8_000,
          },
        ],
        history: [
          {
            id: expect.any(Number),
            fromStatus: null,
            toStatus: 'non_traitee',
            changedByUserId: null,
            comment: null,
            changedAt: expect.any(String),
          },
        ],
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });
    });

    it('répond 404 pour une commande inconnue et 400 pour un id invalide', async () => {
      await api().get('/api/v1/orders/999').set(auth()).expect(404);
      await api().get('/api/v1/orders/abc').set(auth()).expect(400);
    });
  });

  describe('PATCH /api/v1/orders/:id', () => {
    it.each(['non_traitee', 'validee'] as const)(
      'corrige une commande %s : téléphone normalisé, articles remplacés, total recalculé',
      async (status) => {
        const id = await createOrder();
        await setStatus(id, status);

        const res = await api()
          .patch(`/api/v1/orders/${id}`)
          .set(auth())
          .send({
            customerName: ' Aya K. ',
            customerPhone: '+225 05 05 05 05 05',
            deliveryLocation: 'Yopougon',
            notes: 'Appeler avant',
            items: [{ label: 'Pagne', quantity: 3, unitPrice: 5_000 }],
          })
          .expect(200);
        const body = res.body as OrderBody;

        expect(body).toMatchObject({
          status,
          customerName: 'Aya K.',
          customerPhone: '0505050505',
          deliveryLocation: 'Yopougon',
          notes: 'Appeler avant',
          totalAmount: 15_000,
          items: [{ label: 'Pagne', quantity: 3, unitPrice: 5_000 }],
        });
        await expect(
          prisma.orderItem.count({ where: { orderId: id } }),
        ).resolves.toBe(1);
        await expect(historyCount(id)).resolves.toBe(1);
      },
    );

    it('ne modifie que les champs fournis', async () => {
      const id = await createOrder({ notes: 'Fragile' });

      const res = await api()
        .patch(`/api/v1/orders/${id}`)
        .set(auth())
        .send({ notes: '' })
        .expect(200);

      expect(res.body).toMatchObject({
        customerName: 'Aya Kouassi',
        notes: null,
        totalAmount: 38_000,
      });
    });

    it.each(['prete', 'livree', 'echec', 'annulee'] as const)(
      'refuse la correction d’une commande %s en 409 sans la modifier (PO-14)',
      async (status) => {
        const id = await createOrder();
        await setStatus(id, status);

        await api()
          .patch(`/api/v1/orders/${id}`)
          .set(auth())
          .send({ customerName: 'Autre' })
          .expect(409);

        await expect(
          prisma.order.findUniqueOrThrow({ where: { id } }),
        ).resolves.toMatchObject({ customerName: 'Aya Kouassi' });
      },
    );

    it.each([
      [{ status: 'validee' }],
      [{ totalAmount: 1 }],
      [{ reference: 'CMD-X' }],
      [{ customerPhone: '070707' }],
      [{ customerName: null }],
      [{ customerName: 'x'.repeat(121) }],
      [{ notes: 'x'.repeat(1001) }],
      [{ items: [] }],
      [{ items: [{ label: 'A', quantity: 0, unitPrice: 1 }] }],
      [{ items: [{ label: 'A', quantity: 1, unitPrice: 10_000_001 }] }],
      [{ items: [{ label: 'A', quantity: 1, unitPrice: 1, extra: 1 }] }],
      [
        {
          items: Array.from({ length: 31 }, () => ({
            label: 'A',
            quantity: 1,
            unitPrice: 1,
          })),
        },
      ],
    ])('refuse %j en 400', async (body) => {
      const id = await createOrder();

      await api()
        .patch(`/api/v1/orders/${id}`)
        .set(auth())
        .send(body)
        .expect(400);
    });

    it('refuse un total au-delà du plafond en 400 (PO-01)', async () => {
      const id = await createOrder();
      const quantity = 999;
      const unitPrice = 10_000_000;
      const count = Math.ceil(MAX_ORDER_TOTAL / (quantity * unitPrice)) + 1;

      const res = await api()
        .patch(`/api/v1/orders/${id}`)
        .set(auth())
        .send({
          items: Array.from({ length: count }, () => ({
            label: 'Lot',
            quantity,
            unitPrice,
          })),
        })
        .expect(400);

      expect((res.body as { message: string }).message).toContain(
        '4 294 967 295',
      );
      await expect(
        prisma.order.findUniqueOrThrow({ where: { id } }),
      ).resolves.toMatchObject({ totalAmount: 38_000 });
    });

    it('répond 404 pour une commande inconnue', async () => {
      await api()
        .patch('/api/v1/orders/999')
        .set(auth())
        .send({ notes: 'x' })
        .expect(404);
    });
  });

  describe('PATCH /api/v1/orders/:id/status', () => {
    const changeStatus = (id: bigint, body: object) =>
      api().patch(`/api/v1/orders/${id}/status`).set(auth()).send(body);

    it.each([
      ['non_traitee', 'validee'],
      ['non_traitee', 'annulee'],
      ['validee', 'prete'],
      ['validee', 'annulee'],
      ['prete', 'livree'],
      ['prete', 'echec'],
      ['prete', 'annulee'],
      ['echec', 'prete'],
    ] as const)(
      'autorise %s → %s et trace l’utilisateur dans l’historique',
      async (from, to) => {
        const id = await createOrder();
        await setStatus(id, from);
        const admin = await prisma.user.findFirstOrThrow();

        const res = await changeStatus(id, {
          status: to,
          comment: 'Client joint',
        }).expect(200);
        const body = res.body as OrderBody;

        expect(body.status).toBe(to);
        expect(body.history.at(-1)).toMatchObject({
          fromStatus: from,
          toStatus: to,
          changedByUserId: Number(admin.id),
          comment: 'Client joint',
        });
        await expect(historyCount(id)).resolves.toBe(2);
      },
    );

    it.each([
      ['non_traitee', 'livree'],
      ['livree', 'annulee'],
      ['annulee', 'validee'],
      ['echec', 'livree'],
      ['echec', 'annulee'],
      ['validee', 'validee'],
      ['livree', 'prete'],
    ] as const)(
      'refuse %s → %s en 409, statut et historique inchangés',
      async (from, to) => {
        const id = await createOrder();
        await setStatus(id, from);

        await changeStatus(id, { status: to }).expect(409);

        await expect(
          prisma.order.findUniqueOrThrow({ where: { id } }),
        ).resolves.toMatchObject({ status: from });
        await expect(historyCount(id)).resolves.toBe(1);
      },
    );

    it('suit le cycle complet avec une nouvelle tentative après échec', async () => {
      const id = await createOrder();

      for (const status of ['validee', 'prete', 'echec', 'prete', 'livree']) {
        await changeStatus(id, { status }).expect(200);
      }

      const history = await prisma.orderStatusHistory.findMany({
        where: { orderId: id },
        orderBy: { id: 'asc' },
      });
      expect(history.map((entry) => entry.toStatus)).toEqual([
        'non_traitee',
        'validee',
        'prete',
        'echec',
        'prete',
        'livree',
      ]);
      expect(history[1].comment).toBeNull();
    });

    it.each([
      [{ status: 'expediee' }],
      [{}],
      [{ status: 'validee', comment: 'x'.repeat(256) }],
      [{ status: 'validee', changedBy: 3 }],
    ])('refuse %j en 400', async (body) => {
      const id = await createOrder();

      await changeStatus(id, body).expect(400);
      await expect(historyCount(id)).resolves.toBe(1);
    });

    it('répond 404 pour une commande inconnue', async () => {
      await changeStatus(999n, { status: 'validee' }).expect(404);
    });
  });

  // Deux administrateurs agissent en même temps : le verrou `FOR UPDATE`
  // sérialise les décisions prises sur le statut.
  describe('concurrence entre administrateurs', () => {
    const changeStatus = (id: bigint, body: object) =>
      api().patch(`/api/v1/orders/${id}/status`).set(auth()).send(body);
    const lockOrder = (id: bigint) => (tx: PrismaTx) =>
      tx.$queryRaw`SELECT id FROM orders WHERE id = ${id} FOR UPDATE`;

    it('livree et echec envoyés en même temps sur une commande prete : un 200 et un 409', async () => {
      const id = await createOrder();
      await setStatus(id, 'prete');
      // Les deux requêtes arrivent pendant qu'une autre transaction tient la
      // commande : elles décident toutes deux après sa libération.
      const holder = await holdTransaction(lockOrder(id));
      const responses = Promise.all(
        (['livree', 'echec'] as const).map((status) =>
          api()
            .patch(`/api/v1/orders/${id}/status`)
            .set(auth())
            .send({ status })
            .then((res) => res.status),
        ),
      );
      await waitForLockWaits(2);

      holder.release();
      await holder.finish();

      expect((await responses).sort()).toEqual([200, 409]);
      await expect(historyCount(id)).resolves.toBe(2);
    });

    it('une correction attendant le passage à prete est refusée en 409, sans effet', async () => {
      const id = await createOrder();
      await setStatus(id, 'validee');
      const admin = await prisma.user.findFirstOrThrow();
      // Autre administrateur : passage à `prete` en cours (non validé).
      const holder = await holdTransaction(async (tx) => {
        await lockOrder(id)(tx);
        await tx.order.update({
          where: { id },
          data: {
            status: 'prete',
            statusHistory: {
              create: {
                fromStatus: 'validee',
                toStatus: 'prete',
                changedByUserId: admin.id,
                changedAt: new Date(),
              },
            },
          },
        });
      });
      const correction = api()
        .patch(`/api/v1/orders/${id}`)
        .set(auth())
        .send({ customerName: 'Corrigé' })
        .then((res) => res.status);
      await waitForLockWaits(1);

      holder.release();
      await holder.finish();

      expect(await correction).toBe(409);
      await expect(
        prisma.order.findUniqueOrThrow({ where: { id } }),
      ).resolves.toMatchObject({
        status: 'prete',
        customerName: 'Aya Kouassi',
      });
    });

    it('correction et passage à prete simultanés : jamais de correction sur une commande prete', async () => {
      const id = await createOrder();
      await setStatus(id, 'validee');

      const [correction, change] = await Promise.all([
        api()
          .patch(`/api/v1/orders/${id}`)
          .set(auth())
          .send({ customerName: 'Corrigé' }),
        changeStatus(id, { status: 'prete' }),
      ]);

      expect(change.status).toBe(200);
      const order = await prisma.order.findUniqueOrThrow({ where: { id } });
      expect(order.status).toBe('prete');
      if (correction.status === 200) {
        // Appliquée avant le changement de statut, donc sur `validee`.
        expect((correction.body as OrderBody).status).toBe('validee');
        expect(order.customerName).toBe('Corrigé');
      } else {
        expect(correction.status).toBe(409);
        expect(order.customerName).toBe('Aya Kouassi');
      }
    });
  });
});
