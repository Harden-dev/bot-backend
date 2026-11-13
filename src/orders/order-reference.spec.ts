import { formatReference, toUtcDay } from './order-reference.js';

describe('toUtcDay', () => {
  it('renvoie le jour UTC au format AAAA-MM-JJ', () => {
    expect(toUtcDay(new Date('2026-11-10T23:59:59.999Z'))).toBe('2026-11-10');
    expect(toUtcDay(new Date('2026-11-11T00:00:00.000Z'))).toBe('2026-11-11');
  });
});

describe('formatReference', () => {
  it.each([
    [1, 'CMD-20261110-001'],
    [3, 'CMD-20261110-003'],
    [42, 'CMD-20261110-042'],
    [999, 'CMD-20261110-999'],
    [1000, 'CMD-20261110-1000'],
    [12345, 'CMD-20261110-12345'],
  ])('séquence %i → %s (PO-23 au-delà de 999)', (sequence, expected) => {
    expect(formatReference('2026-11-10', sequence)).toBe(expected);
  });
});
