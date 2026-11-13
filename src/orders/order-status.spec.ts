import { ConflictException } from '@nestjs/common';
import type { OrderStatus } from '../generated/prisma/client.js';
import {
  assertTransition,
  canTransition,
  isEditable,
  ORDER_STATUSES,
  toOrderStatus,
  transitionRefusedMessage,
} from './order-status.js';

const ALLOWED: [OrderStatus, OrderStatus][] = [
  ['non_traitee', 'validee'],
  ['non_traitee', 'annulee'],
  ['validee', 'prete'],
  ['validee', 'annulee'],
  ['prete', 'livree'],
  ['prete', 'echec'],
  ['prete', 'annulee'],
  ['echec', 'prete'],
];

const isAllowed = (from: OrderStatus, to: OrderStatus) =>
  ALLOWED.some(([f, t]) => f === from && t === to);

// Toutes les paires (36) moins les 8 autorisées : 28 refus, dont ceux de US-CMD-06.
const REFUSED = ORDER_STATUSES.flatMap((from) =>
  ORDER_STATUSES.filter((to) => !isAllowed(from, to)).map(
    (to): [OrderStatus, OrderStatus] => [from, to],
  ),
);

describe('order-status', () => {
  it.each(ALLOWED)('autorise %s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
    expect(() => assertTransition(from, to)).not.toThrow();
  });

  it('refuse les 28 autres transitions', () => {
    expect(REFUSED).toHaveLength(28);
  });

  it.each(REFUSED)('refuse %s → %s en 409', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
    expect(() => assertTransition(from, to)).toThrow(
      new ConflictException(transitionRefusedMessage(from, to)),
    );
  });

  it.each(['livree', 'annulee'] as const)('%s est un état final', (from) => {
    expect(ORDER_STATUSES.some((to) => canTransition(from, to))).toBe(false);
  });

  it('n’autorise la correction qu’en non_traitee et validee (PO-14)', () => {
    expect(ORDER_STATUSES.filter((status) => isEditable(status))).toEqual([
      'non_traitee',
      'validee',
    ]);
  });
});

describe('toOrderStatus', () => {
  it('accepte les 6 statuts et refuse une autre valeur', () => {
    for (const status of ORDER_STATUSES) {
      expect(toOrderStatus(status)).toBe(status);
    }
    expect(() => toOrderStatus('expediee')).toThrow(RangeError);
  });
});
