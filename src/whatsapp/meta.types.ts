/**
 * Interfaces minimales du payload webhook WhatsApp Cloud API : seuls les
 * champs lus par le backend sont décrits. Le payload est validé à la main
 * (gardes de type de `normalize-messages.ts`), pas par DTO.
 */
export interface MetaWebhookPayload {
  entry: MetaEntry[];
}

export interface MetaEntry {
  changes: MetaChange[];
}

export interface MetaChange {
  value: MetaChangeValue;
}

export interface MetaChangeValue {
  /** Éléments contrôlés un par un (PO-29). */
  messages?: unknown[];
  statuses?: unknown[];
}

export interface MetaMessage {
  id: string;
  from: string;
  type: string;
  text?: { body?: unknown };
  interactive?: { type?: unknown; button_reply?: { id?: unknown } };
}
