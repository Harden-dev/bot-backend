import type { OrderStatus } from '../generated/prisma/client.js';

/** Statut exclu du montant (PO-20 d) ; `echec` reste inclus. */
const EXCLUDED_FROM_AMOUNT: OrderStatus = 'annulee';

export interface CountAndAmount {
  count: number;
  amount: number;
}

/**
 * Ajoute un groupe (statut, nombre, somme) : toutes les commandes sont
 * comptées, le montant exclut `annulee` (PO-20 d, g, h).
 */
export function addGroup(
  totals: CountAndAmount,
  status: OrderStatus,
  count: number,
  amount: number,
): void {
  totals.count += count;
  if (status !== EXCLUDED_FROM_AMOUNT) {
    totals.amount += amount;
  }
}

function roundOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Pourcentage à une décimale ; `null` si le dénominateur est nul (PO-20 e). */
export function percentage(part: number, total: number): number | null {
  return total === 0 ? null : Math.round((part * 1000) / total) / 10;
}

/** Microsecondes moyennes en heures à une décimale ; `null` si aucune (PO-20 f). */
export function microsecondsToHours(value: number | null): number | null {
  return value === null ? null : roundOneDecimal(value / 3_600_000_000);
}
