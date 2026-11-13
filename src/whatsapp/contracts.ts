/**
 * Contrats entre le webhook (`whatsapp`) et le bot, sans dépendance Nest.
 * Le module `bot` (étape 5) fournit l'implémentation de `MessageHandler`
 * sous le jeton `MESSAGE_HANDLER` dans `WhatsappModule`, qui importe
 * `BotModule` : `whatsapp` -> `bot`, sans cycle.
 */

/** Types internes transmis au bot (PO-13 : `unsupported` pour le reste). */
export type IncomingMessageType = 'text' | 'button' | 'unsupported';

/** Message normalisé : `{ wamid, from, type, text?, buttonId? }` (DAT section 5). */
export interface IncomingMessage {
  wamid: string;
  /** Numéro de l'expéditeur au format international sans `+`, tel que reçu. */
  from: string;
  type: IncomingMessageType;
  text?: string;
  buttonId?: string;
}

/** Port de traitement des messages normalisés. */
export interface MessageHandler {
  handle(message: IncomingMessage): Promise<void>;
}

/** Jeton d'injection du `MessageHandler`. */
export const MESSAGE_HANDLER = Symbol('MESSAGE_HANDLER');
