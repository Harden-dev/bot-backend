import { Module } from '@nestjs/common';
import { BotModule, BotService } from '../bot/index.js';
import { WhatsappClientModule } from './client/index.js';
import { MESSAGE_HANDLER } from './contracts.js';
import { MessageProcessor } from './message-processor.js';
import { WebhookLogsCleanup } from './webhook-logs.cleanup.js';
import { WebhookController } from './webhook.controller.js';
import { WebhookService } from './webhook.service.js';

/**
 * Webhook Meta : vérification, signature, `webhook_logs`, idempotence,
 * normalisation, purge ; les messages sont confiés au bot (`whatsapp` ->
 * `bot`). `WhatsappClientModule` n'y sert qu'au message d'erreur de PO-24.
 */
@Module({
  imports: [WhatsappClientModule, BotModule],
  controllers: [WebhookController],
  providers: [
    WebhookService,
    MessageProcessor,
    WebhookLogsCleanup,
    { provide: MESSAGE_HANDLER, useExisting: BotService },
  ],
})
export class WhatsappModule {}
