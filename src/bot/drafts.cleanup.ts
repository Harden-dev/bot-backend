import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { describeError } from '../common/index.js';
import { PrismaService } from '../prisma/index.js';

export const FINISHED_DRAFTS_RETENTION_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface DraftsCleanupResult {
  expired: number;
  deleted: number;
}

/**
 * Tâche horaire (US-BOT-15) : `pending` échus -> `expired`, puis suppression
 * des brouillons `expired`, `cancelled` ou `confirmed` depuis plus de 7 jours.
 * Le schéma n'ayant pas de date de fin, `expires_at` sert de repère : un
 * brouillon est confirmé ou annulé avant `expires_at`, et expiré à partir de
 * cette date. Les commandes créées ne sont jamais touchées.
 */
@Injectable()
export class DraftsCleanup {
  private readonly logger = new Logger(DraftsCleanup.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async run(): Promise<void> {
    try {
      await this.cleanup();
    } catch (error) {
      this.logger.error(
        `Nettoyage des brouillons en échec : ${describeError(error)}`,
      );
    }
  }

  async cleanup(now: Date = new Date()): Promise<DraftsCleanupResult> {
    const expired = await this.prisma.orderDraft.updateMany({
      where: { status: 'pending', expiresAt: { lte: now } },
      data: { status: 'expired' },
    });
    const cutoff = new Date(
      now.getTime() - FINISHED_DRAFTS_RETENTION_DAYS * DAY_MS,
    );
    const deleted = await this.prisma.orderDraft.deleteMany({
      where: {
        status: { in: ['expired', 'cancelled', 'confirmed'] },
        expiresAt: { lt: cutoff },
      },
    });
    this.logger.log(
      `Brouillons : ${expired.count} expiré(s), ${deleted.count} supprimé(s)`,
    );
    return { expired: expired.count, deleted: deleted.count };
  }
}
