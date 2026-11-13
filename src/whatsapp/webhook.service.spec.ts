import { createHmac } from 'node:crypto';
import { ForbiddenException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/index.js';
import { MessageProcessor } from './message-processor.js';
import { UNSIGNED_LOG_LIMIT_PER_MINUTE } from './unsigned-log-budget.js';
import {
  toLoggedPayload,
  UNSIGNED_LOG_PREVIEW_BYTES,
  WebhookService,
} from './webhook.service.js';

const VERIFY_TOKEN = 'jeton-verif';
const APP_SECRET = 'app-secret';
const CONFIG: Record<string, string> = {
  WEBHOOK_VERIFY_TOKEN: VERIFY_TOKEN,
  META_APP_SECRET: APP_SECRET,
};
const PAYLOAD = { entry: [] };
const RAW = Buffer.from(JSON.stringify(PAYLOAD));
const SIGNATURE = `sha256=${createHmac('sha256', APP_SECRET).update(RAW).digest('hex')}`;
const FORGED = SIGNATURE.replace(/.$/, (c) => (c === '0' ? '1' : '0'));
const UNSIGNED_LOG = {
  unsigned: true,
  size: RAW.length,
  preview: RAW.toString(),
};

describe('WebhookService', () => {
  const webhookLog = { create: vi.fn() };
  const processor = { process: vi.fn() };
  let service: WebhookService;
  let logs: ReturnType<typeof vi.spyOn>[];
  let errorLog: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.resetAllMocks();
    errorLog = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    logs = [
      errorLog,
      vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {}),
      vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {}),
    ];
    webhookLog.create.mockResolvedValue({});
    processor.process.mockResolvedValue(undefined);
    const moduleRef = await Test.createTestingModule({
      providers: [
        WebhookService,
        { provide: PrismaService, useValue: { webhookLog } },
        { provide: MessageProcessor, useValue: processor },
        {
          provide: ConfigService,
          useValue: { get: (key: string) => CONFIG[key] },
        },
      ],
    }).compile();
    service = moduleRef.get(WebhookService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('verifySubscription', () => {
    it('renvoie le challenge pour subscribe et le bon jeton', () => {
      expect(
        service.verifySubscription({
          mode: 'subscribe',
          verifyToken: VERIFY_TOKEN,
          challenge: '1158201444',
        }),
      ).toBe('1158201444');
    });

    it.each([
      ['un mauvais jeton', 'subscribe', 'mauvais', 'c'],
      ['un autre mode', 'unsubscribe', VERIFY_TOKEN, 'c'],
      ['un mode absent', undefined, VERIFY_TOKEN, 'c'],
      ['un jeton absent', 'subscribe', undefined, 'c'],
      ['un jeton en tableau', 'subscribe', [VERIFY_TOKEN], 'c'],
      ['un challenge absent', 'subscribe', VERIFY_TOKEN, undefined],
    ])('refuse en 403 %s', (_label, mode, verifyToken, challenge) => {
      expect(() =>
        service.verifySubscription({ mode, verifyToken, challenge }),
      ).toThrow(ForbiddenException);
    });

    it('journalise la vérification sans le jeton (PO-26)', () => {
      service.verifySubscription({
        mode: 'subscribe',
        verifyToken: VERIFY_TOKEN,
        challenge: 'c',
      });
      expect(() =>
        service.verifySubscription({
          mode: 'subscribe',
          verifyToken: 'jeton-tente',
          challenge: 'c',
        }),
      ).toThrow(ForbiddenException);

      const logged = logs.flatMap((spy) => spy.mock.calls.flat()).join('\n');
      expect(logged).toContain('acceptée');
      expect(logged).toContain('refusée');
      expect(logged).not.toContain(VERIFY_TOKEN);
      expect(logged).not.toContain('jeton-tente');
    });
  });

  describe('receive', () => {
    it('journalise signature_valid = 1 puis lance le traitement', async () => {
      await service.receive(RAW, SIGNATURE, PAYLOAD);

      expect(webhookLog.create).toHaveBeenCalledWith({
        data: { signatureValid: true, payload: PAYLOAD },
      });
      expect(processor.process).toHaveBeenCalledWith(PAYLOAD);
      expect(webhookLog.create.mock.invocationCallOrder[0]).toBeLessThan(
        processor.process.mock.invocationCallOrder[0],
      );
    });

    it.each([
      ['absente', undefined],
      ['falsifiée', FORGED],
    ])(
      'journalise signature_valid = 0 et refuse en 403 une signature %s',
      async (_label, signature) => {
        await expect(
          service.receive(RAW, signature, PAYLOAD),
        ).rejects.toBeInstanceOf(ForbiddenException);

        expect(webhookLog.create).toHaveBeenCalledWith({
          data: { signatureValid: false, payload: UNSIGNED_LOG },
        });
        expect(processor.process).not.toHaveBeenCalled();
      },
    );

    it('journalise un corps absent comme {} (aperçu)', async () => {
      await expect(
        service.receive(undefined, undefined, undefined),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(webhookLog.create).toHaveBeenCalledWith({
        data: {
          signatureValid: false,
          payload: { unsigned: true, size: 2, preview: '{}' },
        },
      });
    });

    it('n’écrit plus rien au-delà du plafond de POST non signés par minute, mais refuse toujours en 403', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-11-13T10:00:00Z'));
      const warnLog = logs[2];
      for (let i = 0; i < UNSIGNED_LOG_LIMIT_PER_MINUTE + 5; i += 1) {
        await expect(
          service.receive(RAW, FORGED, PAYLOAD),
        ).rejects.toBeInstanceOf(ForbiddenException);
      }
      expect(webhookLog.create).toHaveBeenCalledTimes(
        UNSIGNED_LOG_LIMIT_PER_MINUTE,
      );

      vi.setSystemTime(new Date('2026-11-13T10:01:00Z'));
      await expect(
        service.receive(RAW, FORGED, PAYLOAD),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await service.receive(RAW, SIGNATURE, PAYLOAD);

      expect(webhookLog.create).toHaveBeenCalledTimes(
        UNSIGNED_LOG_LIMIT_PER_MINUTE + 2,
      );
      const warned = warnLog.mock.calls.flat().join('\n');
      expect(warned).toContain('Plafond de 60 requêtes');
      expect(warned).toContain(
        '5 requête(s) webhook non signée(s) non journalisée(s)',
      );
      vi.useRealTimers();
    });

    it('ne plafonne pas les POST signés', async () => {
      for (let i = 0; i < UNSIGNED_LOG_LIMIT_PER_MINUTE + 5; i += 1) {
        await service.receive(RAW, SIGNATURE, PAYLOAD);
      }

      expect(webhookLog.create).toHaveBeenCalledTimes(
        UNSIGNED_LOG_LIMIT_PER_MINUTE + 5,
      );
    });

    it('n’attend pas le traitement et n’en remonte pas l’échec', async () => {
      processor.process.mockRejectedValue(new Error('inattendu'));

      await expect(
        service.receive(RAW, SIGNATURE, PAYLOAD),
      ).resolves.toBeUndefined();
      await vi.waitFor(() => expect(errorLog).toHaveBeenCalledOnce());
    });

    it('remonte l’échec d’écriture du journal sans rien traiter', async () => {
      webhookLog.create.mockRejectedValue(new Error('base indisponible'));

      await expect(service.receive(RAW, SIGNATURE, PAYLOAD)).rejects.toThrow(
        'base indisponible',
      );
      expect(processor.process).not.toHaveBeenCalled();
    });
  });
});

describe('toLoggedPayload', () => {
  const big = { data: 'x'.repeat(10_000) };
  const bigRaw = Buffer.from(JSON.stringify(big));

  it('garde tel quel un payload signé, même volumineux', () => {
    expect(toLoggedPayload(big, bigRaw, true)).toBe(big);
  });

  it('ne garde d’un payload non signé que sa taille et un aperçu de 256 octets', () => {
    const logged = toLoggedPayload(big, bigRaw, false);

    expect(logged).toEqual({
      unsigned: true,
      size: bigRaw.length,
      preview: bigRaw.subarray(0, UNSIGNED_LOG_PREVIEW_BYTES).toString('utf8'),
    });
  });

  it('garde un petit payload non signé en aperçu, sans son contenu analysé', () => {
    expect(toLoggedPayload(PAYLOAD, RAW, false)).toEqual({
      unsigned: true,
      size: RAW.length,
      preview: RAW.toString(),
    });
  });

  it('ne coupe pas un caractère multi-octets en fin d’aperçu', () => {
    const raw = Buffer.from(`"${'é'.repeat(200)}"`);
    const { preview } = toLoggedPayload('x', raw, false) as { preview: string };

    expect(Buffer.byteLength(preview)).toBeLessThanOrEqual(
      UNSIGNED_LOG_PREVIEW_BYTES,
    );
    expect(preview).not.toContain('\uFFFD');
    expect(preview).toBe(`"${'é'.repeat(127)}`);
  });

  it('aplatit un JSON très imbriqué (aucune profondeur conservée)', () => {
    const raw = Buffer.from('['.repeat(150) + ']'.repeat(150));

    expect(toLoggedPayload(JSON.parse(raw.toString()), raw, false)).toEqual({
      unsigned: true,
      size: 300,
      preview: '['.repeat(150) + ']'.repeat(106),
    });
  });

  it('mesure le payload analysé quand le corps brut manque', () => {
    expect(toLoggedPayload(big, undefined, false)).toMatchObject({
      unsigned: true,
      size: bigRaw.length,
    });
  });
});
