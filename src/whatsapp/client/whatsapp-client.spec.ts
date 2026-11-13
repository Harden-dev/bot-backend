import { HttpService } from '@nestjs/axios';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { AxiosError, type AxiosResponse } from 'axios';
import { of, throwError } from 'rxjs';
import {
  MAX_LOGGED_RESPONSE_LENGTH,
  RETRY_DELAY_MS,
  WhatsappClient,
  WhatsappSendError,
} from './whatsapp-client.js';

const TOKEN = 'secret-whatsapp-token';
const CONFIG: Record<string, string> = {
  GRAPH_API_VERSION: 'v23.0',
  PHONE_NUMBER_ID: '1234567890',
  WHATSAPP_TOKEN: TOKEN,
};
const URL = 'https://graph.facebook.com/v23.0/1234567890/messages';
const TO = '2250707070707';
const META_ERROR = {
  error: { message: '(#131030) Recipient not in allowed list', code: 131030 },
};

function httpError(status: number, data: unknown = META_ERROR) {
  return new AxiosError('Request failed', 'ERR_BAD_RESPONSE', undefined, {}, {
    status,
    data,
  } as AxiosResponse);
}

function networkError() {
  return new AxiosError('socket hang up', 'ECONNRESET');
}

const ok = () => of({ data: { messages: [{ id: 'wamid.out' }] } });
const fail = (error: Error) => throwError(() => error);

