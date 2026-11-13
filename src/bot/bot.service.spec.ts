import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { OrdersService } from '../orders/index.js';
import { VendorsService } from '../vendors/index.js';
import { WhatsappClient, WhatsappSendError } from '../whatsapp/client/index.js';
import type { IncomingMessage } from '../whatsapp/index.js';
import { BotService } from './bot.service.js';
import { DraftsService } from './drafts.service.js';
import {
  DRAFT_NO_LONGER_VALID_MESSAGE,
  helpMessage,
  MODIFY_MESSAGE,
  myOrdersMessage,
  NO_PENDING_DRAFT_MESSAGE,
  ORDER_CANCELLED_MESSAGE,
  ORDER_TEMPLATE,
  orderAlreadyRecordedMessage,
  orderConfirmedMessage,
  PARSE_ERRORS,
  parseErrorsMessage,
  RECAP_TOO_LONG_MESSAGE,
  RECENT_ORDERS_COUNT,
  UNAUTHORIZED_MESSAGE,
  UNSUPPORTED_MESSAGE,
} from './messages.js';

const FROM = '2250707070707';
const VENDOR = { id: 2n, name: 'Boutique Awa', whatsappNumber: FROM };
const PUBLIC_ID = 'AbCdEf123_-x';
const ORDER_TEXT = [
  'Nom: Awa Koné',
  'Tel: 0707070707',
  'Lieu: Cocody',
  'Articles: 2 robes x 15000',
].join('\n');

function text(body: string): IncomingMessage {
  return { wamid: 'wamid.1', from: FROM, type: 'text', text: body };
}

function button(buttonId: string): IncomingMessage {
  return { wamid: 'wamid.2', from: FROM, type: 'button', buttonId };
}

