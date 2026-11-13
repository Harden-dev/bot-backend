import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { describeError } from '../common/index.js';
import { PrismaService } from '../prisma/index.js';

export const WEBHOOK_LOGS_RETENTION_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Purge quotidienne de `webhook_logs` (90 jours). `processed_messages` n'est pas purgé (PO-25). */
@Injectable()
export class WebhookLogsCleanup {
  private readonly logger = new Logger(WebhookLogsCleanup.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async run(): Promise<void> {
    try {
      await this.purge();
    } catch (error) {
      this.logger.error(
        `Purge de webhook_logs en échec : ${describeError(error)}`,
      );
    }
  }

  /** Supprime les journaux de plus de 90 jours ; renvoie le nombre supprimé. */
  async purge(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(
      now.getTime() - WEBHOOK_LOGS_RETENTION_DAYS * DAY_MS,
    );
    const { count } = await this.prisma.webhookLog.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    this.logger.log(`Purge de webhook_logs : ${count} ligne(s) supprimée(s)`);
    return count;
  }
}
