/**
 * Plafond du total d'une commande en XOF (PO-01, validé par le client) :
 * maximum de `orders.total_amount` (`INT UNSIGNED`).
 */
export const MAX_ORDER_TOTAL = 4_294_967_295;

export const ORDER_TOTAL_EXCEEDED_MESSAGE =
  'Le total de la commande dépasse 4 294 967 295 F : scindez la commande.';

/** Total supérieur à `MAX_ORDER_TOTAL`. */
export class OrderTotalExceededError extends Error {
  constructor() {
    super(ORDER_TOTAL_EXCEEDED_MESSAGE);
    this.name = 'OrderTotalExceededError';
  }
}

export interface PricedItem {
  quantity: number;
  unitPrice: number;
}

export const INVALID_TOTAL_MESSAGE =
  'Total invalide : entier positif ou nul attendu';

/**
 * Somme des quantités × prix unitaires (entiers XOF), toujours calculée côté
 * serveur (R-P7). Lève `RangeError` si le total n'est pas un entier sûr
 * positif ou nul (NaN, négatif, décimal), `OrderTotalExceededError` au-delà
 * du plafond (PO-01).
 */
export function computeTotal(items: readonly PricedItem[]): number {
  const total = items.reduce(
    (sum, item) => sum + item.quantity * item.unitPrice,
    0,
  );
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new RangeError(INVALID_TOTAL_MESSAGE);
  }
  if (total > MAX_ORDER_TOTAL) {
    throw new OrderTotalExceededError();
  }
  return total;
}
