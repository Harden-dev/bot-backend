import { formatThousands, formatXof } from './format-xof.js';

describe('formatXof', () => {
  it.each([
    [0, '0 F'],
    [800, '800 F'],
    [8_000, '8 000 F'],
    [38_000, '38 000 F'],
    [10_000_000, '10 000 000 F'],
    [4_294_967_295, '4 294 967 295 F'],
  ])('formate %d en « %s »', (amount, expected) => {
    expect(formatXof(amount)).toBe(expected);
  });
});

describe('formatThousands', () => {
  it('groupe les chiffres par milliers sans unité', () => {
    expect(formatThousands(2_000)).toBe('2 000');
    expect(formatThousands(999)).toBe('999');
  });
});
