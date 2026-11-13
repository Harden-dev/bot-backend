import { BadRequestException } from '@nestjs/common';
import { INVALID_PERIOD_MESSAGE, toDayRange } from './day-range.js';

describe('toDayRange', () => {
  it('renvoie undefined sans borne', () => {
    expect(toDayRange()).toBeUndefined();
  });

  it('inclut les jours entiers UTC', () => {
    expect(toDayRange('2026-11-01', '2026-11-10')).toEqual({
      gte: new Date('2026-11-01T00:00:00.000Z'),
      lte: new Date('2026-11-10T23:59:59.999Z'),
    });
  });

  it('accepte une seule borne et un jour unique', () => {
    expect(toDayRange('2026-11-01')).toEqual({
      gte: new Date('2026-11-01T00:00:00.000Z'),
      lte: undefined,
    });
    expect(toDayRange(undefined, '2026-11-10')).toEqual({
      gte: undefined,
      lte: new Date('2026-11-10T23:59:59.999Z'),
    });
    expect(toDayRange('2026-11-10', '2026-11-10')).toBeDefined();
  });

  it('refuse from > to en 400 (PO-20)', () => {
    expect(() => toDayRange('2026-11-11', '2026-11-10')).toThrow(
      new BadRequestException(INVALID_PERIOD_MESSAGE),
    );
  });
});
