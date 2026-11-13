import { BadRequestException } from '@nestjs/common';

/** Message de `from > to`, commun à `GET /orders` et aux statistiques (PO-20). */
export const INVALID_PERIOD_MESSAGE =
  'La date de début (from) doit être antérieure ou égale à la date de fin (to)';

export interface DayRange {
  gte?: Date;
  lte?: Date;
}

/**
 * Bornes incluses en jours entiers UTC (`AAAA-MM-JJ` déjà validés) :
 * `from` à 00:00:00.000, `to` à 23:59:59.999 (PO-20, PO-21). `undefined` si
 * aucune borne ; `400` si `from > to`.
 */
export function toDayRange(from?: string, to?: string): DayRange | undefined {
  if (from === undefined && to === undefined) {
    return undefined;
  }
  // Le format AAAA-MM-JJ se compare dans l'ordre lexicographique.
  if (from !== undefined && to !== undefined && from > to) {
    throw new BadRequestException(INVALID_PERIOD_MESSAGE);
  }
  return {
    gte: from === undefined ? undefined : new Date(`${from}T00:00:00.000Z`),
    lte: to === undefined ? undefined : new Date(`${to}T23:59:59.999Z`),
  };
}
