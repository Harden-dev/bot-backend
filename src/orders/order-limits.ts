/**
 * Limites d'une commande (R-P6, PO-07, PO-14), communes à la correction
 * admin (`PATCH /orders/:id`) et au parsing du bot.
 */
export const ORDER_LIMITS = {
  customerNameMaxLength: 120,
  deliveryLocationMaxLength: 255,
  notesMaxLength: 1000,
  itemLabelMaxLength: 190,
  minItems: 1,
  maxItems: 30,
  minQuantity: 1,
  maxQuantity: 999,
  minUnitPrice: 1,
  maxUnitPrice: 10_000_000,
  statusCommentMaxLength: 255,
} as const;
