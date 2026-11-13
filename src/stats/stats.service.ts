import { Injectable } from '@nestjs/common';
import { OrderStatus } from '../generated/prisma/client.js';
import { PrismaService, toNumberId } from '../prisma/index.js';
import type { StatsQueryDto } from './dto/stats-query.dto.js';
import type {
  StatsByDayDto,
  StatsByVendorDto,
  StatsOverviewDto,
} from './dto/stats-response.dto.js';
import {
  addGroup,
  type CountAndAmount,
  microsecondsToHours,
  percentage,
} from './stats-math.js';
import {
  listDays,
  resolveStatsPeriod,
  type StatsPeriod,
} from './stats-period.js';

interface DayGroupRow {
  day: string;
  status: OrderStatus;
  count: bigint | number;
  amount: bigint | number | null;
}

interface AverageRow {
  average_us: number | string | null;
}

const emptyTotals = (): CountAndAmount => ({ count: 0, amount: 0 });

/** Bornes de `created_at` pour le SQL brut, en texte UTC (sans conversion de fuseau). */
function sqlBounds({ from, to }: StatsPeriod): [string, string] {
  return [`${from} 00:00:00.000`, `${to} 23:59:59.999`];
}

/** Statistiques (US-STAT-01 à 03), définitions de PO-20. */
@Injectable()
export class StatsService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(query: StatsQueryDto): Promise<StatsOverviewDto> {
    const period = resolveStatsPeriod(query.from, query.to);
    const [groups, averageUs] = await Promise.all([
      this.prisma.order.groupBy({
        by: ['status'],
        where: { createdAt: period.range },
        _count: { _all: true },
        _sum: { totalAmount: true },
      }),
      this.averageValidationMicroseconds(period),
    ]);
    const byStatus = Object.fromEntries(
      Object.values(OrderStatus).map((status) => [status, 0]),
    ) as Record<OrderStatus, number>;
    const totals = emptyTotals();
    for (const group of groups) {
      byStatus[group.status] = group._count._all;
      addGroup(
        totals,
        group.status,
        group._count._all,
        group._sum.totalAmount ?? 0,
      );
    }
    const outcomes = byStatus.livree + byStatus.echec;
    return {
      from: period.from,
      to: period.to,
      totalOrders: totals.count,
      totalAmount: totals.amount,
      byStatus,
      deliveryRate: percentage(byStatus.livree, outcomes),
      failureRate: percentage(byStatus.echec, outcomes),
      averageValidationHours: microsecondsToHours(averageUs),
    };
  }

  async byVendor(query: StatsQueryDto): Promise<StatsByVendorDto> {
    const period = resolveStatsPeriod(query.from, query.to);
    const [vendors, groups] = await Promise.all([
      this.prisma.vendor.findMany({
        select: { id: true, name: true },
        orderBy: { id: 'asc' },
      }),
      this.prisma.order.groupBy({
        by: ['vendorId', 'status'],
        where: { createdAt: period.range },
        _count: { _all: true },
        _sum: { totalAmount: true },
      }),
    ]);
    const totals = new Map<bigint, CountAndAmount>();
    for (const group of groups) {
      const vendorTotals = totals.get(group.vendorId) ?? emptyTotals();
      addGroup(
        vendorTotals,
        group.status,
        group._count._all,
        group._sum.totalAmount ?? 0,
      );
      totals.set(group.vendorId, vendorTotals);
    }
    return {
      from: period.from,
      to: period.to,
      data: vendors.map((vendor) => ({
        vendorId: toNumberId(vendor.id),
        vendorName: vendor.name,
        ...(totals.get(vendor.id) ?? emptyTotals()),
      })),
    };
  }

  async byDay(query: StatsQueryDto): Promise<StatsByDayDto> {
    const period = resolveStatsPeriod(query.from, query.to);
    const [start, end] = sqlBounds(period);
    // Jour = date UTC de `created_at` (stocké en UTC, DATETIME sans fuseau).
    const rows = await this.prisma.$queryRaw<DayGroupRow[]>`
      SELECT DATE_FORMAT(created_at, '%Y-%m-%d') AS day, status,
             COUNT(*) AS count,
             CAST(SUM(total_amount) AS UNSIGNED) AS amount
      FROM orders
      WHERE created_at BETWEEN ${start} AND ${end}
      GROUP BY day, status`;
    const totals = new Map<string, CountAndAmount>();
    for (const row of rows) {
      const dayTotals = totals.get(row.day) ?? emptyTotals();
      addGroup(dayTotals, row.status, Number(row.count), Number(row.amount));
      totals.set(row.day, dayTotals);
    }
    return {
      from: period.from,
      to: period.to,
      data: listDays(period).map((day) => ({
        day,
        ...(totals.get(day) ?? emptyTotals()),
      })),
    };
  }

  /**
   * Moyenne, en microsecondes, entre `created_at` et la première entrée
   * `validee` de l'historique, pour les commandes de la période qui en ont
   * une ; `null` sinon (PO-20 f). Sous-requête corrélée limitée aux
   * commandes de la période ; AVG ignore celles sans entrée `validee` (NULL).
   */
  private async averageValidationMicroseconds(
    period: StatsPeriod,
  ): Promise<number | null> {
    const [start, end] = sqlBounds(period);
    const rows = await this.prisma.$queryRaw<AverageRow[]>`
      SELECT CAST(AVG(TIMESTAMPDIFF(MICROSECOND, p.created_at, p.validated_at)) AS DOUBLE) AS average_us
      FROM (
        SELECT o.created_at,
               (SELECT MIN(h.changed_at)
                FROM order_status_history h
                WHERE h.order_id = o.id
                  AND h.to_status = ${OrderStatus.validee}) AS validated_at
        FROM orders o
        WHERE o.created_at BETWEEN ${start} AND ${end}
      ) p`;
    const average = rows[0]?.average_us ?? null;
    return average === null ? null : Number(average);
  }
}
