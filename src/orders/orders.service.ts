import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  computeTotal,
  normalizeCiPhone,
  OrderTotalExceededError,
  type PageResponse,
  paginate,
  type PricedItem,
  toDayRange,
  toSkipTake,
} from '../common/index.js';
import {
  type Order,
  type OrderStatus,
  Prisma,
} from '../generated/prisma/client.js';
import { PrismaService, type PrismaTx } from '../prisma/index.js';
import type { ChangeStatusDto } from './dto/change-status.dto.js';
import type { ListOrdersQueryDto } from './dto/list-orders.query.dto.js';
import {
  type OrderCountsDto,
  type OrderDetailDto,
  type OrderSummaryDto,
  type OrderWithDetail,
  toOrderDetail,
  toOrderSummary,
} from './dto/order-response.dto.js';
import type { UpdateOrderDto } from './dto/update-order.dto.js';
import { formatReference, toUtcDay } from './order-reference.js';
import {
  assertTransition,
  isEditable,
  ORDER_STATUSES,
} from './order-status.js';

export const ORDER_NOT_FOUND_MESSAGE = 'Commande introuvable';
export const ORDER_NOT_EDITABLE_MESSAGE =
  'Seule une commande non traitée ou validée peut être corrigée';

export interface OrderItemInput extends PricedItem {
  label: string;
}

/**
 * Données d'une nouvelle commande, déjà validées par l'appelant (téléphone
 * normalisé à 10 chiffres). `orders` ne connaît pas la notion de brouillon.
 */
export interface CreateOrderInput {
  vendorId: bigint;
  customerName: string;
  customerPhone: string;
  deliveryLocation: string;
  notes?: string | null;
  items: readonly OrderItemInput[];
}

const VENDOR_SUMMARY = { select: { id: true, name: true } } as const;
const DETAIL_INCLUDE = {
  vendor: VENDOR_SUMMARY,
  items: { orderBy: { id: 'asc' } },
  // Ordre d'insertion : indépendant des horloges.
  statusHistory: { orderBy: { id: 'asc' } },
} satisfies Prisma.OrderInclude;

// Recherche sur le téléphone seulement si la saisie ressemble à un numéro.
const PHONE_SEARCH = /^[\d\s.+-]+$/;
const NON_DIGITS = /\D/g;

/** Nouvelles tentatives de `create` sans `tx` sur interblocage (P2034). */
const CREATE_MAX_ATTEMPTS = 3;
const PRISMA_TRANSACTION_CONFLICT = 'P2034';

function isTransactionConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === PRISMA_TRANSACTION_CONFLICT
  );
}

// Prisma n'échappe pas les jokers LIKE sous MySQL (`\` : échappement par défaut).
const LIKE_SPECIAL_CHARACTERS = /[\\%_]/g;

function escapeLike(value: string): string {
  return value.replace(LIKE_SPECIAL_CHARACTERS, String.raw`\$&`);
}

function searchConditions(search: string): Prisma.OrderWhereInput[] {
  const literal = escapeLike(search);
  const conditions: Prisma.OrderWhereInput[] = [
    { reference: { startsWith: literal } },
    { customerName: { contains: literal } },
  ];
  // Numéro complet (`+225 07 07 07 07 07`) ramené aux 10 chiffres stockés.
  const digits = normalizeCiPhone(search) ?? search.replace(NON_DIGITS, '');
  if (PHONE_SEARCH.test(search) && digits !== '') {
    conditions.push({ customerPhone: { contains: digits } });
  }
  return conditions;
}

/** Filtres cumulables ; bornes `from`/`to` incluses en jours entiers UTC (PO-21). */
function buildWhere(query: ListOrdersQueryDto): Prisma.OrderWhereInput {
  const where: Prisma.OrderWhereInput = {
    status: query.status,
    createdAt: toDayRange(query.from, query.to),
  };
  if (query.vendorId !== undefined) {
    where.vendorId = BigInt(query.vendorId);
  }
  if (query.search) {
    where.OR = searchConditions(query.search);
  }
  return where;
}

