import { ApiProperty } from '@nestjs/swagger';
import { type PageResponse, PageMetaDto } from '../../common/index.js';
import type {
  Order,
  OrderItem,
  OrderStatus,
  OrderStatusHistory,
  Vendor,
} from '../../generated/prisma/client.js';
import { toNumberId } from '../../prisma/index.js';
import { ORDER_STATUSES, toOrderStatus } from '../order-status.js';

export class OrderVendorDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'Boutique Awa' })
  name: string;
}

/** Ligne de la liste `GET /orders`. */
export class OrderSummaryDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'CMD-20261110-003' })
  reference: string;

  @ApiProperty({ enum: ORDER_STATUSES })
  status: OrderStatus;

  @ApiProperty({ example: 'Aya Kouassi' })
  customerName: string;

  @ApiProperty({ example: '0707070707' })
  customerPhone: string;

  @ApiProperty({ example: 'Cocody Angré' })
  deliveryLocation: string;

  @ApiProperty({ example: 38000, description: 'XOF' })
  totalAmount: number;

  @ApiProperty({ type: OrderVendorDto })
  vendor: OrderVendorDto;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class OrderItemResponseDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'Robe wax' })
  label: string;

  @ApiProperty({ example: 2 })
  quantity: number;

  @ApiProperty({ example: 15000, description: 'XOF' })
  unitPrice: number;
}

export class OrderHistoryDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ enum: ORDER_STATUSES, nullable: true })
  fromStatus: OrderStatus | null;

  @ApiProperty({ enum: ORDER_STATUSES })
  toStatus: OrderStatus;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'null : création par le bot',
  })
  changedByUserId: number | null;

  @ApiProperty({ type: String, nullable: true })
  comment: string | null;

  @ApiProperty()
  changedAt: Date;
}

/** Réponse paginée de `GET /orders` (Swagger). */
export class OrderPageDto implements PageResponse<OrderSummaryDto> {
  @ApiProperty({ type: [OrderSummaryDto] })
  data: OrderSummaryDto[];

  @ApiProperty({ type: PageMetaDto })
  meta: PageMetaDto;
}

/** Détail `GET /orders/:id` : articles, vendeur et historique des statuts. */
export class OrderDetailDto extends OrderSummaryDto {
  @ApiProperty({ type: String, nullable: true })
  notes: string | null;

  @ApiProperty({ type: [OrderItemResponseDto] })
  items: OrderItemResponseDto[];

  @ApiProperty({ type: [OrderHistoryDto] })
  history: OrderHistoryDto[];
}

/** Nombre de commandes pour chacun des 6 statuts (US-CMD-03). */
export class OrderCountsDto implements Record<OrderStatus, number> {
  @ApiProperty({ example: 4 })
  non_traitee: number;

  @ApiProperty({ example: 2 })
  validee: number;

  @ApiProperty({ example: 1 })
  prete: number;

  @ApiProperty({ example: 10 })
  livree: number;

  @ApiProperty({ example: 0 })
  echec: number;

  @ApiProperty({ example: 0 })
  annulee: number;
}

export type OrderWithVendor = Order & { vendor: Pick<Vendor, 'id' | 'name'> };

export type OrderWithDetail = OrderWithVendor & {
  items: OrderItem[];
  statusHistory: OrderStatusHistory[];
};

export function toOrderSummary(order: OrderWithVendor): OrderSummaryDto {
  return {
    id: toNumberId(order.id),
    reference: order.reference,
    status: order.status,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    deliveryLocation: order.deliveryLocation,
    totalAmount: order.totalAmount,
    vendor: { id: toNumberId(order.vendor.id), name: order.vendor.name },
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

export function toOrderDetail(order: OrderWithDetail): OrderDetailDto {
  return {
    ...toOrderSummary(order),
    notes: order.notes,
    items: order.items.map((item) => ({
      id: toNumberId(item.id),
      label: item.label,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
    })),
    history: order.statusHistory.map((entry) => ({
      id: toNumberId(entry.id),
      fromStatus:
        entry.fromStatus === null ? null : toOrderStatus(entry.fromStatus),
      toStatus: toOrderStatus(entry.toStatus),
      changedByUserId:
        entry.changedByUserId === null
          ? null
          : toNumberId(entry.changedByUserId),
      comment: entry.comment,
      changedAt: entry.changedAt,
    })),
  };
}