describe('WhatsappClient', () => {
  const http = { post: vi.fn() };
  let client: WhatsappClient;
  let errorLog: ReturnType<typeof vi.spyOn>;
  let warnLog: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.resetAllMocks();
    errorLog = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    warnLog = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    const moduleRef = await Test.createTestingModule({
      providers: [
        WhatsappClient,
        { provide: HttpService, useValue: http },
        {
          provide: ConfigService,
          useValue: { get: (key: string) => CONFIG[key] },
        },
      ],
    }).compile();
    client = moduleRef.get(WhatsappClient);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function loggedText(): string {
    return [...errorLog.mock.calls, ...warnLog.mock.calls]
      .flat()
      .map(String)
      .join('\n');
  }

  describe('sendText', () => {
    it('envoie un message texte à l’URL Graph avec le jeton Bearer', async () => {
      http.post.mockReturnValue(ok());

      await client.sendText(TO, 'Bonjour');

      expect(http.post).toHaveBeenCalledExactlyOnceWith(
        URL,
        {
          messaging_product: 'whatsapp',
          to: TO,
          type: 'text',
          text: { body: 'Bonjour' },
        },
        { headers: { Authorization: `Bearer ${TOKEN}` } },
      );
    });
  });

  it('accepte un texte de 4 096 caractères et refuse au-delà sans appeler Meta', async () => {
    http.post.mockReturnValue(ok());

    await client.sendText(TO, 'a'.repeat(4096));
    await expect(client.sendText(TO, 'a'.repeat(4097))).rejects.toThrow(
      RangeError,
    );
    expect(http.post).toHaveBeenCalledOnce();
  });

  describe('sendButtons', () => {
    const buttons = [
      { id: 'valider:abc', title: 'Valider' },
      { id: 'modifier:abc', title: 'Modifier' },
      { id: 'annuler:abc', title: 'Annuler' },
    ];

    it('envoie un message interactif à boutons de réponse', async () => {
      http.post.mockReturnValue(ok());

      await client.sendButtons(TO, 'Récapitulatif', buttons);

      expect(http.post).toHaveBeenCalledWith(
        URL,
        {
          messaging_product: 'whatsapp',
          to: TO,
          type: 'interactive',
          interactive: {
            type: 'button',
            body: { text: 'Récapitulatif' },
            action: {
              buttons: buttons.map((reply) => ({ type: 'reply', reply })),
            },
          },
        },
        { headers: { Authorization: `Bearer ${TOKEN}` } },
      );
    });

    it('accepte les limites exactes (3 boutons, titre de 20, corps de 1 024)', async () => {
      http.post.mockReturnValue(ok());

      await expect(
        client.sendButtons(TO, 'a'.repeat(1024), [
          { id: 'i'.repeat(256), title: 't'.repeat(20) },
          { id: 'b', title: 'b' },
          { id: 'c', title: 'c' },
        ]),
      ).resolves.toBeUndefined();
    });

    it.each([
      ['aucun bouton', 'corps', []],
      ['4 boutons', 'corps', [...buttons, { id: 'x', title: 'x' }]],
      ['titre de 21 caractères', 'corps', [{ id: 'a', title: 't'.repeat(21) }]],
      ['corps de 1 025 caractères', 'a'.repeat(1025), [buttons[0]]],
      ['titre vide', 'corps', [{ id: 'a', title: '' }]],
      ['identifiant vide', 'corps', [{ id: '', title: 'Valider' }]],
      [
        'identifiant de 257 caractères',
        'corps',
        [{ id: 'i'.repeat(257), title: 'Valider' }],
      ],
      [
        'titres en double',
        'corps',
        [
          { id: 'a', title: 'Valider' },
          { id: 'b', title: 'Valider' },
        ],
      ],
    ])('refuse %s sans appeler Meta', async (_label, body, list) => {
      await expect(client.sendButtons(TO, body, list)).rejects.toThrow(
        RangeError,
      );
      expect(http.post).not.toHaveBeenCalled();
    });
  });

  describe('nouvelle tentative', () => {
    it.each([
      ['une erreur réseau', networkError()],
      ['une erreur 500', httpError(500)],
      ['une erreur 503', httpError(503)],
    ])('réessaie une seule fois après 2 s sur %s', async (_label, error) => {
      vi.useFakeTimers();
      http.post.mockReturnValueOnce(fail(error)).mockReturnValueOnce(ok());

      const sending = client.sendText(TO, 'Bonjour');
      await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS - 1);
      expect(http.post).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);

      await expect(sending).resolves.toBeUndefined();
      expect(http.post).toHaveBeenCalledTimes(2);
    });

    it('lève WhatsappSendError après deux échecs, sans troisième tentative', async () => {
      vi.useFakeTimers();
      http.post.mockReturnValue(fail(httpError(502)));

      const sending = client.sendText(TO, 'Bonjour');
      const assertion = expect(sending).rejects.toMatchObject({
        name: 'WhatsappSendError',
        status: 502,
      });
      await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS * 3);

      await assertion;
      expect(http.post).toHaveBeenCalledTimes(2);
    });

    it('ne réessaie pas une erreur 4xx et journalise le corps de la réponse Meta', async () => {
      http.post.mockReturnValue(fail(httpError(400)));

      await expect(client.sendText(TO, 'Bonjour')).rejects.toBeInstanceOf(
        WhatsappSendError,
      );

      expect(http.post).toHaveBeenCalledTimes(1);
      expect(errorLog).toHaveBeenCalledOnce();
      expect(loggedText()).toContain('HTTP 400');
      expect(loggedText()).toContain('Recipient not in allowed list');
    });
  });

  describe('journalisation', () => {
    it('tronque le corps de réponse Meta journalisé à 1 000 caractères', async () => {
      http.post.mockReturnValue(
        fail(httpError(400, { error: { message: 'm'.repeat(5000) } })),
      );

      await expect(client.sendText(TO, 'Bonjour')).rejects.toBeInstanceOf(
        WhatsappSendError,
      );

      const [message] = errorLog.mock.calls[0] as [string];
      const body = message.split('réponse Meta : ')[1];
      expect(body).toHaveLength(MAX_LOGGED_RESPONSE_LENGTH);
    });

    it('ne journalise ni le jeton, ni le contenu, ni le numéro en clair', async () => {
      vi.useFakeTimers();
      http.post.mockReturnValueOnce(fail(networkError()));
      http.post.mockReturnValueOnce(fail(httpError(401)));

      const sending = client.sendText(TO, 'Message confidentiel');
      const assertion =
        expect(sending).rejects.toBeInstanceOf(WhatsappSendError);
      await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS);
      await assertion;

      const logs = loggedText();
      expect(logs).toContain('ECONNRESET');
      expect(logs).toContain('22*******0707');
      expect(logs).not.toContain(TOKEN);
      expect(logs).not.toContain('Message confidentiel');
      expect(logs).not.toContain(TO);
    });
  });
});