/** Total recalculé ; au-delà du plafond PO-01 : `400`. */
function totalOrBadRequest(items: readonly PricedItem[]): number {
  try {
    return computeTotal(items);
  } catch (error) {
    if (error instanceof OrderTotalExceededError) {
      throw new BadRequestException(error.message);
    }
    throw error;
  }
}

/** Chaîne vide : valeur effacée (`NULL`). */
function emptyToNull(value: string | undefined): string | null | undefined {
  return value === '' ? null : value;
}

function toItemRows(items: readonly OrderItemInput[]): OrderItemInput[] {
  return items.map(({ label, quantity, unitPrice }) => ({
    label,
    quantity,
    unitPrice,
  }));
}

/** Commandes : création transactionnelle, consultation, correction, statuts. */
@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Crée une commande `non_traitee` avec ses articles, sa référence
   * journalière et la première ligne d'historique (`changed_by_user_id`
   * NULL). Total au-delà du plafond : `OrderTotalExceededError`, avant toute
   * écriture.
   *
   * La ligne `daily_counters` du jour est d'abord créée hors transaction
   * (autocommit, sans attente de verrou), puis incrémentée sous verrou de
   * ligne dans la transaction : une transaction annulée ne peut pas provoquer
   * d'interblocage sur la première commande du jour.
   *
   * Sans `tx` : transaction propre, relancée jusqu'à 3 fois sur conflit
   * (`P2034`). Avec `tx` (transaction de l'appelant, ex. le bot) :
   * - l'appelant relance lui-même toute sa transaction sur `P2034` ;
   * - `create` doit être le dernier appel de la transaction (le verrou du
   *   compteur bloque les autres créations jusqu'au COMMIT) ;
   * - aucun appel externe (HTTP, WhatsApp) dans la transaction ;
   * - ordre des verrous : `order_drafts` d'abord, `daily_counters` ensuite ;
   * - une seule création par transaction.
   */
  async create(input: CreateOrderInput, tx?: PrismaTx): Promise<Order> {
    const totalAmount = computeTotal(input.items);
    const now = new Date();
    const day = toUtcDay(now);
    await this.ensureDailyCounter(day);
    const insert = (client: PrismaTx) =>
      this.insertOrder(client, input, { totalAmount, now, day });
    if (tx) {
      return insert(tx);
    }
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.prisma.$transaction(insert);
      } catch (error) {
        if (attempt >= CREATE_MAX_ATTEMPTS || !isTransactionConflict(error)) {
          throw error;
        }
      }
    }
  }

  async findAll(
    query: ListOrdersQueryDto,
  ): Promise<PageResponse<OrderSummaryDto>> {
    const where = buildWhere(query);
    const [orders, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        include: { vendor: VENDOR_SUMMARY },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...toSkipTake(query),
      }),
      this.prisma.order.count({ where }),
    ]);
    return paginate(orders.map(toOrderSummary), total, query);
  }

  /** Les 6 statuts sont toujours présents (0 si aucune commande). */
  async counts(): Promise<OrderCountsDto> {
    const groups = await this.prisma.order.groupBy({
      by: ['status'],
      _count: { _all: true },
    });
    const counts = Object.fromEntries(
      ORDER_STATUSES.map((status) => [status, 0]),
    ) as Record<OrderStatus, number>;
    for (const group of groups) {
      counts[group.status] = group._count._all;
    }
    return counts;
  }

  async findOne(id: bigint): Promise<OrderDetailDto> {
    return toOrderDetail(await this.findDetail(this.prisma, id));
  }

  /**
   * Correction admin (US-CMD-05) : seulement en `non_traitee` ou `validee`,
   * sinon `409` (PO-14). `items` remplace tous les articles et recalcule le
   * total. Non tracée dans l'historique.
   */
  async update(id: bigint, dto: UpdateOrderDto): Promise<OrderDetailDto> {
    const data: Prisma.OrderUpdateInput = {
      customerName: dto.customerName,
      customerPhone: dto.customerPhone,
      deliveryLocation: dto.deliveryLocation,
      notes: emptyToNull(dto.notes),
    };
    if (dto.items) {
      data.totalAmount = totalOrBadRequest(dto.items);
      data.items = { deleteMany: {}, create: toItemRows(dto.items) };
    }
    return this.prisma.$transaction(async (tx) => {
      const status = await this.lockStatus(tx, id);
      if (!isEditable(status)) {
        throw new ConflictException(ORDER_NOT_EDITABLE_MESSAGE);
      }
      await tx.order.update({ where: { id }, data });
      return toOrderDetail(await this.findDetail(tx, id));
    });
  }

  /** Transition de statut (US-CMD-06) : `409` si refusée, historique sinon. */
  async changeStatus(
    id: bigint,
    dto: ChangeStatusDto,
    userId: bigint,
  ): Promise<OrderDetailDto> {
    return this.prisma.$transaction(async (tx) => {
      const from = await this.lockStatus(tx, id);
      assertTransition(from, dto.status);
      await tx.order.update({
        where: { id },
        data: {
          status: dto.status,
          statusHistory: {
            create: {
              fromStatus: from,
              toStatus: dto.status,
              changedByUserId: userId,
              comment: emptyToNull(dto.comment) ?? null,
              changedAt: new Date(),
            },
          },
        },
      });
      return toOrderDetail(await this.findDetail(tx, id));
    });
  }

  private async insertOrder(
    tx: PrismaTx,
    input: CreateOrderInput,
    { totalAmount, now, day }: { totalAmount: number; now: Date; day: string },
  ): Promise<Order> {
    const sequence = await this.nextDailySequence(tx, day);
    return tx.order.create({
      data: {
        reference: formatReference(day, sequence),
        vendorId: input.vendorId,
        customerName: input.customerName,
        customerPhone: input.customerPhone,
        deliveryLocation: input.deliveryLocation,
        notes: input.notes ?? null,
        totalAmount,
        createdAt: now,
        items: { create: toItemRows(input.items) },
        statusHistory: {
          create: {
            fromStatus: null,
            toStatus: 'non_traitee',
            changedByUserId: null,
            changedAt: now,
          },
        },
      },
    });
  }

  /**
   * Crée la ligne du jour (`last_seq = 0`) si elle manque, en autocommit sur
   * la connexion du service, hors de toute transaction. La lecture préalable
   * (non verrouillante) évite l'`INSERT` dans le cas courant.
   */
  private async ensureDailyCounter(day: string): Promise<void> {
    const existing = await this.prisma.$queryRaw<{ found: number }[]>`
      SELECT 1 AS found FROM daily_counters WHERE day = ${day}`;
    if (existing.length === 0) {
      await this.prisma
        .$executeRaw`INSERT IGNORE INTO daily_counters (day, last_seq) VALUES (${day}, 0)`;
    }
  }

  /**
   * Incrémente la séquence du jour : l'`UPDATE` pose un verrou de ligne
   * exclusif jusqu'au COMMIT, ce qui sérialise les créations simultanées ;
   * la relecture se fait sous le même verrou.
   */
  private async nextDailySequence(tx: PrismaTx, day: string): Promise<number> {
    const updated = await tx.$executeRaw`
      UPDATE daily_counters SET last_seq = last_seq + 1 WHERE day = ${day}`;
    if (updated !== 1) {
      throw new Error(`Compteur journalier absent pour ${day}`);
    }
    const rows = await tx.$queryRaw<{ last_seq: number | bigint }[]>`
      SELECT last_seq FROM daily_counters WHERE day = ${day} FOR UPDATE`;
    return Number(rows[0].last_seq);
  }

  /** Verrouille la commande (`FOR UPDATE`) et renvoie son statut, ou `404`. */
  private async lockStatus(tx: PrismaTx, id: bigint): Promise<OrderStatus> {
    const rows = await tx.$queryRaw<{ status: OrderStatus }[]>`
      SELECT status FROM orders WHERE id = ${id} FOR UPDATE`;
    if (rows.length === 0) {
      throw new NotFoundException(ORDER_NOT_FOUND_MESSAGE);
    }
    return rows[0].status;
  }

  private async findDetail(db: PrismaTx, id: bigint): Promise<OrderWithDetail> {
    const order = await db.order.findUnique({
      where: { id },
      include: DETAIL_INCLUDE,
    });
    if (!order) {
      throw new NotFoundException(ORDER_NOT_FOUND_MESSAGE);
    }
    return order;
  }
}
