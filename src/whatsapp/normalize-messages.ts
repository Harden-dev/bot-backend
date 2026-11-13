import type { IncomingMessage } from './contracts.js';
import type {
  MetaChange,
  MetaEntry,
  MetaMessage,
  MetaWebhookPayload,
} from './meta.types.js';

/** Longueur de `processed_messages.wamid` (VARCHAR(120)). */
export const MAX_WAMID_LENGTH = 120;

/** Messages extraits d'un payload, et nombre de messages mal formés écartés. */
export interface ExtractedMessages {
  messages: IncomingMessage[];
  invalidCount: number;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

/** Message exploitable : `id` (1 à 120 caractères), `from` et `type` présents. */
function isMessage(value: unknown): value is MetaMessage {
  return (
    isObject(value) &&
    isNonEmptyString(value['id']) &&
    value['id'].length <= MAX_WAMID_LENGTH &&
    isNonEmptyString(value['from']) &&
    typeof value['type'] === 'string'
  );
}

function isChange(value: unknown): value is MetaChange {
  if (!isObject(value) || !isObject(value['value'])) {
    return false;
  }
  const messages = value['value']['messages'];
  return messages === undefined || Array.isArray(messages);
}

function isEntry(value: unknown): value is MetaEntry {
  return (
    isObject(value) &&
    Array.isArray(value['changes']) &&
    value['changes'].every(isChange)
  );
}

/** Garde de type : structure globale attendue d'un payload webhook (PO-29). */
function isMetaWebhookPayload(payload: unknown): payload is MetaWebhookPayload {
  return (
    isObject(payload) &&
    Array.isArray(payload['entry']) &&
    payload['entry'].every(isEntry)
  );
}

/**
 * Normalise un message Meta : `text` -> corps, `interactive.button_reply`
 * -> identifiant du bouton, tout le reste -> `unsupported` (PO-13 : c'est le
 * bot qui répond, après le contrôle de la liste blanche).
 */
export function normalizeMessage(message: MetaMessage): IncomingMessage {
  const base = { wamid: message.id, from: message.from };
  const body = message.text?.body;
  if (message.type === 'text' && typeof body === 'string') {
    return { ...base, type: 'text', text: body };
  }
  const interactive = message.interactive;
  const buttonId = interactive?.button_reply?.id;
  if (
    message.type === 'interactive' &&
    interactive?.type === 'button_reply' &&
    typeof buttonId === 'string'
  ) {
    return { ...base, type: 'button', buttonId };
  }
  return { ...base, type: 'unsupported' };
}

/**
 * Extrait et normalise les messages de `entry[].changes[].value.messages[]`,
 * dans l'ordre du payload ; les `statuses[]` sont ignorés. PO-29 : un message
 * mal formé est écarté (compté dans `invalidCount`), les autres sont gardés ;
 * une structure globale inattendue renvoie `null` (rien n'est traité).
 */
export function extractMessages(payload: unknown): ExtractedMessages | null {
  if (!isMetaWebhookPayload(payload)) {
    return null;
  }
  const raw: unknown[] = payload.entry.flatMap((entry) =>
    entry.changes.flatMap((change) => change.value.messages ?? []),
  );
  const valid = raw.filter(isMessage);
  return {
    messages: valid.map(normalizeMessage),
    invalidCount: raw.length - valid.length,
  };
}
