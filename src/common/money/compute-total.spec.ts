import {
  computeTotal,
  INVALID_TOTAL_MESSAGE,
  MAX_ORDER_TOTAL,
  ORDER_TOTAL_EXCEEDED_MESSAGE,
  OrderTotalExceededError,
} from './compute-total.js';

describe('computeTotal', () => {
  it('additionne quantité × prix unitaire (2 × 15 000 + 1 × 8 000 = 38 000)', () => {
    expect(
      computeTotal([
        { quantity: 2, unitPrice: 15_000 },
        { quantity: 1, unitPrice: 8_000 },
      ]),
    ).toBe(38_000);
  });

  it('renvoie 0 sans article', () => {
    expect(computeTotal([])).toBe(0);
  });

  it('accepte un total égal au plafond', () => {
    expect(
      computeTotal([
        { quantity: 1, unitPrice: MAX_ORDER_TOTAL - 1 },
        { quantity: 1, unitPrice: 1 },
      ]),
    ).toBe(MAX_ORDER_TOTAL);
  });

  it('refuse un total supérieur au plafond (PO-01)', () => {
    const items = [
      { quantity: 1, unitPrice: MAX_ORDER_TOTAL },
      { quantity: 1, unitPrice: 1 },
    ];

    expect(() => computeTotal(items)).toThrow(OrderTotalExceededError);
    expect(() => computeTotal(items)).toThrow(ORDER_TOTAL_EXCEEDED_MESSAGE);
  });

  it.each([
    ['NaN', [{ quantity: Number.NaN, unitPrice: 1 }]],
    ['négatif', [{ quantity: -1, unitPrice: 1_000 }]],
    ['décimal', [{ quantity: 1, unitPrice: 15.5 }]],
    ['infini', [{ quantity: Number.POSITIVE_INFINITY, unitPrice: 1 }]],
  ])('refuse un total %s', (_case, items) => {
    expect(() => computeTotal(items)).toThrow(
      new RangeError(INVALID_TOTAL_MESSAGE),
    );
  });

  it('reste exact au maximum théorique du parsing (30 × 999 × 10 000 000)', () => {
    const items = Array.from({ length: 30 }, () => ({
      quantity: 999,
      unitPrice: 10_000_000,
    }));

    expect(() => computeTotal(items)).toThrow(OrderTotalExceededError);
  });
});
