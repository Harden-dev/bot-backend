import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Prisma } from '../generated/prisma/client.js';
import { OrdersService } from '../orders/index.js';
import { PrismaService } from '../prisma/index.js';
import {
  CONFIRM_MAX_ATTEMPTS,
  DraftsService,
  readDraftPayload,
} from './drafts.service.js';
import type { ParsedOrder } from './parse-order.js';

const NOW = new Date('2026-11-13T10:00:00.000Z');
const VENDOR_ID = 2n;
const PUBLIC_ID = 'AbCdEf123_-x';

const ORDER: ParsedOrder = {
  customerName: 'Awa Koné',
  customerPhone: '0707070707',
  deliveryLocation: 'Cocody',
  items: [{ label: 'sac noir', quantity: 2, unitPrice: 8_000 }],
  total: 16_000,
};

function lockedDraft(overrides: Record<string, unknown> = {}) {
  return {
    id: 9n,
    vendor_id: VENDOR_ID,
    status: 'pending',
    expires_at: new Date(NOW.getTime() + 60_000),
    payload: ORDER,
    ...overrides,
  };
}

function prismaError(code: string) {
  return new Prisma.PrismaClientKnownRequestError('erreur', {
    code,
    clientVersion: 'test',
  });
}

describe('DraftsService', () => {
  const orderDraft = {
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    findFirst: vi.fn(),
  };
  const tx = { orderDraft, $queryRaw: vi.fn() };
  const prisma = {
    orderDraft,
    $transaction: vi.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
  };
  const orders = { create: vi.fn(), prepareDailyCounter: vi.fn() };
  let service: DraftsService;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    const moduleRef = await Test.createTestingModule({
      providers: [
        DraftsService,
        { provide: PrismaService, useValue: prisma },
        { provide: OrdersService, useValue: orders },
        { provide: ConfigService, useValue: { get: () => 30 } },
      ],
    }).compile();
    service = moduleRef.get(DraftsService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('create', () => {
    it('crée un brouillon pending de 30 minutes avec un public_id aléatoire de 12 caractères', async () => {
      orderDraft.create.mockResolvedValue({});

      const publicId = await service.create(VENDOR_ID, ORDER, NOW);

      expect(publicId).toMatch(/^[\w-]{12}$/);
      expect(orderDraft.create).toHaveBeenCalledWith({
        data: {
          publicId,
          vendorId: VENDOR_ID,
          payload: ORDER,
          status: 'pending',
          createdAt: NOW,
          expiresAt: new Date('2026-11-13T10:30:00.000Z'),
        },
      });
      expect(await service.create(VENDOR_ID, ORDER, NOW)).not.toBe(publicId);
    });
  });

  describe('confirm', () => {
    beforeEach(() => {
      orders.create.mockResolvedValue({ reference: 'CMD-20261113-001' });
      orderDraft.update.mockResolvedValue({});
    });

    it('verrouille le brouillon, crée la commande avec tx puis confirme le brouillon', async () => {
      tx.$queryRaw.mockResolvedValue([lockedDraft()]);

      await expect(service.confirm(VENDOR_ID, PUBLIC_ID, NOW)).resolves.toEqual(
        { status: 'confirmed', reference: 'CMD-20261113-001', created: true },
      );

      const [sql, publicId] = tx.$queryRaw.mock.calls[0] as [string[], string];
      expect(sql.join('?')).toContain('FOR UPDATE');
      expect(publicId).toBe(PUBLIC_ID);
      expect(orders.create).toHaveBeenCalledWith(
        {
          vendorId: VENDOR_ID,
          customerName: 'Awa Koné',
          customerPhone: '0707070707',
          deliveryLocation: 'Cocody',
          items: ORDER.items,
        },
        tx,
      );
      expect(orderDraft.update).toHaveBeenCalledWith({
        where: { id: 9n },
        data: {
          status: 'confirmed',
          payload: { ...ORDER, orderReference: 'CMD-20261113-001' },
        },
      });
      expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        orders.create.mock.invocationCallOrder[0],
      );
    });

    it('prépare la ligne du jour hors transaction, avant chaque tentative', async () => {
      tx.$queryRaw.mockResolvedValue([lockedDraft()]);

      await service.confirm(VENDOR_ID, PUBLIC_ID, NOW);

      expect(orders.prepareDailyCounter).toHaveBeenCalledExactlyOnceWith(NOW);
      expect(
        orders.prepareDailyCounter.mock.invocationCallOrder[0],
      ).toBeLessThan(prisma.$transaction.mock.invocationCallOrder[0]);
    });

    it('recalcule l’heure à chaque tentative quand elle n’est pas fournie', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        vi.setSystemTime(NOW);
        tx.$queryRaw.mockResolvedValue([
          lockedDraft({ expires_at: new Date(NOW.getTime() + 1_000) }),
        ]);
        orders.create.mockImplementationOnce(() => {
          vi.setSystemTime(NOW.getTime() + 2_000);
          return Promise.reject(prismaError('P2034'));
        });

        await expect(service.confirm(VENDOR_ID, PUBLIC_ID)).resolves.toEqual({
          status: 'invalid',
        });
        expect(orders.prepareDailyCounter.mock.calls).toEqual([
          [NOW],
          [new Date(NOW.getTime() + 2_000)],
        ]);
      } finally {
        vi.useRealTimers();
      }
    });

    it('lit un payload renvoyé sous forme de chaîne JSON', async () => {
      tx.$queryRaw.mockResolvedValue([
        lockedDraft({ payload: JSON.stringify(ORDER) }),
      ]);

      await expect(
        service.confirm(VENDOR_ID, PUBLIC_ID, NOW),
      ).resolves.toMatchObject({ status: 'confirmed', created: true });
    });

    it('renvoie la référence existante au double clic, sans rien créer', async () => {
      tx.$queryRaw.mockResolvedValue([
        lockedDraft({
          status: 'confirmed',
          payload: { ...ORDER, orderReference: 'CMD-20261113-004' },
        }),
      ]);

      await expect(service.confirm(VENDOR_ID, PUBLIC_ID, NOW)).resolves.toEqual(
        { status: 'confirmed', reference: 'CMD-20261113-004', created: false },
      );
      expect(orders.create).not.toHaveBeenCalled();
      expect(orderDraft.update).not.toHaveBeenCalled();
    });

    it.each([
      ['inconnu', []],
      ['d’un autre vendeur', [lockedDraft({ vendor_id: 3n })]],
      ['annulé', [lockedDraft({ status: 'cancelled' })]],
      ['expiré', [lockedDraft({ status: 'expired' })]],
      ['pending échu', [lockedDraft({ expires_at: NOW })]],
      ['confirmé sans référence', [lockedDraft({ status: 'confirmed' })]],
    ])('refuse un brouillon %s sans rien créer', async (_label, rows) => {
      tx.$queryRaw.mockResolvedValue(rows);

      await expect(service.confirm(VENDOR_ID, PUBLIC_ID, NOW)).resolves.toEqual(
        { status: 'invalid' },
      );
      expect(orders.create).not.toHaveBeenCalled();
      expect(orderDraft.update).not.toHaveBeenCalled();
    });

    it('lève une erreur si le payload d’un brouillon pending est illisible', async () => {
      tx.$queryRaw.mockResolvedValue([lockedDraft({ payload: { total: 1 } })]);

      await expect(service.confirm(VENDOR_ID, PUBLIC_ID, NOW)).rejects.toThrow(
        'Payload illisible',
      );
      expect(orders.create).not.toHaveBeenCalled();
    });

    it('relance toute la transaction sur interblocage (P2034)', async () => {
      tx.$queryRaw.mockResolvedValue([lockedDraft()]);
      orders.create
        .mockRejectedValueOnce(prismaError('P2034'))
        .mockResolvedValueOnce({ reference: 'CMD-20261113-002' });

      await expect(
        service.confirm(VENDOR_ID, PUBLIC_ID, NOW),
      ).resolves.toMatchObject({ reference: 'CMD-20261113-002' });
      expect(prisma.$transaction).toHaveBeenCalledTimes(2);
      expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    });

    it(`abandonne après ${CONFIRM_MAX_ATTEMPTS} conflits`, async () => {
      tx.$queryRaw.mockResolvedValue([lockedDraft()]);
      orders.create.mockRejectedValue(prismaError('P2034'));

      await expect(
        service.confirm(VENDOR_ID, PUBLIC_ID, NOW),
      ).rejects.toMatchObject({ code: 'P2034' });
      expect(prisma.$transaction).toHaveBeenCalledTimes(CONFIRM_MAX_ATTEMPTS);
    });

    it('ne relance pas sur une autre erreur', async () => {
      tx.$queryRaw.mockResolvedValue([lockedDraft()]);
      orders.create.mockRejectedValue(new Error('base indisponible'));

      await expect(service.confirm(VENDOR_ID, PUBLIC_ID, NOW)).rejects.toThrow(
        'base indisponible',
      );
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('cancel', () => {
    it('annule par mise à jour conditionnelle un pending non expiré du vendeur', async () => {
      orderDraft.updateMany.mockResolvedValue({ count: 1 });

      await expect(service.cancel(VENDOR_ID, PUBLIC_ID, NOW)).resolves.toEqual({
        status: 'cancelled',
      });
      expect(orderDraft.updateMany).toHaveBeenCalledWith({
        where: {
          publicId: PUBLIC_ID,
          vendorId: VENDOR_ID,
          status: 'pending',
          expiresAt: { gt: NOW },
        },
        data: { status: 'cancelled' },
      });
      expect(orderDraft.findFirst).not.toHaveBeenCalled();
    });

    it('renvoie la référence d’un brouillon déjà confirmé (PO-11)', async () => {
      orderDraft.updateMany.mockResolvedValue({ count: 0 });
      orderDraft.findFirst.mockResolvedValue({
        payload: { ...ORDER, orderReference: 'CMD-20261113-004' },
      });

      await expect(service.cancel(VENDOR_ID, PUBLIC_ID, NOW)).resolves.toEqual({
        status: 'already_confirmed',
        reference: 'CMD-20261113-004',
      });
      expect(orderDraft.findFirst).toHaveBeenCalledWith({
        where: {
          publicId: PUBLIC_ID,
          vendorId: VENDOR_ID,
          status: 'confirmed',
        },
        select: { payload: true },
      });
    });

    it.each([
      ['introuvable, expiré ou d’un autre vendeur', null],
      ['confirmé sans référence', { payload: ORDER }],
    ])('répond invalide pour un brouillon %s', async (_label, draft) => {
      orderDraft.updateMany.mockResolvedValue({ count: 0 });
      orderDraft.findFirst.mockResolvedValue(draft);

      await expect(service.cancel(VENDOR_ID, PUBLIC_ID, NOW)).resolves.toEqual({
        status: 'invalid',
      });
    });
  });

  describe('cancelLatestPending', () => {
    it('annule le brouillon pending non expiré le plus récent', async () => {
      orderDraft.findFirst.mockResolvedValue({ id: 12n });
      orderDraft.updateMany.mockResolvedValue({ count: 1 });

      await expect(service.cancelLatestPending(VENDOR_ID, NOW)).resolves.toBe(
        true,
      );
      expect(orderDraft.findFirst).toHaveBeenCalledWith({
        where: {
          vendorId: VENDOR_ID,
          status: 'pending',
          expiresAt: { gt: NOW },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { id: true },
      });
      expect(orderDraft.updateMany).toHaveBeenCalledWith({
        where: { id: 12n, status: 'pending' },
        data: { status: 'cancelled' },
      });
    });

    it('renvoie false sans brouillon en attente', async () => {
      orderDraft.findFirst.mockResolvedValue(null);

      await expect(service.cancelLatestPending(VENDOR_ID, NOW)).resolves.toBe(
        false,
      );
      expect(orderDraft.updateMany).not.toHaveBeenCalled();
    });

    it('renvoie false si le brouillon a changé entre-temps', async () => {
      orderDraft.findFirst.mockResolvedValue({ id: 12n });
      orderDraft.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.cancelLatestPending(VENDOR_ID, NOW)).resolves.toBe(
        false,
      );
    });
  });
});

describe('readDraftPayload', () => {
  it.each([
    ['null', null],
    ['un tableau', []],
    ['un article invalide', { ...ORDER, items: [{ label: 'x' }] }],
    ['une référence non textuelle', { ...ORDER, orderReference: 3 }],
    ['un total absent', { ...ORDER, total: undefined }],
    ['un JSON illisible (sans lever d’erreur)', '{"customerPhone":"0707'],
  ])('refuse %s', (_label, value) => {
    expect(readDraftPayload(value)).toBeNull();
  });
});
