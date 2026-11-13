import { randomBytes } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isTransactionConflict } from '../common/index.js';
import type { Env } from '../config/index.js';
import type { DraftStatus, Prisma } from '../generated/prisma/client.js';
import { OrdersService } from '../orders/index.js';
import { PrismaService, type PrismaTx } from '../prisma/index.js';
import type { ParsedItem, ParsedOrder } from './parse-order.js';

/** 9 octets aléatoires = 12 caractères base64url (`order_drafts.public_id`). */
const PUBLIC_ID_BYTES = 9;
/** Tentatives de la transaction de validation sur interblocage (`P2034`). */
export const CONFIRM_MAX_ATTEMPTS = 3;
const MINUTE_MS = 60_000;

/** Contenu de `order_drafts.payload` ; `orderReference` ajouté à la confirmation (PO-11). */
export interface DraftPayload extends ParsedOrder {
  orderReference?: string;
}

const INVALID = { status: 'invalid' } as const;

/** Valider : `created` faux en cas de double clic (référence existante). */
export type ConfirmResult =
  { status: 'confirmed'; reference: string; created: boolean } | typeof INVALID;

/** Modifier / Annuler : `already_confirmed` porte la référence (PO-11). */
export type CancelResult =
  | { status: 'cancelled' }
  | { status: 'already_confirmed'; reference: string }
  | typeof INVALID;

interface LockedDraft {
  id: bigint;
  vendor_id: bigint;
  status: DraftStatus;
  expires_at: Date;
  payload: unknown;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isItem(value: unknown): value is ParsedItem {
  return (
    isObject(value) &&
    typeof value['label'] === 'string' &&
    typeof value['quantity'] === 'number' &&
    typeof value['unitPrice'] === 'number'
  );
}

/** Lit le payload JSON d'un brouillon (objet, ou chaîne selon le pilote). */
export function readDraftPayload(raw: unknown): DraftPayload | null {
  const value: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (
    !isObject(value) ||
    typeof value['customerName'] !== 'string' ||
    typeof value['customerPhone'] !== 'string' ||
    typeof value['deliveryLocation'] !== 'string' ||
    typeof value['total'] !== 'number' ||
    !Array.isArray(value['items']) ||
    !value['items'].every(isItem) ||
    !['string', 'undefined'].includes(typeof value['orderReference'])
  ) {
    return null;
  }
  return value as unknown as DraftPayload;
}

function toJson(payload: DraftPayload): Prisma.InputJsonObject {
  return {
    customerName: payload.customerName,
    customerPhone: payload.customerPhone,
    deliveryLocation: payload.deliveryLocation,
    items: payload.items.map(({ label, quantity, unitPrice }) => ({
      label,
      quantity,
      unitPrice,
    })),
    total: payload.total,
    ...(payload.orderReference === undefined
      ? {}
      : { orderReference: payload.orderReference }),
  };
}

/**
 * Brouillons `order_drafts` : seul état conservé par le bot (DAT section 6).
 * Modifier / Annuler par mise à jour conditionnelle (PO-11) ; Valider dans
 * une transaction unique qui verrouille le brouillon avant le compteur
 * journalier (contrat de `OrdersService.create`).
 */
@Injectable()
export class DraftsService {
  private readonly logger = new Logger(DraftsService.name);
  private readonly ttlMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    config: ConfigService<Env, true>,
  ) {
    this.ttlMs = config.get('DRAFT_TTL_MINUTES', { infer: true }) * MINUTE_MS;
  }

  /** Brouillon `pending` expirant dans `DRAFT_TTL_MINUTES` (PO-22) ; renvoie son `public_id`. */
  async create(
    vendorId: bigint,
    order: ParsedOrder,
    now: Date = new Date(),
  ): Promise<string> {
    const publicId = randomBytes(PUBLIC_ID_BYTES).toString('base64url');
    await this.prisma.orderDraft.create({
      data: {
        publicId,
        vendorId,
        payload: toJson(order),
        status: 'pending',
        createdAt: now,
        expiresAt: new Date(now.getTime() + this.ttlMs),
      },
    });
    return publicId;
  }

