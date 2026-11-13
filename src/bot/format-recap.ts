import { formatXof } from '../common/index.js';
import { MAX_INTERACTIVE_BODY_LENGTH } from '../whatsapp/client/index.js';
import { RECAP_TEXT } from './messages.js';
import type { ParsedItem, ParsedOrder } from './parse-order.js';

/** Corps maximal d'un message à boutons (PO-06). */
export const MAX_RECAP_LENGTH = MAX_INTERACTIVE_BODY_LENGTH;

/** Sous-total affiché seulement si la quantité dépasse 1 (PO-05). */
function formatItem({ label, quantity, unitPrice }: ParsedItem): string {
  const line = `${RECAP_TEXT.bullet}${quantity} × ${label} — ${formatXof(unitPrice)}`;
  return quantity > 1 ? `${line} = ${formatXof(quantity * unitPrice)}` : line;
}

/** Récapitulatif au format exact du DAT section 6. */
export function formatRecap(order: ParsedOrder): string {
  return [
    RECAP_TEXT.title,
    `${RECAP_TEXT.customer}${order.customerName}`,
    `${RECAP_TEXT.phone}${order.customerPhone}`,
    `${RECAP_TEXT.location}${order.deliveryLocation}`,
    RECAP_TEXT.items,
    ...order.items.map(formatItem),
    `${RECAP_TEXT.total}${formatXof(order.total)}${RECAP_TEXT.currency}`,
  ].join('\n');
}

/** Le récapitulatif tient dans un message à boutons (≤ 1 024 caractères). */
export function fitsInRecap(recap: string): boolean {
  return recap.length <= MAX_RECAP_LENGTH;
}
