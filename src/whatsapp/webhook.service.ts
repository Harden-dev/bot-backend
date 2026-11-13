import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { describeError } from '../common/index.js';
import type { Env } from '../config/index.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/index.js';
import { MessageProcessor } from './message-processor.js';
import { safeEqualStrings, verifyMetaSignature } from './meta-signature.js';

export const VERIFICATION_REFUSED_MESSAGE = 'Vérification du webhook refusée';
export const INVALID_SIGNATURE_MESSAGE = 'Signature invalide';

const SUBSCRIBE_MODE = 'subscribe';

/** Taille maximale journalisée pour un POST non authentifié (signature invalide). */
export const MAX_UNSIGNED_LOG_BYTES = 4_096;
/** Aperçu conservé au-delà, en octets (marge pour l'échappement JSON). */
export const UNSIGNED_LOG_PREVIEW_BYTES = 3_072;

/**
 * Payload écrit dans `webhook_logs`. Signature valide : tel quel. Signature
 * invalide (écriture sans authentification) : tel quel jusqu'à 4 ko, sinon
 * `{ truncated: true, size, preview }` (JSON valide, `size` en octets).
 * Corps absent ou non lu (type de contenu autre que JSON) : `{}`.
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
  if (bytes.length <= MAX_UNSIGNED_LOG_BYTES) {
    return value;
  }
  return {
    truncated: true,
    size: bytes.length,
    preview: bytes.subarray(0, UNSIGNED_LOG_PREVIEW_BYTES).toString('utf8'),
  };
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
   * POST signé : journalise le payload dans `webhook_logs` (validité de la
   * signature comprise), refuse en 403 une signature absente ou fausse, sinon
   * lance le traitement sans l'attendre. Un échec d'écriture du journal
   * remonte (500) : Meta renverra l'événement.
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
    await this.prisma.webhookLog.create({
      data: {
        signatureValid,
        payload: toLoggedPayload(payload, rawBody, signatureValid),
      },
    });
    if (!signatureValid) {
      this.logger.warn('Webhook refusé : signature absente ou invalide');
      throw new ForbiddenException(INVALID_SIGNATURE_MESSAGE);
    }
    this.processor.process(payload).catch((error: unknown) => {
      this.logger.error(
        `Échec inattendu du traitement du webhook : ${describeError(error)}`,
      );
    });
  }
}
