import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { maskPhone, normalizeForMatch } from '../common/index.js';
import type { Env } from '../config/index.js';
import type { Vendor } from '../generated/prisma/client.js';
import { OrdersService } from '../orders/index.js';
import { VendorsService } from '../vendors/index.js';
import {
  type ReplyButton,
  WhatsappClient,
  WhatsappSendError,
} from '../whatsapp/client/index.js';
import type { IncomingMessage, MessageHandler } from '../whatsapp/index.js';
import { DraftsService } from './drafts.service.js';
import { fitsInRecap, formatRecap } from './format-recap.js';
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
  parseErrorsMessage,
  RECAP_BUTTON_TITLES,
  RECAP_TOO_LONG_MESSAGE,
  RECENT_ORDERS_COUNT,
  UNAUTHORIZED_MESSAGE,
  UNSUPPORTED_MESSAGE,
} from './messages.js';
import { parseOrder } from './parse-order.js';

type ButtonAction = keyof typeof RECAP_BUTTON_TITLES;

/** `action:public_id` (DAT section 6) ; `public_id` : 12 caractères base64url. */
const BUTTON_ID = /^(valider|modifier|annuler):([\w-]{12})$/;

/** Mise en forme WhatsApp (`*gras*`, `_italique_`, `~barré~`), ignorée. */
const WHATSAPP_FORMATTING = /[*_~]/g;
const TRAILING_PUNCTUATION = /[\s.!?…,;:]+$/u;

/** Forme comparée d'une commande de secours (`*Modèle*`, `Annuler.`). */
function toCommand(text: string): string {
  return normalizeForMatch(text.replace(WHATSAPP_FORMATTING, '')).replace(
    TRAILING_PUNCTUATION,
    '',
  );
}

/** Commandes de secours, comparées après `toCommand`. */
const FALLBACK_COMMANDS = {
  modele: 'modele',
  aide: 'aide',
  mesCommandes: 'mes commandes',
  annuler: 'annuler',
} as const;

/** Réponse à envoyer : texte simple, ou récapitulatif à boutons. */
type Reply = string | { body: string; buttons: ReplyButton[] };

function recapButtons(publicId: string): ReplyButton[] {
  return (Object.keys(RECAP_BUTTON_TITLES) as ButtonAction[]).map((action) => ({
    id: `${action}:${publicId}`,
    title: RECAP_BUTTON_TITLES[action],
  }));
}

/**
 * Bot sans état (DAT section 6) : liste blanche d'abord (PO-13), puis clic
 * de bouton, commande de secours ou commande à analyser. Les réponses sont
 * envoyées après toute écriture en base ; un échec d'envoi est journalisé,
 * jamais remonté.
 */
@Injectable()
export class BotService implements MessageHandler {
  private readonly logger = new Logger(BotService.name);
  private readonly draftTtlMinutes: number;

  constructor(
    private readonly vendors: VendorsService,
    private readonly orders: OrdersService,
    private readonly drafts: DraftsService,
    private readonly client: WhatsappClient,
    config: ConfigService<Env, true>,
  ) {
    this.draftTtlMinutes = config.get('DRAFT_TTL_MINUTES', { infer: true });
  }

  async handle(message: IncomingMessage): Promise<void> {
    const vendor = await this.vendors.findActiveByWhatsappNumber(message.from);
    if (!vendor) {
      this.logger.warn(
        `Message ${message.wamid} d'un numéro non autorisé : ${maskPhone(message.from)}`,
      );
      await this.send(message.from, UNAUTHORIZED_MESSAGE);
      return;
    }
    const reply = await this.replyTo(vendor, message);
    await this.send(message.from, reply);
  }

  private replyTo(vendor: Vendor, message: IncomingMessage): Promise<Reply> {
    switch (message.type) {
      case 'button':
        return this.onButton(vendor, message.buttonId ?? '');
      case 'text':
        return this.onText(vendor, message.text ?? '');
      default:
        return Promise.resolve(UNSUPPORTED_MESSAGE);
    }
  }

  /** Bouton inconnu ou mal formé : « n'est plus valide » (PO-10). */
  private async onButton(vendor: Vendor, buttonId: string): Promise<Reply> {
    const match = BUTTON_ID.exec(buttonId);
    if (!match) {
      return DRAFT_NO_LONGER_VALID_MESSAGE;
    }
    const action = match[1] as ButtonAction;
    const publicId = match[2];
    if (action === 'valider') {
      const result = await this.drafts.confirm(vendor.id, publicId);
      if (result.status === 'invalid') {
        return DRAFT_NO_LONGER_VALID_MESSAGE;
      }
      if (result.created) {
        this.logger.log(
          `Commande ${result.reference} enregistrée pour le vendeur ${vendor.id}`,
        );
      }
      return orderConfirmedMessage(result.reference);
    }
    const result = await this.drafts.cancel(vendor.id, publicId);
    if (result.status === 'already_confirmed') {
      return orderAlreadyRecordedMessage(result.reference);
    }
    if (result.status === 'invalid') {
      return DRAFT_NO_LONGER_VALID_MESSAGE;
    }
    return action === 'modifier' ? MODIFY_MESSAGE : ORDER_CANCELLED_MESSAGE;
  }

  private async onText(vendor: Vendor, text: string): Promise<Reply> {
    switch (toCommand(text)) {
      case FALLBACK_COMMANDS.modele:
        return ORDER_TEMPLATE;
      case FALLBACK_COMMANDS.aide:
        return helpMessage(this.draftTtlMinutes);
      case FALLBACK_COMMANDS.mesCommandes:
        return myOrdersMessage(
          await this.orders.findRecentByVendor(vendor.id, RECENT_ORDERS_COUNT),
        );
      case FALLBACK_COMMANDS.annuler:
        return (await this.drafts.cancelLatestPending(vendor.id))
          ? ORDER_CANCELLED_MESSAGE
          : NO_PENDING_DRAFT_MESSAGE;
      default:
        return this.onOrder(vendor, text);
    }
  }

  /** parse -> total -> récapitulatif -> contrôle de longueur -> brouillon (PO-06). */
  private async onOrder(vendor: Vendor, text: string): Promise<Reply> {
    const parsed = parseOrder(text);
    if (!parsed.ok) {
      return parseErrorsMessage(parsed.errors);
    }
    const recap = formatRecap(parsed.order);
    if (!fitsInRecap(recap)) {
      return RECAP_TOO_LONG_MESSAGE;
    }
    const publicId = await this.drafts.create(vendor.id, parsed.order);
    return { body: recap, buttons: recapButtons(publicId) };
  }

  /** `WhatsappSendError` (déjà journalisée par le client) : avertissement, sans remontée. */
  private async send(to: string, reply: Reply): Promise<void> {
    try {
      if (typeof reply === 'string') {
        await this.client.sendText(to, reply);
      } else {
        await this.client.sendButtons(to, reply.body, reply.buttons);
      }
    } catch (error) {
      if (!(error instanceof WhatsappSendError)) {
        throw error;
      }
      this.logger.warn(
        `Réponse du bot non envoyée à ${maskPhone(to)} : ${error.message}`,
      );
    }
  }
}
