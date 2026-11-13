import { createHmac } from 'node:crypto';
import { ForbiddenException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/index.js';
import { MessageProcessor } from './message-processor.js';
import {
  MAX_UNSIGNED_LOG_BYTES,
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
          data: { signatureValid: false, payload: PAYLOAD },
        });
        expect(processor.process).not.toHaveBeenCalled();
      },
    );

    it('journalise un corps absent sous forme d’objet vide', async () => {
      await expect(
        service.receive(undefined, undefined, undefined),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(webhookLog.create).toHaveBeenCalledWith({
        data: { signatureValid: false, payload: {} },
      });
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
  const big = { data: 'x'.repeat(MAX_UNSIGNED_LOG_BYTES) };
  const bigRaw = Buffer.from(JSON.stringify(big));

  it('garde tel quel un payload signé, même volumineux', () => {
    expect(toLoggedPayload(big, bigRaw, true)).toBe(big);
  });

  it('garde tel quel un payload non signé de 4 ko au plus', () => {
    const payload = { data: 'x'.repeat(MAX_UNSIGNED_LOG_BYTES - 20) };
    const raw = Buffer.from(JSON.stringify(payload));
    expect(raw.length).toBeLessThanOrEqual(MAX_UNSIGNED_LOG_BYTES);

    expect(toLoggedPayload(payload, raw, false)).toBe(payload);
  });

  it('tronque un payload non signé de plus de 4 ko en JSON valide', () => {
    const logged = toLoggedPayload(big, bigRaw, false);

    expect(logged).toEqual({
      truncated: true,
      size: bigRaw.length,
      preview: bigRaw.subarray(0, UNSIGNED_LOG_PREVIEW_BYTES).toString('utf8'),
    });
    expect(Buffer.byteLength(JSON.stringify(logged))).toBeLessThanOrEqual(
      MAX_UNSIGNED_LOG_BYTES,
    );
  });

  it('mesure le payload analysé quand le corps brut manque', () => {
    expect(toLoggedPayload(big, undefined, false)).toMatchObject({
      truncated: true,
      size: bigRaw.length,
    });
  });

  it('journalise {} pour un corps absent ou non lu', () => {
    expect(toLoggedPayload(undefined, undefined, false)).toEqual({});
  });
});
