import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { MockInstance } from 'vitest';
import { PROCESSING_ERROR_MESSAGE } from '../src/bot/index.js';
import { DraftsCleanup } from '../src/bot/drafts.cleanup.js';
import { DraftsService } from '../src/bot/drafts.service.js';
import {
  DRAFT_NO_LONGER_VALID_MESSAGE,
  MODIFY_MESSAGE,
  NO_ORDERS_MESSAGE,
  NO_PENDING_DRAFT_MESSAGE,
  ORDER_CANCELLED_MESSAGE,
  ORDER_TEMPLATE,
  orderAlreadyRecordedMessage,
  orderConfirmedMessage,
  PARSE_ERRORS,
  parseErrorsMessage,
  RECAP_TOO_LONG_MESSAGE,
  UNAUTHORIZED_MESSAGE,
  UNSUPPORTED_MESSAGE,
} from '../src/bot/messages.js';
import type { Env } from '../src/config/index.js';
import { OrdersService } from '../src/orders/index.js';
import { PrismaService } from '../src/prisma/index.js';
import {
  WhatsappClient,
  WhatsappSendError,
} from '../src/whatsapp/client/index.js';
import { MessageProcessor } from '../src/whatsapp/message-processor.js';
import { createApp } from './helpers/create-app.js';
import { resetDb } from './helpers/reset-db.js';
import { signMetaBody } from './helpers/sign.js';

const WEBHOOK = '/api/v1/whatsapp/webhook';
const VENDOR_A = '2250707070707';
const VENDOR_B = '2250505050505';
const INACTIVE = '2250101010101';
const UNKNOWN = '2250909090909';
const DAY_MS = 24 * 60 * 60 * 1000;
const REFERENCE = /^CMD-\d{8}-\d{3,}$/;

const ORDER_TEXT = [
  'Nom: Awa Koné',
  'Téléphone: +225 07 07 07 07 07',
  'Lieu: Cocody Angré 8e tranche',
  'Articles: 2 robes bleues x 15 000, 1 sac noir x 8000F',
].join('\n');

const RECAP = [
  'Récapitulatif de la commande',
  'Client : Awa Koné',
  'Tél : 0707070707',
  'Lieu : Cocody Angré 8e tranche',
  'Articles :',
  '• 2 × robes bleues — 15 000 F = 30 000 F',
  '• 1 × sac noir — 8 000 F',
  'Total : 38 000 F CFA',
].join('\n');

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
                  id: `wamid.bot.${wamidSequence}`,
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

