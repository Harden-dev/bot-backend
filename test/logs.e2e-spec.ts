import { Writable } from 'node:stream';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AxiosError, type AxiosResponse } from 'axios';
import { PARAMS_PROVIDER_TOKEN, type Params } from 'nestjs-pino';
import { of, throwError } from 'rxjs';
import request from 'supertest';
import type { MockInstance } from 'vitest';
import { DraftsService } from '../src/bot/drafts.service.js';
import { buildPinoHttpOptions, maskPhone } from '../src/common/index.js';
import type { Env } from '../src/config/index.js';
import { PrismaService } from '../src/prisma/index.js';
import { MessageProcessor } from '../src/whatsapp/message-processor.js';
import {
  createApp,
  seedAdminWithToken,
  TEST_ADMIN,
} from './helpers/create-app.js';
import { resetDb } from './helpers/reset-db.js';
import { signMetaBody } from './helpers/sign.js';

const WEBHOOK = '/api/v1/whatsapp/webhook';
const VENDOR = '2250102030405';
const UNKNOWN = '2250908070605';
const CUSTOMER_PHONE = '0708091011';
const CUSTOMER_NAME = 'Mariam Traoré';
const LOCATION = 'Yopougon Selmer';
const ITEM_LABEL = 'pagnes wax indigo';
const ORDER_TEXT = [
  `Nom: ${CUSTOMER_NAME}`,
  'Téléphone: +225 07 08 09 10 11',
  `Lieu: ${LOCATION}`,
  `Articles: 2 ${ITEM_LABEL} x 12 000`,
].join('\n');
const META_ERROR = { error: { message: '(#131030) Recipient not allowed' } };

let wamidSequence = 0;

