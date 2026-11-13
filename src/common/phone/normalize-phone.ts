/** Indicatif de la Côte d'Ivoire. */
export const CI_COUNTRY_CODE = '225';

const LOCAL_NUMBER_LENGTH = 10;
const SEPARATORS = /[\s.-]/g;
const LOCAL_NUMBER = /^\d{10}$/;
// Préfixes internationaux retirés uniquement s'ils précèdent exactement
// 10 chiffres (une saisie locale commençant par « 225 » reste locale).
const INTERNATIONAL_PREFIXES = [
  `+${CI_COUNTRY_CODE}`,
  `00${CI_COUNTRY_CODE}`,
  CI_COUNTRY_CODE,
];

/**
 * Téléphone client (R-P3) : retire espaces, points et tirets, puis le préfixe
 * `+225`, `00225` ou `225` ; renvoie les 10 chiffres locaux, ou `null` si le
 * résultat n'a pas exactement 10 chiffres.
 */
export function normalizeCiPhone(input: string): string | null {
  const compact = input.replace(SEPARATORS, '');
  const prefix = INTERNATIONAL_PREFIXES.find(
    (candidate) =>
      compact.startsWith(candidate) &&
      compact.length === candidate.length + LOCAL_NUMBER_LENGTH,
  );
  const local = prefix ? compact.slice(prefix.length) : compact;
  return LOCAL_NUMBER.test(local) ? local : null;
}

/**
 * Numéro WhatsApp d'un vendeur (PO-15) : mêmes saisies acceptées que
 * `normalizeCiPhone`, stocké en E.164 sans `+` (`225` + 10 chiffres), ou
 * `null` pour tout autre numéro (étranger, longueur incorrecte).
 */
export function normalizeVendorNumber(input: string): string | null {
  const local = normalizeCiPhone(input);
  return local === null ? null : CI_COUNTRY_CODE + local;
}
