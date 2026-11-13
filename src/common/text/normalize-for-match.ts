const COMBINING_MARKS = /\p{M}/gu;
const WHITESPACE_RUN = /\s+/g;

/** Minuscules sans accents (`É` -> `e`), sans compacter les espaces. */
export function foldCase(text: string): string {
  return text.normalize('NFD').replace(COMBINING_MARKS, '').toLowerCase();
}

/**
 * Forme de comparaison d'un texte saisi : minuscules, sans accents, espaces
 * compactés et rognés (`  Mes  Commandes ` -> `mes commandes`).
 */
export function normalizeForMatch(text: string): string {
  return foldCase(text).replace(WHITESPACE_RUN, ' ').trim();
}