function payload(from: string, message: Record<string, unknown>) {
  wamidSequence += 1;
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'waba-id',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              messages: [
                {
                  id: `wamid.logs.${wamidSequence}`,
                  from,
                  timestamp: '1763000000',
                  ...message,
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

const text = (from: string, body: string) =>
  payload(from, { type: 'text', text: { body } });

const click = (from: string, id: string) =>
  payload(from, {
    type: 'interactive',
    interactive: { type: 'button_reply', button_reply: { id, title: 'x' } },
  });

function metaRejection() {
  return throwError(
    () =>
      new AxiosError('Request failed', 'ERR_BAD_REQUEST', undefined, {}, {
        status: 400,
        data: META_ERROR,
      } as AxiosResponse),
  );
}

/**
 * Parcours complet avec la configuration pino de production (redaction,
 * URL sans chaîne de requête) au niveau `debug`, journaux capturés en mémoire.
 * Le vrai `WhatsappClient` est utilisé ; seul `HttpService` est simulé.
 */
describe('Masquage des logs sur un parcours complet (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let config: ConfigService<Env, true>;
  let processSpy: MockInstance<MessageProcessor['process']>;
  let output = '';
  const http = { post: vi.fn() };

  const logStream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      output += chunk.toString();
      callback();
    },
  });

  async function sendSigned(body: unknown, signature?: string): Promise<void> {
    const raw = JSON.stringify(body);
    await request(app.getHttpServer())
      .post(WEBHOOK)
      .set('Content-Type', 'application/json')
      .set(
        'X-Hub-Signature-256',
        signature ??
          signMetaBody(raw, config.get('META_APP_SECRET', { infer: true })),
      )
      .send(raw);
    await Promise.all(processSpy.mock.results.map((result) => result.value));
  }

  beforeAll(async () => {
    const params: Params = {
      pinoHttp: [
        { ...buildPinoHttpOptions('production'), level: 'debug' },
        logStream,
      ],
    };
    app = await createApp((builder) =>
      builder
        .overrideProvider(PARAMS_PROVIDER_TOKEN)
        .useValue(params)
        .overrideProvider(HttpService)
        .useValue(http),
    );
    prisma = app.get(PrismaService);
    config = app.get<ConfigService<Env, true>>(ConfigService);
    processSpy = vi.spyOn(app.get(MessageProcessor), 'process');
    await resetDb(prisma);
  });

  afterAll(async () => {
    await resetDb(prisma);
    await app.close();
  });

  it('ne journalise ni secret, ni jeton, ni signature, ni contenu, ni téléphone en clair', async () => {
    http.post.mockReturnValue(of({ data: {} }));
    const server = app.getHttpServer();
    const seededToken = await seedAdminWithToken(app);
    await prisma.vendor.create({
      data: { name: 'Boutique Logs', whatsappNumber: VENDOR },
    });
    const verifyToken = config.get('WEBHOOK_VERIFY_TOKEN', { infer: true });

    // Vérification Meta (jeton dans la chaîne de requête).
    await request(server)
      .get(WEBHOOK)
      .query({
        'hub.mode': 'subscribe',
        'hub.verify_token': verifyToken,
        'hub.challenge': 'defi-42',
      })
      .expect(200);

    // Webhook signé -> récapitulatif -> Valider -> commande en base.
    await sendSigned(text(VENDOR, ORDER_TEXT));
    const buttons = http.post.mock.lastCall?.[1] as {
      interactive: { action: { buttons: { reply: { id: string } }[] } };
    };
    const validateId = buttons.interactive.action.buttons[0].reply.id;
    await sendSigned(click(VENDOR, validateId));
    const order = await prisma.order.findFirstOrThrow();
    expect(order.customerPhone).toBe(CUSTOMER_PHONE);

    // Numéro inconnu, refus d'envoi par Meta (4xx), panne de traitement (PO-24).
    await sendSigned(text(UNKNOWN, ORDER_TEXT));
    http.post.mockReturnValueOnce(metaRejection());
    await sendSigned(text(VENDOR, 'aide'));
    vi.spyOn(app.get(DraftsService), 'create').mockRejectedValueOnce(
      new Error('panne simulée'),
    );
    await sendSigned(text(VENDOR, ORDER_TEXT));

    // Signature falsifiée.
    await sendSigned(text(VENDOR, ORDER_TEXT), 'sha256=signature-falsifiee');

    // Backoffice : connexion, recherche par téléphone, détail.
    const login = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: TEST_ADMIN.email, password: TEST_ADMIN.password })
      .expect(200);
    const accessToken = String(login.body.accessToken);
    await request(server)
      .get('/api/v1/orders')
      .query({ search: CUSTOMER_PHONE })
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    await request(server)
      .get(`/api/v1/orders/${order.id}`)
      .set('Authorization', `Bearer ${seededToken}`)
      .expect(200);
    await new Promise((resolve) => setImmediate(resolve));

    // Les journaux ont bien été produits pour chaque étape.
    expect(output).toContain('Vérification du webhook acceptée');
    expect(output).toContain(`Commande ${order.reference} enregistrée`);
    expect(output).toContain(maskPhone(UNKNOWN));
    expect(output).toContain(`Envoi WhatsApp vers ${maskPhone(VENDOR)}`);
    expect(output).toContain('Échec du traitement du message');
    expect(output).toContain('signature absente ou invalide');
    expect(output).toContain('/api/v1/auth/login');
    expect(output).toContain('[Redacted]');

    const forbidden = [
      config.get('JWT_SECRET', { infer: true }),
      config.get('META_APP_SECRET', { infer: true }),
      config.get('WHATSAPP_TOKEN', { infer: true }),
      verifyToken,
      config.get('ADMIN_PASSWORD', { infer: true }),
      TEST_ADMIN.password,
      accessToken,
      seededToken,
      'signature-falsifiee',
      'hub.verify_token',
      'sha256=',
      VENDOR,
      UNKNOWN,
      CUSTOMER_PHONE,
      '07 08 09 10 11',
      CUSTOMER_NAME,
      LOCATION,
      ITEM_LABEL,
      validateId,
    ];
    for (const value of forbidden) {
      expect(output, `valeur journalisée : ${value}`).not.toContain(value);
    }
  });
});
