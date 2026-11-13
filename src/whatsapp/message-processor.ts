import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
} from '@nestjs/common';
import {
  describeError,
  isUniqueViolation,
  maskPhone,
} from '../common/index.js';
import { PrismaService } from '../prisma/index.js';
import { WhatsappClient } from './client/index.js';
import {
  type IncomingMessage,
  MESSAGE_HANDLER,
  type MessageHandler,
} from './contracts.js';
import { extractMessages } from './normalize-messages.js';

/** Envoyé au vendeur quand le traitement de son message échoue (PO-24). */
export const PROCESSING_ERROR_MESSAGE =
  'Une erreur est survenue, veuillez renvoyer votre message.';

/** Attente maximale des traitements en cours à l'arrêt de l'application. */
export const SHUTDOWN_TIMEOUT_MS = 10_000;

/**
 * Traitement d'un payload webhook signé, après la réponse 200 : messages
 * traités dans l'ordre, un à la fois par expéditeur (file par `from`),
 * idempotence par `wamid`, aucune exception remontée.
 */
@Injectable()
export class MessageProcessor implements OnModuleDestroy {
  private readonly logger = new Logger(MessageProcessor.name);
  /** Dernier traitement en file par expéditeur ; ces promesses ne rejettent jamais. */
  private readonly queues = new Map<string, Promise<void>>();
  private readonly inFlight = new Set<Promise<void>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: WhatsappClient,
    @Inject(MESSAGE_HANDLER) private readonly handler: MessageHandler,
  ) {}

  /** Lance le traitement d'un payload ; suivi jusqu'à sa fin pour l'arrêt propre. */
  process(payload: unknown): Promise<void> {
    const run = this.processPayload(payload);
    this.inFlight.add(run);
    const forget = () => this.inFlight.delete(run);
    void run.then(forget, forget);
    return run;
  }

  /**
   * Appelé avant la déconnexion de Prisma (module global, détruit en
   * dernier) : attend les traitements en cours, au plus 10 s.
   */
  async onModuleDestroy(): Promise<void> {
    if (this.inFlight.size === 0) {
      return;
    }
    this.logger.log(
      `Arrêt : attente de ${this.inFlight.size} traitement(s) webhook en cours`,
    );
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), SHUTDOWN_TIMEOUT_MS);
    });
    const settled = Promise.allSettled(this.inFlight).then(() => true as const);
    const finished = await Promise.race([settled, timeout]);
    clearTimeout(timer);
    if (!finished) {
      this.logger.warn(
        `Arrêt : ${this.inFlight.size} traitement(s) webhook interrompu(s) après ${SHUTDOWN_TIMEOUT_MS} ms`,
      );
    }
  }

  private async processPayload(payload: unknown): Promise<void> {
    const extracted = extractMessages(payload);
    if (extracted === null) {
      this.logger.warn('Payload webhook de structure inattendue : ignoré');
      return;
    }
    if (extracted.invalidCount > 0) {
      this.logger.warn(
        `${extracted.invalidCount} message(s) webhook mal formé(s) ignoré(s)`,
      );
    }
    for (const message of extracted.messages) {
      await this.enqueue(message.from, () => this.processMessage(message));
    }
  }

  /**
   * Chaîne `task` après le traitement en cours du même expéditeur. Une
   * erreur est journalisée et ne casse pas la chaîne ; l'entrée est retirée
   * quand la file de cet expéditeur est vide.
   */
  private enqueue(from: string, task: () => Promise<void>): Promise<void> {
    const previous = this.queues.get(from) ?? Promise.resolve();
    const current = previous.then(task).catch((error: unknown) => {
      this.logger.error(
        `Échec inattendu de la file de ${maskPhone(from)} : ${describeError(error)}`,
      );
    });
    this.queues.set(from, current);
    void current.then(() => {
      if (this.queues.get(from) === current) {
        this.queues.delete(from);
      }
    });
    return current;
  }

  private async processMessage(message: IncomingMessage): Promise<void> {
    try {
      if (!(await this.markProcessed(message.wamid))) {
        this.logger.log(`Message ${message.wamid} déjà traité : ignoré`);
        return;
      }
      await this.handler.handle(message);
    } catch (error) {
      this.logger.error(
        `Échec du traitement du message ${message.wamid} de ${maskPhone(message.from)} : ${describeError(error)}`,
      );
      await this.notifyFailure(message.from);
    }
  }

  /** Insère le `wamid` ; `false` s'il était déjà présent (renvoi de Meta). */
  private async markProcessed(wamid: string): Promise<boolean> {
    try {
      await this.prisma.processedMessage.create({ data: { wamid } });
      return true;
    } catch (error) {
      if (isUniqueViolation(error)) {
        return false;
      }
      throw error;
    }
  }

  /** PO-24 : prévient le vendeur ; un échec de cet envoi est journalisé et ignoré. */
  private async notifyFailure(to: string): Promise<void> {
    try {
      await this.client.sendText(to, PROCESSING_ERROR_MESSAGE);
    } catch (error) {
      this.logger.warn(
        `Message d'erreur non envoyé à ${maskPhone(to)} : ${describeError(error)}`,
      );
    }
  }
}
