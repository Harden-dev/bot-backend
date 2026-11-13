import { BadRequestException } from '@nestjs/common';
import { INVALID_PERIOD_MESSAGE } from '../common/index.js';
import {
  addDays,
  listDays,
  MAX_STATS_PERIOD_DAYS,
  PERIOD_TOO_LONG_MESSAGE,
  resolveStatsPeriod,
} from './stats-period.js';

const NOW = new Date('2026-11-13T23:30:00.000Z');

describe('resolveStatsPeriod (PO-20)', () => {
  it("prend par défaut les 30 derniers jours, aujourd'hui (UTC) inclus", () => {
    expect(resolveStatsPeriod(undefined, undefined, NOW)).toEqual({
      from: '2026-10-15',
      to: '2026-11-13',
      range: {
        gte: new Date('2026-10-15T00:00:00.000Z'),
        lte: new Date('2026-11-13T23:59:59.999Z'),
      },
    });
  });

  it('complète une seule borne', () => {
    expect(resolveStatsPeriod('2026-11-01', undefined, NOW)).toMatchObject({
      from: '2026-11-01',
      to: '2026-11-13',
    });
    expect(resolveStatsPeriod(undefined, '2026-03-01', NOW)).toMatchObject({
      from: '2026-01-31',
      to: '2026-03-01',
    });
  });

  it('accepte un jour unique et refuse from > to en 400', () => {
    expect(resolveStatsPeriod('2026-11-10', '2026-11-10', NOW).range).toEqual({
      gte: new Date('2026-11-10T00:00:00.000Z'),
      lte: new Date('2026-11-10T23:59:59.999Z'),
    });
    expect(() => resolveStatsPeriod('2026-11-11', '2026-11-10', NOW)).toThrow(
      new BadRequestException(INVALID_PERIOD_MESSAGE),
    );
  });
});

describe('durée maximale (MAX_STATS_PERIOD_DAYS)', () => {
  it('accepte 366 jours, bornes incluses, y compris en année bissextile', () => {
    expect(MAX_STATS_PERIOD_DAYS).toBe(366);
    expect(
      listDays(resolveStatsPeriod('2026-01-01', '2027-01-01', NOW)),
    ).toHaveLength(366);
    expect(
      listDays(resolveStatsPeriod('2028-01-01', '2028-12-31', NOW)),
    ).toHaveLength(366);
  });

  it('refuse 367 jours en 400, avec une seule borne aussi', () => {
    const tooLong = new BadRequestException(PERIOD_TOO_LONG_MESSAGE);

    expect(PERIOD_TOO_LONG_MESSAGE).toBe(
      'La période ne peut pas dépasser 366 jours',
    );
    expect(() => resolveStatsPeriod('2026-01-01', '2027-01-02', NOW)).toThrow(
      tooLong,
    );
    expect(() => resolveStatsPeriod('2025-11-12', undefined, NOW)).toThrow(
      tooLong,
    );
    expect(resolveStatsPeriod('2025-11-13', undefined, NOW).from).toBe(
      '2025-11-13',
    );
  });

  it('signale from > to avant la durée', () => {
    expect(() => resolveStatsPeriod('2027-01-02', '2026-01-01', NOW)).toThrow(
      new BadRequestException(INVALID_PERIOD_MESSAGE),
    );
  });
});

describe('listDays', () => {
  it('liste chaque jour, bornes incluses, à travers les mois et années bissextiles', () => {
    expect(
      listDays(resolveStatsPeriod('2028-02-27', '2028-03-01', NOW)),
    ).toEqual(['2028-02-27', '2028-02-28', '2028-02-29', '2028-03-01']);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});