  /**
   * Valider : crée la commande et confirme le brouillon dans une seule
   * transaction, relancée sur interblocage. Double clic : référence
   * existante, sans doublon. Aucun envoi WhatsApp ici (après le COMMIT).
   * Avant chaque tentative : heure recalculée (sauf `now` fourni) et ligne
   * du compteur journalier préparée hors transaction (contrat de `create`).
   */
  async confirm(
    vendorId: bigint,
    publicId: string,
    now?: Date,
  ): Promise<ConfirmResult> {
    for (let attempt = 1; ; attempt += 1) {
      const at = now ?? new Date();
      try {
        await this.orders.prepareDailyCounter(at);
        return await this.prisma.$transaction((tx) =>
          this.confirmInTransaction(tx, vendorId, publicId, at),
        );
      } catch (error) {
        if (attempt >= CONFIRM_MAX_ATTEMPTS || !isTransactionConflict(error)) {
          throw error;
        }
        this.logger.warn(
          `Conflit de transaction à la validation d'un brouillon : tentative ${attempt + 1}`,
        );
      }
    }
  }

  /**
   * Modifier et Annuler (bouton) : `pending` non expiré du vendeur ->
   * `cancelled`, par mise à jour conditionnelle. Sinon : référence si le
   * brouillon est confirmé, « n'est plus valide » dans tous les autres cas.
   */
  async cancel(
    vendorId: bigint,
    publicId: string,
    now: Date = new Date(),
  ): Promise<CancelResult> {
    const { count } = await this.prisma.orderDraft.updateMany({
      where: { publicId, vendorId, status: 'pending', expiresAt: { gt: now } },
      data: { status: 'cancelled' },
    });
    if (count === 1) {
      return { status: 'cancelled' };
    }
    const draft = await this.prisma.orderDraft.findFirst({
      where: { publicId, vendorId, status: 'confirmed' },
      select: { payload: true },
    });
    const reference = draft
      ? readDraftPayload(draft.payload)?.orderReference
      : undefined;
    return reference ? { status: 'already_confirmed', reference } : INVALID;
  }

  /** `annuler` : brouillon `pending` non expiré le plus récent du vendeur -> `cancelled`. */
  async cancelLatestPending(
    vendorId: bigint,
    now: Date = new Date(),
  ): Promise<boolean> {
    const draft = await this.prisma.orderDraft.findFirst({
      where: { vendorId, status: 'pending', expiresAt: { gt: now } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true },
    });
    if (!draft) {
      return false;
    }
    const { count } = await this.prisma.orderDraft.updateMany({
      where: { id: draft.id, status: 'pending' },
      data: { status: 'cancelled' },
    });
    return count === 1;
  }

  /**
   * Décisions prises sur la lecture verrouillante (`FOR UPDATE`), première
   * instruction de la transaction. `OrdersService.create` est le dernier
   * appel qui pose un verrou ; seule la ligne du brouillon, déjà verrouillée,
   * est écrite après lui (statut et référence).
   */
  private async confirmInTransaction(
    tx: PrismaTx,
    vendorId: bigint,
    publicId: string,
    now: Date,
  ): Promise<ConfirmResult> {
    const rows = await tx.$queryRaw<LockedDraft[]>`
      SELECT id, vendor_id, status, expires_at, payload
      FROM order_drafts WHERE public_id = ${publicId} FOR UPDATE`;
    const draft = rows.at(0);
    if (!draft || BigInt(draft.vendor_id) !== vendorId) {
      return INVALID;
    }
    const payload = readDraftPayload(draft.payload);
    if (draft.status === 'confirmed') {
      return payload?.orderReference
        ? {
            status: 'confirmed',
            reference: payload.orderReference,
            created: false,
          }
        : INVALID;
    }
    if (
      draft.status !== 'pending' ||
      new Date(draft.expires_at).getTime() <= now.getTime()
    ) {
      return INVALID;
    }
    if (payload === null) {
      throw new Error(`Payload illisible pour le brouillon ${draft.id}`);
    }
    const order = await this.orders.create(
      {
        vendorId,
        customerName: payload.customerName,
        customerPhone: payload.customerPhone,
        deliveryLocation: payload.deliveryLocation,
        items: payload.items,
      },
      tx,
    );
    await tx.orderDraft.update({
      where: { id: BigInt(draft.id) },
      data: {
        status: 'confirmed',
        payload: toJson({ ...payload, orderReference: order.reference }),
      },
    });
    return { status: 'confirmed', reference: order.reference, created: true };
  }
}
