import { toNumberId } from './to-number-id.js';

describe('toNumberId', () => {
  it('convertit un identifiant bigint en number', () => {
    expect(toNumberId(42n)).toBe(42);
  });

  it('accepte le plus grand entier sûr', () => {
    expect(toNumberId(BigInt(Number.MAX_SAFE_INTEGER))).toBe(
      Number.MAX_SAFE_INTEGER,
    );
  });

  it('refuse un identifiant au-delà de 2^53 - 1', () => {
    expect(() => toNumberId(BigInt(Number.MAX_SAFE_INTEGER) + 1n)).toThrow(
      RangeError,
    );
  });

  it('produit une valeur sérialisable en JSON sans patch de BigInt', () => {
    expect(JSON.stringify({ id: toNumberId(7n) })).toBe('{"id":7}');
  });
});
