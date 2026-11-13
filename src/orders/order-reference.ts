const REFERENCE_PREFIX = 'CMD';
const MIN_SEQUENCE_DIGITS = 3;

/** Jour UTC (= jour d'Abidjan) d'une date, au format `AAAA-MM-JJ`. */
export function toUtcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Référence `CMD-AAAAMMJJ-NNN` ; au-delà de 999, la séquence s'écrit sur
 * 4 chiffres ou plus, sans plafond (PO-23).
 */
export function formatReference(day: string, sequence: number): string {
  const compactDay = day.replaceAll('-', '');
  const paddedSequence = String(sequence).padStart(MIN_SEQUENCE_DIGITS, '0');
  return `${REFERENCE_PREFIX}-${compactDay}-${paddedSequence}`;
}
