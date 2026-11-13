import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/index.js';
import { WhatsappClient } from './client/index.js';
import { type IncomingMessage, MESSAGE_HANDLER } from './contracts.js';
import {
  MessageProcessor,
  PROCESSING_ERROR_MESSAGE,
  SHUTDOWN_TIMEOUT_MS,
} from './message-processor.js';

const FROM = '2250707070707';
const OTHER = '2250505050505';
const MASKED_FROM = '22*******0707';

function textMessage(id: string, from = FROM) {
  return { id, from, type: 'text', text: { body: 'Bonjour' } };
}

function payload(...messages: unknown[]) {
  return { entry: [{ changes: [{ value: { messages } }] }] };
}

function prismaError(code: string) {
  return new Prisma.PrismaClientKnownRequestError('erreur', {
    code,
    clientVersion: 'test',
  });
}

/** Promesse contrôlée par le test. */
function deferred() {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('MessageProcessor', () => {
  const processedMessage = { create: vi.fn() };
  const client = { sendText: vi.fn(), sendButtons: vi.fn() };
  const handler = { handle: vi.fn() };
  let processor: MessageProcessor;
  let errorLog: ReturnType<typeof vi.spyOn>;
  let warnLog: ReturnType<typeof vi.spyOn>;

  const handled = () =>
    handler.handle.mock.calls.map(
      ([message]) => (message as IncomingMessage).wamid,
    );

  beforeEach(async () => {
    vi.resetAllMocks();
    errorLog = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    warnLog = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    processedMessage.create.mockResolvedValue({});
    handler.handle.mockResolvedValue(undefined);
    client.sendText.mockResolvedValue(undefined);
    const moduleRef = await Test.createTestingModule({
      providers: [
        MessageProcessor,
        { provide: PrismaService, useValue: { processedMessage } },
        { provide: WhatsappClient, useValue: client },
        { provide: MESSAGE_HANDLER, useValue: handler },
      ],
    }).compile();
    processor = moduleRef.get(MessageProcessor);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('enregistre le wamid puis transmet le message normalisé', async () => {
    await processor.process(payload(textMessage('w1')));

    expect(processedMessage.create).toHaveBeenCalledWith({
      data: { wamid: 'w1' },
    });
    expect(handler.handle).toHaveBeenCalledExactlyOnceWith({
      wamid: 'w1',
      from: FROM,
      type: 'text',
      text: 'Bonjour',
    });
    expect(processedMessage.create.mock.invocationCallOrder[0]).toBeLessThan(
      handler.handle.mock.invocationCallOrder[0],
    );
  });

  it('ignore un message déjà traité (P2002) sans répondre', async () => {
    processedMessage.create.mockRejectedValue(prismaError('P2002'));

    await processor.process(payload(textMessage('w1')));

    expect(handler.handle).not.toHaveBeenCalled();
    expect(client.sendText).not.toHaveBeenCalled();
    expect(errorLog).not.toHaveBeenCalled();
  });

  it('traite chaque message individuellement, dans l’ordre', async () => {
    processedMessage.create
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(prismaError('P2002'))
      .mockResolvedValueOnce({});

    await processor.process(
      payload(textMessage('w1'), textMessage('w2'), textMessage('w3')),
    );

    expect(handled()).toEqual(['w1', 'w3']);
  });

  it('ne traite rien pour des statuses[] seuls', async () => {
    await processor.process({
      entry: [{ changes: [{ value: { statuses: [{ id: 'w1' }] } }] }],
    });

    expect(processedMessage.create).not.toHaveBeenCalled();
    expect(handler.handle).not.toHaveBeenCalled();
  });

  it('ne traite rien pour une structure globale inattendue (PO-29)', async () => {
    await processor.process({ entry: 'inattendu' });

    expect(processedMessage.create).not.toHaveBeenCalled();
    expect(handler.handle).not.toHaveBeenCalled();
    expect(warnLog).toHaveBeenCalledOnce();
  });

  it('écarte un message mal formé avec un warn sans contenu et traite les autres (PO-29)', async () => {
    await processor.process(
      payload(
        { id: 'w'.repeat(121), from: FROM, type: 'text', text: { body: 'x' } },
        textMessage('w2'),
      ),
    );

    expect(handled()).toEqual(['w2']);
    expect(warnLog).toHaveBeenCalledExactlyOnceWith(
      '1 message(s) webhook mal formé(s) ignoré(s)',
    );
    expect(client.sendText).not.toHaveBeenCalled();
  });

  it('capture une exception du traitement, la journalise et prévient le vendeur (PO-24)', async () => {
    handler.handle
      .mockRejectedValueOnce(new Error('échec'))
      .mockResolvedValueOnce(undefined);

    await expect(
      processor.process(payload(textMessage('w1'), textMessage('w2'))),
    ).resolves.toBeUndefined();

    expect(client.sendText).toHaveBeenCalledExactlyOnceWith(
      FROM,
      PROCESSING_ERROR_MESSAGE,
    );
    expect(handled()).toEqual(['w1', 'w2']);
    const [message] = errorLog.mock.calls[0] as [string];
    expect(message).toContain('w1');
    expect(message).toContain(MASKED_FROM);
    expect(message).not.toContain(FROM);
  });

  it('traite une erreur de base (autre que P2002) comme un échec, sans détail Prisma', async () => {
    processedMessage.create.mockRejectedValue(prismaError('P1001'));

    await processor.process(payload(textMessage('w1')));

    expect(handler.handle).not.toHaveBeenCalled();
    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining('PrismaClientKnownRequestError code=P1001'),
    );
    expect(client.sendText).toHaveBeenCalledWith(
      FROM,
      PROCESSING_ERROR_MESSAGE,
    );
  });

  it('journalise et ignore l’échec de l’envoi du message d’erreur', async () => {
    handler.handle.mockRejectedValue(new Error('échec'));
    client.sendText.mockRejectedValue(new Error('réseau'));

    await expect(
      processor.process(payload(textMessage('w1'))),
    ).resolves.toBeUndefined();

    expect(warnLog).toHaveBeenCalledWith(expect.stringContaining(MASKED_FROM));
  });

  describe('file par expéditeur', () => {
    it('traite deux payloads du même expéditeur dans l’ordre, jamais en parallèle', async () => {
      const first = deferred();
      handler.handle
        .mockReturnValueOnce(first.promise)
        .mockResolvedValueOnce(undefined);

      const a = processor.process(payload(textMessage('w1')));
      const b = processor.process(payload(textMessage('w2')));
      await vi.waitFor(() => expect(handled()).toEqual(['w1']));
      await new Promise((resolve) => setImmediate(resolve));
      expect(handled()).toEqual(['w1']);
      expect(processedMessage.create).toHaveBeenCalledOnce();

      first.resolve();
      await Promise.all([a, b]);

      expect(handled()).toEqual(['w1', 'w2']);
      expect(processor['queues'].size).toBe(0);
    });

    it('traite deux expéditeurs différents en parallèle', async () => {
      const first = deferred();
      handler.handle
        .mockReturnValueOnce(first.promise)
        .mockResolvedValueOnce(undefined);

      const a = processor.process(payload(textMessage('w1', FROM)));
      const b = processor.process(payload(textMessage('w2', OTHER)));
      await b;

      expect(handled()).toEqual(['w1', 'w2']);
      first.resolve();
      await a;
      expect(processor['queues'].size).toBe(0);
    });

    it('continue la file après une erreur', async () => {
      handler.handle
        .mockRejectedValueOnce(new Error('échec'))
        .mockResolvedValueOnce(undefined);

      await Promise.all([
        processor.process(payload(textMessage('w1'))),
        processor.process(payload(textMessage('w2'))),
      ]);

      expect(handled()).toEqual(['w1', 'w2']);
      expect(processor['queues'].size).toBe(0);
    });
  });

  describe('arrêt propre', () => {
    it('attend les traitements en cours', async () => {
      const pending = deferred();
      handler.handle.mockReturnValueOnce(pending.promise);
      const running = processor.process(payload(textMessage('w1')));
      await vi.waitFor(() => expect(handler.handle).toHaveBeenCalledOnce());

      let stopped = false;
      const stopping = processor.onModuleDestroy().then(() => {
        stopped = true;
      });
      await new Promise((resolve) => setImmediate(resolve));
      expect(stopped).toBe(false);

      pending.resolve();
      await stopping;
      await running;
      expect(warnLog).not.toHaveBeenCalled();
    });

    it('rend la main après 10 s si un traitement ne se termine pas', async () => {
      vi.useFakeTimers();
      handler.handle.mockReturnValueOnce(new Promise<void>(() => {}));
      void processor.process(payload(textMessage('w1')));
      await vi.waitFor(() => expect(handler.handle).toHaveBeenCalledOnce());

      const stopping = processor.onModuleDestroy();
      await vi.advanceTimersByTimeAsync(SHUTDOWN_TIMEOUT_MS);

      await expect(stopping).resolves.toBeUndefined();
      expect(warnLog).toHaveBeenCalledWith(
        expect.stringContaining('interrompu'),
      );
    });

    it('rend la main immédiatement sans traitement en cours', async () => {
      await expect(processor.onModuleDestroy()).resolves.toBeUndefined();
    });
  });
});
