import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { describeError } from '../common/index.js';
import type { Env } from '../config/index.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/index.js';
import { MessageProcessor } from './message-processor.js';
import { safeEqualStrings, verifyMetaSignature } from './meta-signature.js';
import { UnsignedLogBudget } from './unsigned-log-budget.js';

export const VERIFICATION_REFUSED_MESSAGE = 'Vérification du webhook refusée';
export const INVALID_SIGNATURE_MESSAGE = 'Signature invalide';

const SUBSCRIBE_MODE = 'subscribe';

/** Aperçu conservé d'un POST non signé, en octets UTF-8 (H-01). */
export const UNSIGNED_LOG_PREVIEW_BYTES = 256;

/** Premiers octets du corps, sans dépasser la limite (caractère coupé retiré). */
function preview(bytes: Buffer): string {
  let text = bytes.subarray(0, UNSIGNED_LOG_PREVIEW_BYTES).toString('utf8');
  while (Buffer.byteLength(text) > UNSIGNED_LOG_PREVIEW_BYTES) {
    text = text.slice(0, -1);
  }
  return text;
}

/**
 * Payload écrit dans `webhook_logs`. Signature valide : tel quel. Signature
 * absente ou invalide (écriture sans authentification) : jamais le contenu
 * analysé, seulement `{ unsigned: true, size, preview }` (JSON valide sans
 * imbrication ; `size` en octets, `preview` de 256 octets au plus). Corps non
 * lu (type de contenu autre que JSON) : mesuré sur `{}`.
 */
export function toLoggedPayload(
  payload: unknown,
  rawBody: Buffer | undefined,
  signatureValid: boolean,
): Prisma.InputJsonValue {
  const value = (payload ?? {}) as Prisma.InputJsonValue;
  if (signatureValid) {
    return value;
  }
  const bytes = rawBody ?? Buffer.from(JSON.stringify(value));
  return { unsigned: true, size: bytes.length, preview: preview(bytes) };
}

/** Paramètres `hub.*` de la vérification Meta, non typés à la réception. */
export interface VerificationQuery {
  mode: unknown;
  verifyToken: unknown;
  challenge: unknown;
}

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);
  private readonly verifyToken: string;
  private readonly appSecret: string;
  private readonly unsignedBudget = new UnsignedLogBudget((message) =>
    this.logger.warn(message),
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly processor: MessageProcessor,
    config: ConfigService<Env, true>,
  ) {
    this.verifyToken = config.get('WEBHOOK_VERIFY_TOKEN', { infer: true });
    this.appSecret = config.get('META_APP_SECRET', { infer: true });
  }

  /**
   * GET de vérification : renvoie `hub.challenge` si le mode est `subscribe`
   * et le jeton correct (comparaison en temps constant), sinon 403. Journalisé
   * dans les logs applicatifs uniquement, sans le jeton (PO-26).
   */
  verifySubscription(query: VerificationQuery): string {
    const { mode, verifyToken, challenge } = query;
    const accepted =
      mode === SUBSCRIBE_MODE &&
      typeof verifyToken === 'string' &&
      typeof challenge === 'string' &&
      safeEqualStrings(verifyToken, this.verifyToken);
    if (!accepted) {
      this.logger.warn('Vérification du webhook refusée');
      throw new ForbiddenException(VERIFICATION_REFUSED_MESSAGE);
    }
    this.logger.log('Vérification du webhook acceptée');
    return challenge;
  }

  /**
   * POST signé : journalise le payload complet dans `webhook_logs`, puis lance
   * le traitement sans l'attendre. Un échec d'écriture du journal remonte
   * (500) : Meta renverra l'événement. Signature absente ou fausse : aperçu
   * seulement, dans la limite du plafond par minute (au-delà, rien n'est
   * écrit en base), puis 403.
   */
  async receive(
    rawBody: Buffer | undefined,
    signature: string | undefined,
    payload: unknown,
  ): Promise<void> {
    const signatureValid = verifyMetaSignature(
      rawBody,
      signature,
      this.appSecret,
    );
    if (!signatureValid) {
      await this.logUnsigned(payload, rawBody);
      throw new ForbiddenException(INVALID_SIGNATURE_MESSAGE);
    }
    await this.prisma.webhookLog.create({
      data: {
        signatureValid: true,
        payload: toLoggedPayload(payload, rawBody, true),
      },
    });
    this.processor.process(payload).catch((error: unknown) => {
      this.logger.error(
        `Échec inattendu du traitement du webhook : ${describeError(error)}`,
      );
    });
  }

  private async logUnsigned(
    payload: unknown,
    rawBody: Buffer | undefined,
  ): Promise<void> {
    if (!this.unsignedBudget.tryConsume(Date.now())) {
      return;
    }
    this.logger.warn('Webhook refusé : signature absente ou invalide');
    await this.prisma.webhookLog.create({
      data: {
        signatureValid: false,
        payload: toLoggedPayload(payload, rawBody, false),
      },
    });
  }
}
