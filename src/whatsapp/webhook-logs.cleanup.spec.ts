import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/index.js';
import { WebhookLogsCleanup } from './webhook-logs.cleanup.js';

describe('WebhookLogsCleanup', () => {
  const webhookLog = { deleteMany: vi.fn() };
  let cleanup: WebhookLogsCleanup;
  let errorLog: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.resetAllMocks();
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    errorLog = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    const moduleRef = await Test.createTestingModule({
      providers: [
        WebhookLogsCleanup,
        { provide: PrismaService, useValue: { webhookLog } },
      ],
    }).compile();
    cleanup = moduleRef.get(WebhookLogsCleanup);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('supprime les journaux antérieurs à 90 jours', async () => {
    webhookLog.deleteMany.mockResolvedValue({ count: 4 });

    await expect(
      cleanup.purge(new Date('2026-11-13T03:00:00.000Z')),
    ).resolves.toBe(4);

    expect(webhookLog.deleteMany).toHaveBeenCalledWith({
      where: { createdAt: { lt: new Date('2026-08-15T03:00:00.000Z') } },
    });
  });

  it('journalise l’échec de la tâche planifiée sans le remonter', async () => {
    webhookLog.deleteMany.mockRejectedValue(new Error('base indisponible'));

    await expect(cleanup.run()).resolves.toBeUndefined();
    expect(errorLog).toHaveBeenCalledOnce();
  });
});
