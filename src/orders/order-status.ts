import { ConflictException } from '@nestjs/common';
import { OrderStatus } from '../generated/prisma/client.js';

/** Les 6 statuts, dans l'ordre du cycle de vie (validation `@IsIn`). */
export const ORDER_STATUSES = [
  OrderStatus.non_traitee,
  OrderStatus.validee,
  OrderStatus.prete,
  OrderStatus.livree,
  OrderStatus.echec,
  OrderStatus.annulee,
] as const;

/** Statuts dans lesquels une commande peut encore être corrigée (PO-14). */
export const EDITABLE_STATUSES: readonly OrderStatus[] = [
  OrderStatus.non_traitee,
  OrderStatus.validee,
];

/** Transitions autorisées (DAT section 4) ; `livree` et `annulee` sont finaux. */
export const ORDER_TRANSITIONS: Readonly<
  Record<OrderStatus, readonly OrderStatus[]>
> = {
  non_traitee: [OrderStatus.validee, OrderStatus.annulee],
  validee: [OrderStatus.prete, OrderStatus.annulee],
  prete: [OrderStatus.livree, OrderStatus.echec, OrderStatus.annulee],
  echec: [OrderStatus.prete],
  livree: [],
  annulee: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

export function transitionRefusedMessage(
  from: OrderStatus,
  to: OrderStatus,
): string {
  return `Transition de statut non autorisée : ${from} → ${to}`;
}

/** Lève `409` si la transition n'est pas dans la table. */
export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransition(from, to)) {
    throw new ConflictException(transitionRefusedMessage(from, to));
  }
}

export function isEditable(status: OrderStatus): boolean {
  return EDITABLE_STATUSES.includes(status);
}

/**
 * `order_status_history.from_status/to_status` sont des `VARCHAR` (DAT) :
 * contrôle qu'une valeur lue est bien un statut (écrite uniquement par ce
 * module).
 */
export function toOrderStatus(value: string): OrderStatus {
  const status = ORDER_STATUSES.find((candidate) => candidate === value);
  if (status === undefined) {
    throw new RangeError(`Statut inconnu dans l'historique : ${value}`);
  }
  return status;
}
