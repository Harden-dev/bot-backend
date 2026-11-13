import { Module } from '@nestjs/common';
import { WhatsappClientModule } from './client/index.js';
import { MESSAGE_HANDLER } from './contracts.js';
import { LoggingMessageHandler } from './message-handler.js';
import { MessageProcessor } from './message-processor.js';
import { WebhookLogsCleanup } from './webhook-logs.cleanup.js';
import { WebhookController } from './webhook.controller.js';
import { WebhookService } from './webhook.service.js';

/**
 * Webhook Meta : vérification, signature, `webhook_logs`, idempotence,
 * normalisation, purge. `WhatsappClientModule` n'y sert qu'au message
 * d'erreur de PO-24.
 */
@Module({
  imports: [WhatsappClientModule],
  controllers: [WebhookController],
  providers: [
    WebhookService,
    MessageProcessor,
    WebhookLogsCleanup,
    { provide: MESSAGE_HANDLER, useClass: LoggingMessageHandler },
  ],
})
export class WhatsappModule {}