describe('BotService', () => {
  const vendors = { findActiveByWhatsappNumber: vi.fn() };
  const orders = { findRecentByVendor: vi.fn() };
  const drafts = {
    create: vi.fn(),
    confirm: vi.fn(),
    cancel: vi.fn(),
    cancelLatestPending: vi.fn(),
  };
  const client = { sendText: vi.fn(), sendButtons: vi.fn() };
  let bot: BotService;
  let warnLog: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.resetAllMocks();
    warnLog = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    vendors.findActiveByWhatsappNumber.mockResolvedValue(VENDOR);
    client.sendText.mockResolvedValue(undefined);
    client.sendButtons.mockResolvedValue(undefined);
    const moduleRef = await Test.createTestingModule({
      providers: [
        BotService,
        { provide: VendorsService, useValue: vendors },
        { provide: OrdersService, useValue: orders },
        { provide: DraftsService, useValue: drafts },
        { provide: WhatsappClient, useValue: client },
        { provide: ConfigService, useValue: { get: () => 30 } },
      ],
    }).compile();
    bot = moduleRef.get(BotService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('liste blanche (PO-13)', () => {
    it.each([
      ['un texte', text('modele')],
      ['un clic', button(`valider:${PUBLIC_ID}`)],
      [
        'un message non texte',
        { wamid: 'w', from: FROM, type: 'unsupported' as const },
      ],
    ])(
      'refuse %s d’un numéro inconnu ou désactivé, sans autre action',
      async (_label, message) => {
        vendors.findActiveByWhatsappNumber.mockResolvedValue(null);

        await bot.handle(message);

        expect(vendors.findActiveByWhatsappNumber).toHaveBeenCalledWith(FROM);
        expect(client.sendText).toHaveBeenCalledExactlyOnceWith(
          FROM,
          UNAUTHORIZED_MESSAGE,
        );
        expect(warnLog.mock.calls[0][0]).toContain('22*******0707');
        expect(warnLog.mock.calls[0][0]).not.toContain(FROM);
        for (const fn of Object.values(drafts)) {
          expect(fn).not.toHaveBeenCalled();
        }
      },
    );
  });

  it('répond au message non texte d’un vendeur actif', async () => {
    await bot.handle({ wamid: 'w', from: FROM, type: 'unsupported' });

    expect(client.sendText).toHaveBeenCalledExactlyOnceWith(
      FROM,
      UNSUPPORTED_MESSAGE,
    );
  });

  describe('commandes de secours', () => {
    it.each([
      ['modele'],
      ['Modèle'],
      ['MODELE'],
      [' modèle '],
      ['*modele*'],
      ['_Modèle_ !'],
      ['~modele~.'],
    ])('renvoie le modèle pour « %s »', async (body) => {
      await bot.handle(text(body));

      expect(client.sendText).toHaveBeenCalledWith(FROM, ORDER_TEMPLATE);
    });

    it('renvoie l’aide', async () => {
      await bot.handle(text('AIDE'));

      expect(client.sendText).toHaveBeenCalledWith(FROM, helpMessage(30));
    });

    it('liste les 5 dernières commandes du vendeur', async () => {
      const recent = [
        {
          reference: 'CMD-20261113-001',
          status: 'validee',
          totalAmount: 1_000,
        },
      ];
      orders.findRecentByVendor.mockResolvedValue(recent);

      await bot.handle(text('Mes  Commandes ?'));

      expect(orders.findRecentByVendor).toHaveBeenCalledWith(
        VENDOR.id,
        RECENT_ORDERS_COUNT,
      );
      expect(client.sendText).toHaveBeenCalledWith(
        FROM,
        myOrdersMessage(recent as Parameters<typeof myOrdersMessage>[0]),
      );
    });

    it.each([
      [true, ORDER_CANCELLED_MESSAGE],
      [false, NO_PENDING_DRAFT_MESSAGE],
    ])('« annuler » (annulé : %s)', async (cancelled, reply) => {
      drafts.cancelLatestPending.mockResolvedValue(cancelled);

      await bot.handle(text('*Annuler.*'));

      expect(drafts.cancelLatestPending).toHaveBeenCalledWith(VENDOR.id);
      expect(client.sendText).toHaveBeenCalledWith(FROM, reply);
    });
  });

  describe('commande', () => {
    it('crée un brouillon et envoie le récapitulatif avec les trois boutons', async () => {
      drafts.create.mockResolvedValue(PUBLIC_ID);

      await bot.handle(text(ORDER_TEXT));

      expect(drafts.create).toHaveBeenCalledWith(VENDOR.id, {
        customerName: 'Awa Koné',
        customerPhone: '0707070707',
        deliveryLocation: 'Cocody',
        items: [{ label: 'robes', quantity: 2, unitPrice: 15_000 }],
        total: 30_000,
      });
      expect(client.sendButtons).toHaveBeenCalledExactlyOnceWith(
        FROM,
        expect.stringContaining('Total : 30 000 F CFA'),
        [
          { id: `valider:${PUBLIC_ID}`, title: 'Valider' },
          { id: `modifier:${PUBLIC_ID}`, title: 'Modifier' },
          { id: `annuler:${PUBLIC_ID}`, title: 'Annuler' },
        ],
      );
      expect(drafts.create.mock.invocationCallOrder[0]).toBeLessThan(
        client.sendButtons.mock.invocationCallOrder[0],
      );
    });

    it('répond avec toutes les erreurs et le modèle, sans brouillon', async () => {
      await bot.handle(text('Nom: Awa'));

      expect(drafts.create).not.toHaveBeenCalled();
      expect(client.sendText).toHaveBeenCalledWith(
        FROM,
        parseErrorsMessage([
          PARSE_ERRORS.missingPhone,
          PARSE_ERRORS.missingLocation,
          PARSE_ERRORS.missingItems,
        ]),
      );
    });

    it('demande de scinder un récapitulatif de plus de 1 024 caractères, sans brouillon (PO-06)', async () => {
      const articles = Array.from(
        { length: 30 },
        (_, i) => `article numéro ${i} en tissu wax x 15000`,
      ).join(', ');

      await bot.handle(
        text(`Nom: Awa\nTel: 0707070707\nLieu: Cocody\nArticles: ${articles}`),
      );

      expect(drafts.create).not.toHaveBeenCalled();
      expect(client.sendText).toHaveBeenCalledWith(
        FROM,
        RECAP_TOO_LONG_MESSAGE,
      );
    });
  });

  describe('boutons', () => {
    it('Valider : confirme et renvoie la référence', async () => {
      drafts.confirm.mockResolvedValue({
        status: 'confirmed',
        reference: 'CMD-20261113-001',
        created: true,
      });

      await bot.handle(button(`valider:${PUBLIC_ID}`));

      expect(drafts.confirm).toHaveBeenCalledWith(VENDOR.id, PUBLIC_ID);
      expect(client.sendText).toHaveBeenCalledWith(
        FROM,
        orderConfirmedMessage('CMD-20261113-001'),
      );
    });

    it('Valider au double clic : renvoie la référence existante', async () => {
      drafts.confirm.mockResolvedValue({
        status: 'confirmed',
        reference: 'CMD-20261113-001',
        created: false,
      });

      await bot.handle(button(`valider:${PUBLIC_ID}`));

      expect(client.sendText).toHaveBeenCalledWith(
        FROM,
        orderConfirmedMessage('CMD-20261113-001'),
      );
    });

    it('Valider un brouillon invalide : « n’est plus valide »', async () => {
      drafts.confirm.mockResolvedValue({ status: 'invalid' });

      await bot.handle(button(`valider:${PUBLIC_ID}`));

      expect(client.sendText).toHaveBeenCalledWith(
        FROM,
        DRAFT_NO_LONGER_VALID_MESSAGE,
      );
    });

    it.each([
      ['modifier', MODIFY_MESSAGE],
      ['annuler', ORDER_CANCELLED_MESSAGE],
    ])('%s : annule le brouillon et répond', async (action, reply) => {
      drafts.cancel.mockResolvedValue({ status: 'cancelled' });

      await bot.handle(button(`${action}:${PUBLIC_ID}`));

      expect(drafts.cancel).toHaveBeenCalledWith(VENDOR.id, PUBLIC_ID);
      expect(client.sendText).toHaveBeenCalledWith(FROM, reply);
    });

    it.each([['modifier'], ['annuler']])(
      '%s sur un brouillon confirmé : « déjà enregistrée » (PO-11)',
      async (action) => {
        drafts.cancel.mockResolvedValue({
          status: 'already_confirmed',
          reference: 'CMD-20261113-001',
        });

        await bot.handle(button(`${action}:${PUBLIC_ID}`));

        expect(client.sendText).toHaveBeenCalledWith(
          FROM,
          orderAlreadyRecordedMessage('CMD-20261113-001'),
        );
      },
    );

    it('Annuler sur un brouillon invalide : « n’est plus valide »', async () => {
      drafts.cancel.mockResolvedValue({ status: 'invalid' });

      await bot.handle(button(`annuler:${PUBLIC_ID}`));

      expect(client.sendText).toHaveBeenCalledWith(
        FROM,
        DRAFT_NO_LONGER_VALID_MESSAGE,
      );
    });

    it.each([
      [''],
      ['valider'],
      [`supprimer:${PUBLIC_ID}`],
      ['valider:court'],
      [`valider:${PUBLIC_ID}x`],
      [`VALIDER:${PUBLIC_ID}`],
    ])(
      'identifiant mal formé « %s » : « n’est plus valide » (PO-10)',
      async (id) => {
        await bot.handle(button(id));

        expect(drafts.confirm).not.toHaveBeenCalled();
        expect(drafts.cancel).not.toHaveBeenCalled();
        expect(client.sendText).toHaveBeenCalledWith(
          FROM,
          DRAFT_NO_LONGER_VALID_MESSAGE,
        );
      },
    );
  });

  it('traite un clic sans identifiant ou un texte sans corps comme invalides', async () => {
    await bot.handle({ wamid: 'w1', from: FROM, type: 'button' });
    await bot.handle({ wamid: 'w2', from: FROM, type: 'text' });

    expect(client.sendText).toHaveBeenNthCalledWith(
      1,
      FROM,
      DRAFT_NO_LONGER_VALID_MESSAGE,
    );
    expect(client.sendText).toHaveBeenNthCalledWith(
      2,
      FROM,
      expect.stringContaining(PARSE_ERRORS.missingName),
    );
    expect(drafts.create).not.toHaveBeenCalled();
  });

  describe('échecs d’envoi', () => {
    it('journalise un WhatsappSendError sans le remonter', async () => {
      client.sendText.mockRejectedValue(new WhatsappSendError(400));

      await expect(bot.handle(text('modele'))).resolves.toBeUndefined();
      expect(warnLog).toHaveBeenCalledOnce();
      expect(warnLog.mock.calls[0][0]).not.toContain(FROM);
    });

    it('n’intercepte pas les autres erreurs', async () => {
      client.sendText.mockRejectedValue(new RangeError('trop long'));

      await expect(bot.handle(text('modele'))).rejects.toThrow(RangeError);
    });

    it('garde la commande créée si l’envoi de la confirmation échoue', async () => {
      drafts.confirm.mockResolvedValue({
        status: 'confirmed',
        reference: 'CMD-20261113-001',
        created: true,
      });
      client.sendText.mockRejectedValue(new WhatsappSendError());

      await expect(
        bot.handle(button(`valider:${PUBLIC_ID}`)),
      ).resolves.toBeUndefined();
      expect(drafts.confirm).toHaveBeenCalledOnce();
    });
  });
});
