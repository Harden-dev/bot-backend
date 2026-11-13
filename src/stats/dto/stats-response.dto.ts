import { ApiProperty } from '@nestjs/swagger';
import { OrderStatus } from '../../generated/prisma/client.js';

/** Période effective (bornes incluses, jours UTC). */
export class StatsPeriodDto {
  @ApiProperty({ example: '2026-10-15' })
  from: string;

  @ApiProperty({ example: '2026-11-13' })
  to: string;
}

/** `GET /stats/overview` (US-STAT-01, PO-20). */
export class StatsOverviewDto extends StatsPeriodDto {
  @ApiProperty({ example: 42, description: 'Tous statuts' })
  totalOrders: number;

  @ApiProperty({ example: 1_250_000, description: 'XOF, hors annulee' })
  totalAmount: number;

  @ApiProperty({
    description: 'Les 6 statuts, 0 si vide',
    example: Object.fromEntries(
      Object.values(OrderStatus).map((status) => [status, 0]),
    ),
  })
  byStatus: Record<OrderStatus, number>;

  @ApiProperty({
    example: 80,
    type: Number,
    nullable: true,
    description: '% livree ÷ (livree + echec) ; null si aucune',
  })
  deliveryRate: number | null;

  @ApiProperty({
    example: 20,
    type: Number,
    nullable: true,
    description: '% echec ÷ (livree + echec) ; null si aucune',
  })
  failureRate: number | null;

  @ApiProperty({
    example: 2.5,
    type: Number,
    nullable: true,
    description: 'Heures jusqu’à la première entrée validee ; null si aucune',
  })
  averageValidationHours: number | null;
}

export class VendorStatsDto {
  @ApiProperty({ example: 1 })
  vendorId: number;

  @ApiProperty({ example: 'Boutique Awa' })
  vendorName: string;

  @ApiProperty({ example: 12, description: 'Tous statuts' })
  count: number;

  @ApiProperty({ example: 380_000, description: 'XOF, hors annulee' })
  amount: number;
}

/** `GET /stats/by-vendor` : tous les vendeurs, actifs ou non (PO-20 h). */
export class StatsByVendorDto extends StatsPeriodDto {
  @ApiProperty({ type: [VendorStatsDto] })
  data: VendorStatsDto[];
}

export class DayStatsDto {
  @ApiProperty({ example: '2026-11-13' })
  day: string;

  @ApiProperty({ example: 5, description: 'Tous statuts' })
  count: number;

  @ApiProperty({ example: 120_000, description: 'XOF, hors annulee' })
  amount: number;
}

/** `GET /stats/by-day` : chaque jour de la période, 0 si vide (PO-20 g). */
export class StatsByDayDto extends StatsPeriodDto {
  @ApiProperty({ type: [DayStatsDto] })
  data: DayStatsDto[];
}
