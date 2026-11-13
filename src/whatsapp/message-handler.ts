import { Injectable, Logger } from '@nestjs/common';
import { maskPhone } from '../common/index.js';
import type { IncomingMessage, MessageHandler } from './contracts.js';

/** Implémentation par défaut tant que le bot n'est pas branché : journalise. */
@Injectable()
export class LoggingMessageHandler implements MessageHandler {
  private readonly logger = new Logger(LoggingMessageHandler.name);

  handle(message: IncomingMessage): Promise<void> {
    this.logger.log(
      `Message ${message.wamid} (${message.type}) reçu de ${maskPhone(message.from)} : aucun traitement`,
    );
    return Promise.resolve();
  }
}
