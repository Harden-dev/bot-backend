const VISIBLE_PREFIX = 2;
const VISIBLE_SUFFIX = 4;
const MASK_CHAR = '*';

/** Masque un numéro pour les logs : `0707070707` -> `07****0707`. */
export function maskPhone(phone: string): string {
  if (phone.length <= VISIBLE_PREFIX + VISIBLE_SUFFIX) {
    return MASK_CHAR.repeat(phone.length);
  }
  const hidden = phone.length - VISIBLE_PREFIX - VISIBLE_SUFFIX;
  return (
    phone.slice(0, VISIBLE_PREFIX) +
    MASK_CHAR.repeat(hidden) +
    phone.slice(-VISIBLE_SUFFIX)
  );
}
