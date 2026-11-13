import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/index.js';
import {
  DATABASE_UNAVAILABLE_MESSAGE,
  HealthService,
} from './health.service.js';

describe('HealthService', () => {
  const queryRaw = vi.fn();
  let service: HealthService;

  beforeEach(async () => {
    queryRaw.mockReset();
    const moduleRef = await Test.createTestingModule({
      providers: [
        HealthService,
        { provide: PrismaService, useValue: { $queryRaw: queryRaw } },
      ],
    }).compile();
    service = moduleRef.get(HealthService);
  });

  it('renvoie { status: "ok" } quand la base répond', async () => {
    queryRaw.mockResolvedValue([{ 1: 1n }]);

    await expect(service.check()).resolves.toEqual({ status: 'ok' });
    expect(queryRaw).toHaveBeenCalledOnce();
  });

  it('lève 503 et journalise l’erreur quand la base ne répond pas', async () => {
    const logError = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    queryRaw.mockRejectedValue(new Error('connect ECONNREFUSED'));

    const check = service.check();

    await expect(check).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(check).rejects.toThrow(DATABASE_UNAVAILABLE_MESSAGE);
    expect(logError).toHaveBeenCalledWith(
      expect.stringContaining('connect ECONNREFUSED'),
    );
    logError.mockRestore();
  });
});
