import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/index.js';
import { DraftsCleanup } from './drafts.cleanup.js';

describe('DraftsCleanup', () => {
  const orderDraft = { updateMany: vi.fn(), deleteMany: vi.fn() };
  let cleanup: DraftsCleanup;
  let errorLog: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.resetAllMocks();
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    errorLog = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    const moduleRef = await Test.createTestingModule({
      providers: [
        DraftsCleanup,
        { provide: PrismaService, useValue: { orderDraft } },
      ],
    }).compile();
    cleanup = moduleRef.get(DraftsCleanup);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('expire les pending échus puis supprime les brouillons finis depuis plus de 7 jours', async () => {
    const now = new Date('2026-11-13T10:00:00.000Z');
    orderDraft.updateMany.mockResolvedValue({ count: 2 });
    orderDraft.deleteMany.mockResolvedValue({ count: 5 });

    await expect(cleanup.cleanup(now)).resolves.toEqual({
      expired: 2,
      deleted: 5,
    });

    expect(orderDraft.updateMany).toHaveBeenCalledWith({
      where: { status: 'pending', expiresAt: { lte: now } },
      data: { status: 'expired' },
    });
    expect(orderDraft.deleteMany).toHaveBeenCalledWith({
      where: {
        status: { in: ['expired', 'cancelled', 'confirmed'] },
        expiresAt: { lt: new Date('2026-11-06T10:00:00.000Z') },
      },
    });
    expect(orderDraft.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      orderDraft.deleteMany.mock.invocationCallOrder[0],
    );
  });

  it('journalise l’échec de la tâche planifiée sans le remonter', async () => {
    orderDraft.updateMany.mockRejectedValue(new Error('base indisponible'));

    await expect(cleanup.run()).resolves.toBeUndefined();
    expect(errorLog).toHaveBeenCalledOnce();
  });
});