describe('Bot WhatsApp (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let appSecret: string;
  let ttlMinutes: number;
  let processSpy: MockInstance<MessageProcessor['process']>;
  const client = { sendText: vi.fn(), sendButtons: vi.fn() };
  let vendorA: bigint;

  /** POST signé puis attente de la fin du traitement asynchrone. */
  async function send(body: unknown): Promise<void> {
    const raw = JSON.stringify(body);
    await request(app.getHttpServer())
      .post(WEBHOOK)
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', signMetaBody(raw, appSecret))
      .send(raw)
      .expect(200);
    await Promise.all(processSpy.mock.results.map((result) => result.value));
  }

  /** Envoie la commande type et renvoie le `public_id` lu dans les boutons. */
  async function sendOrder(from = VENDOR_A): Promise<string> {
    await send(text(from, ORDER_TEXT));
    const buttons = client.sendButtons.mock.lastCall?.[2] as { id: string }[];
    return buttons[0].id.split(':')[1];
  }

  function lastText(): string {
    return client.sendText.mock.lastCall?.[1] as string;
  }

  beforeAll(async () => {
    app = await createApp((builder) =>
      builder.overrideProvider(WhatsappClient).useValue(client),
    );
    prisma = app.get(PrismaService);
    const config = app.get<ConfigService<Env, true>>(ConfigService);
    appSecret = config.get('META_APP_SECRET', { infer: true });
    ttlMinutes = config.get('DRAFT_TTL_MINUTES', { infer: true });
    processSpy = vi.spyOn(app.get(MessageProcessor), 'process');
  });

  beforeEach(async () => {
    await resetDb(prisma);
    processSpy.mockClear();
    client.sendText.mockReset().mockResolvedValue(undefined);
    client.sendButtons.mockReset().mockResolvedValue(undefined);
    const created = await prisma.vendor.create({
      data: { name: 'Boutique A', whatsappNumber: VENDOR_A },
    });
    vendorA = created.id;
    await prisma.vendor.createMany({
      data: [
        { name: 'Boutique B', whatsappNumber: VENDOR_B },
        { name: 'Inactif', whatsappNumber: INACTIVE, isActive: false },
      ],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('bout en bout', () => {
    it('webhook signé -> récapitulatif -> clic Valider -> commande en base', async () => {
      const before = Date.now();
      const publicId = await sendOrder();

      expect(client.sendButtons).toHaveBeenCalledExactlyOnceWith(
        VENDOR_A,
        RECAP,
        [
          { id: `valider:${publicId}`, title: 'Valider' },
          { id: `modifier:${publicId}`, title: 'Modifier' },
          { id: `annuler:${publicId}`, title: 'Annuler' },
        ],
      );
      const draft = await prisma.orderDraft.findUniqueOrThrow({
        where: { publicId },
      });
      expect(publicId).toHaveLength(12);
      expect(draft).toMatchObject({ vendorId: vendorA, status: 'pending' });
      expect(draft.payload).toEqual({
        customerName: 'Awa Koné',
        customerPhone: '0707070707',
        deliveryLocation: 'Cocody Angré 8e tranche',
        items: [
          { label: 'robes bleues', quantity: 2, unitPrice: 15_000 },
          { label: 'sac noir', quantity: 1, unitPrice: 8_000 },
        ],
        total: 38_000,
      });
      expect(draft.expiresAt.getTime() - draft.createdAt.getTime()).toBe(
        ttlMinutes * 60_000,
      );
      expect(draft.createdAt.getTime()).toBeGreaterThanOrEqual(before - 5);

      await send(click(VENDOR_A, `valider:${publicId}`));

      const order = await prisma.order.findFirstOrThrow({
        include: { items: { orderBy: { id: 'asc' } }, statusHistory: true },
      });
      expect(order.reference).toMatch(REFERENCE);
      expect(order).toMatchObject({
        vendorId: vendorA,
        customerName: 'Awa Koné',
        customerPhone: '0707070707',
        deliveryLocation: 'Cocody Angré 8e tranche',
        status: 'non_traitee',
        totalAmount: 38_000,
        notes: null,
      });
      expect(order.items).toMatchObject([
        { label: 'robes bleues', quantity: 2, unitPrice: 15_000 },
        { label: 'sac noir', quantity: 1, unitPrice: 8_000 },
      ]);
      expect(order.statusHistory).toMatchObject([
        { fromStatus: null, toStatus: 'non_traitee', changedByUserId: null },
      ]);
      const confirmed = await prisma.orderDraft.findUniqueOrThrow({
        where: { publicId },
      });
      expect(confirmed.status).toBe('confirmed');
      expect(confirmed.payload).toMatchObject({
        orderReference: order.reference,
      });
      expect(lastText()).toBe(orderConfirmedMessage(order.reference));
    });

    it('un second clic sur Valider ne crée rien et renvoie la référence', async () => {
      const publicId = await sendOrder();
      await send(click(VENDOR_A, `valider:${publicId}`));
      const { reference } = await prisma.order.findFirstOrThrow();

      await send(click(VENDOR_A, `valider:${publicId}`));

      await expect(prisma.order.count()).resolves.toBe(1);
      expect(client.sendText).toHaveBeenCalledTimes(2);
      expect(lastText()).toBe(orderConfirmedMessage(reference));
    });

    it('trois validations simultanées du même brouillon ne créent qu’une commande (verrou FOR UPDATE)', async () => {
      const publicId = await sendOrder();
      const drafts = app.get(DraftsService);

      const results = await Promise.all([
        drafts.confirm(vendorA, publicId),
        drafts.confirm(vendorA, publicId),
        drafts.confirm(vendorA, publicId),
      ]);

      await expect(prisma.order.count()).resolves.toBe(1);
      const { reference } = await prisma.order.findFirstOrThrow();
      expect(results.filter((r) => 'created' in r && r.created)).toHaveLength(
        1,
      );
      for (const result of results) {
        expect(result).toMatchObject({ status: 'confirmed', reference });
      }
    });

    it('deux brouillons en attente coexistent, chacun avec ses boutons', async () => {
      const first = await sendOrder();
      const second = await sendOrder();

      expect(first).not.toBe(second);
      await send(click(VENDOR_A, `valider:${second}`));

      await expect(
        prisma.orderDraft.findUniqueOrThrow({ where: { publicId: first } }),
      ).resolves.toMatchObject({ status: 'pending' });
      await expect(prisma.order.count()).resolves.toBe(1);
    });
  });

  describe('brouillons non actionnables', () => {
    it.each([
      ['expiré par la date', { expiresAt: new Date(Date.now() - 1_000) }],
      ['expired', { status: 'expired' as const }],
      ['cancelled', { status: 'cancelled' as const }],
    ])(
      'Valider sur un brouillon %s : « n’est plus valide », rien n’est créé',
      async (_label, data) => {
        const publicId = await sendOrder();
        await prisma.orderDraft.update({ where: { publicId }, data });

        await send(click(VENDOR_A, `valider:${publicId}`));

        expect(lastText()).toBe(DRAFT_NO_LONGER_VALID_MESSAGE);
        await expect(prisma.order.count()).resolves.toBe(0);
      },
    );

    it('seul le vendeur du brouillon peut agir dessus', async () => {
      const publicId = await sendOrder(VENDOR_A);

      for (const action of ['valider', 'modifier', 'annuler']) {
        await send(click(VENDOR_B, `${action}:${publicId}`));
        expect(lastText()).toBe(DRAFT_NO_LONGER_VALID_MESSAGE);
      }

      await expect(prisma.order.count()).resolves.toBe(0);
      await expect(
        prisma.orderDraft.findUniqueOrThrow({ where: { publicId } }),
      ).resolves.toMatchObject({ status: 'pending' });
    });

    it('identifiant inconnu ou mal formé : « n’est plus valide » (PO-10)', async () => {
      await send(click(VENDOR_A, 'valider:AAAAAAAAAAAA'));
      expect(lastText()).toBe(DRAFT_NO_LONGER_VALID_MESSAGE);

      await send(click(VENDOR_A, 'n-importe-quoi'));
      expect(lastText()).toBe(DRAFT_NO_LONGER_VALID_MESSAGE);
    });
  });

  describe('Modifier et Annuler', () => {
    it('Annuler passe le brouillon à cancelled ; Valider ensuite est refusé', async () => {
      const publicId = await sendOrder();

      await send(click(VENDOR_A, `annuler:${publicId}`));
      expect(lastText()).toBe(ORDER_CANCELLED_MESSAGE);
      await expect(
        prisma.orderDraft.findUniqueOrThrow({ where: { publicId } }),
      ).resolves.toMatchObject({ status: 'cancelled' });

      await send(click(VENDOR_A, `valider:${publicId}`));
      expect(lastText()).toBe(DRAFT_NO_LONGER_VALID_MESSAGE);
      await expect(prisma.order.count()).resolves.toBe(0);
    });

    it('Modifier passe le brouillon à cancelled et rappelle le modèle', async () => {
      const publicId = await sendOrder();

      await send(click(VENDOR_A, `modifier:${publicId}`));

      expect(lastText()).toBe(MODIFY_MESSAGE);
      expect(lastText()).toContain(ORDER_TEMPLATE);
      await expect(
        prisma.orderDraft.findUniqueOrThrow({ where: { publicId } }),
      ).resolves.toMatchObject({ status: 'cancelled' });
    });

    it('Modifier ou Annuler après validation : « déjà enregistrée » avec la référence (PO-11)', async () => {
      const publicId = await sendOrder();
      await send(click(VENDOR_A, `valider:${publicId}`));
      const { reference } = await prisma.order.findFirstOrThrow();

      await send(click(VENDOR_A, `modifier:${publicId}`));
      expect(lastText()).toBe(orderAlreadyRecordedMessage(reference));
      await send(click(VENDOR_A, `annuler:${publicId}`));
      expect(lastText()).toBe(orderAlreadyRecordedMessage(reference));

      await expect(
        prisma.orderDraft.findUniqueOrThrow({ where: { publicId } }),
      ).resolves.toMatchObject({ status: 'confirmed' });
      await expect(prisma.order.findFirstOrThrow()).resolves.toMatchObject({
        status: 'non_traitee',
      });
    });

    it('Annuler un brouillon expiré : « n’est plus valide »', async () => {
      const publicId = await sendOrder();
      await prisma.orderDraft.update({
        where: { publicId },
        data: { expiresAt: new Date(Date.now() - 1_000) },
      });

      await send(click(VENDOR_A, `annuler:${publicId}`));

      expect(lastText()).toBe(DRAFT_NO_LONGER_VALID_MESSAGE);
      await expect(
        prisma.orderDraft.findUniqueOrThrow({ where: { publicId } }),
      ).resolves.toMatchObject({ status: 'pending' });
    });
  });

  describe('liste blanche et types de messages (PO-13)', () => {
    it.each([
      ['inconnu', UNKNOWN],
      ['désactivé', INACTIVE],
    ])('refuse un numéro %s, sans brouillon', async (_label, from) => {
      await send(text(from, ORDER_TEXT));
      await send(payload(from, { type: 'image', image: { id: 'img' } }));

      expect(client.sendText.mock.calls).toEqual([
        [from, UNAUTHORIZED_MESSAGE],
        [from, UNAUTHORIZED_MESSAGE],
      ]);
      expect(client.sendButtons).not.toHaveBeenCalled();
      await expect(prisma.orderDraft.count()).resolves.toBe(0);
    });

    it('répond « Seuls les messages texte… » à un vendeur actif', async () => {
      await send(payload(VENDOR_A, { type: 'audio', audio: { id: 'a' } }));

      expect(client.sendText).toHaveBeenCalledExactlyOnceWith(
        VENDOR_A,
        UNSUPPORTED_MESSAGE,
      );
    });
  });

  describe('erreurs de saisie', () => {
    it('liste toutes les erreurs suivies du modèle, sans brouillon', async () => {
      await send(
        text(
          VENDOR_A,
          'Nom: Awa\nTel: 070707070\nLieu: Cocody\nArticles: 2 robes x 15000, 1 sac noir',
        ),
      );

      expect(lastText()).toBe(
        parseErrorsMessage([
          PARSE_ERRORS.invalidPhone,
          PARSE_ERRORS.missingPrice('sac noir'),
        ]),
      );
      await expect(prisma.orderDraft.count()).resolves.toBe(0);
    });

    it('demande de scinder un récapitulatif trop long, sans brouillon (PO-06)', async () => {
      const articles = Array.from(
        { length: 30 },
        (_, i) => `article numéro ${i} en tissu wax x 15000`,
      ).join(', ');

      await send(
        text(
          VENDOR_A,
          `Nom: Awa\nTel: 0707070707\nLieu: Cocody\nArticles: ${articles}`,
        ),
      );

      expect(lastText()).toBe(RECAP_TOO_LONG_MESSAGE);
      await expect(prisma.orderDraft.count()).resolves.toBe(0);
    });
  });

  describe('commandes de secours', () => {
    it('modele et aide', async () => {
      await send(text(VENDOR_A, 'Modèle'));
      expect(lastText()).toBe(ORDER_TEMPLATE);

      await send(text(VENDOR_A, 'AIDE'));
      expect(lastText()).toContain('*modele*');
    });

    it('mes commandes : les 5 dernières du vendeur seulement', async () => {
      await send(text(VENDOR_A, 'mes commandes'));
      expect(lastText()).toBe(NO_ORDERS_MESSAGE);

      const orders = app.get(OrdersService);
      const vendorB = await prisma.vendor.findUniqueOrThrow({
        where: { whatsappNumber: VENDOR_B },
      });
      const input = {
        customerName: 'Client',
        customerPhone: '0707070707',
        deliveryLocation: 'Cocody',
        items: [{ label: 'sac', quantity: 1, unitPrice: 1_000 }],
      };
      const references: string[] = [];
      for (let i = 0; i < 7; i += 1) {
        const order = await orders.create({ ...input, vendorId: vendorA });
        references.push(order.reference);
      }
      const other = await orders.create({ ...input, vendorId: vendorB.id });

      await send(text(VENDOR_A, 'Mes Commandes'));

      const reply = lastText();
      expect(reply.split('\n')).toHaveLength(6);
      for (const reference of references.slice(2)) {
        expect(reply).toContain(`${reference} — Non traitée — 1 000 F`);
      }
      expect(reply).not.toContain(references[1]);
      expect(reply).not.toContain(other.reference);
      expect(reply.indexOf(references[6])).toBeLessThan(
        reply.indexOf(references[2]),
      );
    });

    it('annuler : seul le brouillon en attente le plus récent est annulé', async () => {
      const first = await sendOrder();
      const second = await sendOrder();

      await send(text(VENDOR_A, 'annuler'));

      expect(lastText()).toBe(ORDER_CANCELLED_MESSAGE);
      const statuses = await prisma.orderDraft.findMany({
        orderBy: { id: 'asc' },
        select: { publicId: true, status: true },
      });
      expect(statuses).toEqual([
        { publicId: first, status: 'pending' },
        { publicId: second, status: 'cancelled' },
      ]);
    });

    it('annuler sans brouillon en attente ne touche à aucune commande (PO-09)', async () => {
      const publicId = await sendOrder();
      await send(click(VENDOR_A, `valider:${publicId}`));

      await send(text(VENDOR_A, 'Annuler'));

      expect(lastText()).toBe(NO_PENDING_DRAFT_MESSAGE);
      await expect(prisma.order.findFirstOrThrow()).resolves.toMatchObject({
        status: 'non_traitee',
      });
    });
  });

  describe('atomicité et envois', () => {
    it('une erreur dans la transaction de validation ne laisse aucune donnée partielle', async () => {
      const publicId = await sendOrder();
      const orders = app.get(OrdersService);
      const original = orders.create.bind(orders);
      const spy = vi
        .spyOn(orders, 'create')
        .mockImplementationOnce(async (input, tx) => {
          await original(input, tx);
          throw new Error('panne après création');
        });

      try {
        await send(click(VENDOR_A, `valider:${publicId}`));
      } finally {
        spy.mockRestore();
      }

      expect(lastText()).toBe(PROCESSING_ERROR_MESSAGE);
      await expect(prisma.order.count()).resolves.toBe(0);
      await expect(prisma.orderItem.count()).resolves.toBe(0);
      await expect(prisma.orderStatusHistory.count()).resolves.toBe(0);
      await expect(
        prisma.orderDraft.findUniqueOrThrow({ where: { publicId } }),
      ).resolves.toMatchObject({ status: 'pending' });

      await send(click(VENDOR_A, `valider:${publicId}`));
      await expect(prisma.order.count()).resolves.toBe(1);
    });

    it('un échec d’envoi de la confirmation garde la commande, sans message d’excuse', async () => {
      const publicId = await sendOrder();
      client.sendText.mockRejectedValue(new WhatsappSendError(400));

      await send(click(VENDOR_A, `valider:${publicId}`));

      await expect(prisma.order.count()).resolves.toBe(1);
      expect(client.sendText).toHaveBeenCalledOnce();
      expect(lastText()).toMatch(/^Commande CMD-/);
    });
  });

  describe('tâche horaire des brouillons (US-BOT-15)', () => {
    it('expire les pending échus et purge les brouillons finis depuis plus de 7 jours', async () => {
      const now = new Date();
      const publicId = await sendOrder();
      await send(click(VENDOR_A, `valider:${publicId}`));
      const order = await prisma.order.findFirstOrThrow();
      const ago = (ms: number) => new Date(now.getTime() - ms);
      const later = new Date(now.getTime() + 60_000);
      const drafts = [
        ['pendingOk', 'pending', later],
        ['pendingDue', 'pending', ago(1_000)],
        ['pendingOld', 'pending', ago(8 * DAY_MS)],
        ['expired6d', 'expired', ago(6 * DAY_MS)],
        ['expired8d', 'expired', ago(8 * DAY_MS)],
        ['cancel8d', 'cancelled', ago(8 * DAY_MS)],
        ['confirm6d', 'confirmed', ago(6 * DAY_MS)],
      ] as const;
      await prisma.orderDraft.createMany({
        data: drafts.map(([id, status, expiresAt]) => ({
          publicId: id.padEnd(12, '0'),
          vendorId: vendorA,
          status,
          expiresAt,
          payload: {},
        })),
      });
      await prisma.orderDraft.update({
        where: { publicId },
        data: { expiresAt: ago(8 * DAY_MS) },
      });

      await expect(app.get(DraftsCleanup).cleanup(now)).resolves.toEqual({
        expired: 2,
        deleted: 4,
      });

      const remaining = await prisma.orderDraft.findMany({
        orderBy: { publicId: 'asc' },
        select: { publicId: true, status: true },
      });
      expect(remaining).toEqual([
        { publicId: 'confirm6d000', status: 'confirmed' },
        { publicId: 'expired6d000', status: 'expired' },
        { publicId: 'pendingDue00', status: 'expired' },
        { publicId: 'pendingOk000', status: 'pending' },
      ]);
      await expect(
        prisma.order.findUniqueOrThrow({
          where: { id: order.id },
          include: { items: true },
        }),
      ).resolves.toMatchObject({ reference: order.reference });
    });
  });
});
