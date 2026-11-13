import { BadRequestException } from '@nestjs/common';
import { type DayRange, toDayRange } from '../common/index.js';

/** Période par défaut : les 30 derniers jours, aujourd'hui inclus (PO-20 c). */
export const DEFAULT_PERIOD_DAYS = 30;

/**
 * Durée maximale d'une période, bornes incluses (ajout par rapport au DAT,
 * N-61) : borne le calcul et la taille de la réponse de `by-day`.
 */
export const MAX_STATS_PERIOD_DAYS = 366;
export const PERIOD_TOO_LONG_MESSAGE = `La période ne peut pas dépasser ${MAX_STATS_PERIOD_DAYS} jours`;

const DAY_MS = 86_400_000;

export interface StatsPeriod {
  /** Premier jour inclus, `AAAA-MM-JJ` (UTC). */
  from: string;
  /** Dernier jour inclus, `AAAA-MM-JJ` (UTC). */
  to: string;
  /** Bornes de `created_at` : `from` 00:00:00.000, `to` 23:59:59.999 (UTC). */
  range: Required<DayRange>;
}

export function toUtcDayString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(day: string, days: number): string {
  return toUtcDayString(
    new Date(Date.parse(`${day}T00:00:00.000Z`) + days * DAY_MS),
  );
}

/**
 * Période des statistiques (PO-20) : `to` absent = aujourd'hui (UTC), `from`
 * absent = 29 jours avant `to` ; `from > to` : `400` (message partagé) ;
 * plus de `MAX_STATS_PERIOD_DAYS` jours : `400`.
 */
export function resolveStatsPeriod(
  from: string | undefined,
  to: string | undefined,
  now: Date = new Date(),
): StatsPeriod {
  const end = to ?? toUtcDayString(now);
  const start = from ?? addDays(end, 1 - DEFAULT_PERIOD_DAYS);
  // Les deux bornes sont fournies : `toDayRange` les renvoie toutes les deux.
  const range = toDayRange(start, end) as Required<DayRange>;
  if (start < addDays(end, 1 - MAX_STATS_PERIOD_DAYS)) {
    throw new BadRequestException(PERIOD_TOO_LONG_MESSAGE);
  }
  return { from: start, to: end, range };
}

/** Jours de la période, du premier au dernier inclus. */
export function listDays({ from, to }: StatsPeriod): string[] {
  const days: string[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) {
    days.push(day);
  }
  return days;
}
