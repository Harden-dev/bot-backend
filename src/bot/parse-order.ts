import {
  computeTotal,
  foldCase,
  normalizeCiPhone,
  OrderTotalExceededError,
} from '../common/index.js';
import { ORDER_LIMITS } from '../orders/index.js';
import {
  FIELD_NAMES,
  MAX_ORDER_MESSAGE_LENGTH,
  PARSE_ERRORS,
} from './messages.js';

export interface ParsedItem {
  label: string;
  quantity: number;
  unitPrice: number;
}

/** Commande lue dans un message vendeur ; `total` calculé par le serveur (R-P7). */
export interface ParsedOrder {
  customerName: string;
  /** 10 chiffres (R-P3). */
  customerPhone: string;
  deliveryLocation: string;
  items: ParsedItem[];
  total: number;
}

export type ParseOrderResult =
  { ok: true; order: ParsedOrder } | { ok: false; errors: string[] };

type OrderField = keyof typeof FIELD_NAMES;

/** Variantes de libellés (R-P1), sous forme pliée (minuscules, sans accents). */
const FIELD_LABELS: Record<OrderField, readonly string[]> = {
  name: ['nom', 'client'],
  phone: ['telephone', 'tel', 'numero', 'contact'],
  location: ['lieu de livraison', 'lieu', 'adresse', 'livraison'],
  items: ['articles', 'article', 'commande', 'produits'],
};

/**
 * Libellé en début de ligne suivi de `:`, `=` ou `-` (PO-07) ; le plus long
 * est essayé en premier (`lieu de livraison` avant `livraison`).
 */
const LABEL_PATTERNS = Object.entries(FIELD_LABELS)
  .flatMap(([field, labels]) =>
    labels.map((label) => ({ field: field as OrderField, label })),
  )
  .sort((a, b) => b.label.length - a.label.length)
  .map(({ field, label }) => ({
    field,
    pattern: new RegExp(
      String.raw`^\s*${label.replaceAll(' ', String.raw`\s+`)}\s*[:=-]`,
    ),
  }));

const LINE_BREAK = /\r\n|\r|\n/;
const WHITESPACE_RUN = /\s+/g;
/** `;`, retour à la ligne (déjà découpé) ou virgule hors motif `\d,\d{3}` (PO-07). */
const ITEM_SEPARATOR = /;|(?<!\d),|,(?!\d{3})/;
const THOUSANDS_COMMA = /\d,\d{3}/;
/** Puce en tête d'article : tirets, points, ou `*` suivi d'un espace. */
const BULLET = /^(?:[-–—•·▪]|\*(?=\s))\s*/;
const LEADING_QUANTITY = /^(\d+)\s+(.*)$/s;
/** Quantité collée au signe (`robe 2x15000`), précédée d'un espace ou du début. */
const GLUED_QUANTITY = /(?:^|\s)(\d+)$/;
/** Nombre seul, dernier mot avant le signe (`robes 2 x 15000`). */
const SPACED_TRAILING_NUMBER = /(?:^|\s)\d+\s+$/;
const MAX_QUANTITY_DIGITS = 3;
const MULTIPLY_SIGNS = new Set(['x', 'X', '×', '*']);
const BEFORE_SIGN = /[\s\d]/;
/** Prix (R-P5) : `15000`, `15 000`, `15.000`, suffixe `F`, `FCFA`, `F CFA` ou `CFA`. */
const PRICE = /^(\d{1,3}(?:[\s.]\d{3})+|\d+)\s*(?:f(?:\s*cfa)?|cfa)?$/i;
const PRICE_GROUP_SEPARATORS = /[\s.]/g;
/** Prix en fin d'article sans signe (`box 5000`), retiré du libellé cité. */
const TRAILING_PRICE =
  /\s+(?:\d{1,3}(?:[\s.]\d{3})+|\d+)\s*(?:f(?:\s*cfa)?|cfa)?$/i;

function compact(text: string): string {
  return text.replace(WHITESPACE_RUN, ' ').trim();
}

/** Index dans `line` de la fin du préfixe dont la forme pliée fait `foldedLength` caractères. */
function originalIndex(line: string, foldedLength: number): number {
  let folded = 0;
  let index = 0;
  for (const char of line) {
    const width = foldCase(char).length;
    if (folded >= foldedLength && width > 0) {
      break;
    }
    folded += width;
    index += char.length;
  }
  return index;
}

/** Libellé reconnu en début de ligne et valeur qui le suit sur la ligne. */
function matchLabel(line: string): { field: OrderField; value: string } | null {
  const folded = foldCase(line);
  for (const { field, pattern } of LABEL_PATTERNS) {
    const match = pattern.exec(folded);
    if (match) {
      return { field, value: line.slice(originalIndex(line, match[0].length)) };
    }
  }
  return null;
}

/**
 * Découpe le message en champs : la valeur d'un libellé va jusqu'au libellé
 * suivant (R-P2). Texte avant le premier libellé et libellés en double :
 * erreurs (PO-07).
 */
function splitFields(
  lines: readonly string[],
  errors: string[],
): Map<OrderField, string[]> {
  const fields = new Map<OrderField, string[]>();
  const duplicates = new Set<OrderField>();
  let current: string[] | null = null;
  for (const line of lines) {
    const label = matchLabel(line);
    if (label) {
      current = [label.value];
      if (fields.has(label.field)) {
        duplicates.add(label.field);
      } else {
        fields.set(label.field, current);
      }
    } else if (current) {
      current.push(line);
    } else if (line.trim() !== '') {
      errors.push(PARSE_ERRORS.unrecognizedLine(compact(line)));
    }
  }
  for (const field of duplicates) {
    errors.push(PARSE_ERRORS.duplicateField(FIELD_NAMES[field]));
  }
  return fields;
}

function textValue(lines: readonly string[] | undefined): string {
  return compact((lines ?? []).join(' '));
}

function parseText(
  value: string,
  maxLength: number,
  messages: { missing: string; tooLong: string },
  errors: string[],
): string {
  if (value === '') {
    errors.push(messages.missing);
  } else if (value.length > maxLength) {
    errors.push(messages.tooLong);
  }
  return value;
}

function parsePhone(value: string, errors: string[]): string {
  if (value === '') {
    errors.push(PARSE_ERRORS.missingPhone);
    return '';
  }
  const phone = normalizeCiPhone(value);
  if (phone === null) {
    errors.push(PARSE_ERRORS.invalidPhone);
    return '';
  }
  return phone;
}

/** Prix valide (R-P5) jusqu'à la fin du texte, ou `null`. */
function parsePrice(text: string): number | null {
  const match = PRICE.exec(text.trim());
  return match ? Number(match[1].replace(PRICE_GROUP_SEPARATORS, '')) : null;
}

function isSignAt(text: string, index: number): boolean {
  return (
    MULTIPLY_SIGNS.has(text[index]) &&
    (index === 0 || BEFORE_SIGN.test(text[index - 1]))
  );
}

/** `label` : texte brut avant le signe ; `hasSign` faux si aucun signe trouvé. */
type PriceSplit =
  | { label: string; hasSign: true; price: number }
  | { label: string; hasSign: boolean; error: 'missing' | 'invalid' };

/**
 * Dernier signe `x`, `X`, `×` ou `*` précédé d'un espace, d'un chiffre ou du
 * début, et suivi d'un prix valide jusqu'à la fin de l'article (PO-07).
 */
function splitPrice(text: string): PriceSplit {
  let lastSign = -1;
  for (let index = text.length - 1; index >= 0; index -= 1) {
    if (!isSignAt(text, index)) {
      continue;
    }
    if (lastSign === -1) {
      lastSign = index;
    }
    const price = parsePrice(text.slice(index + 1));
    if (price !== null) {
      return { label: text.slice(0, index), hasSign: true, price };
    }
  }
  if (lastSign === -1) {
    return {
      label: text.replace(TRAILING_PRICE, ''),
      hasSign: false,
      error: 'missing',
    };
  }
  const afterSign = text.slice(lastSign + 1).trim();
  return {
    label: text.slice(0, lastSign),
    hasSign: true,
    error: afterSign === '' ? 'missing' : 'invalid',
  };
}

/** Entier de quantité ; plus de 3 chiffres : `NaN` (hors limites). */
function toQuantity(digits: string): number {
  return digits.length > MAX_QUANTITY_DIGITS ? Number.NaN : Number(digits);
}

/** Quantité en tête : entier suivi d'un espace (PO-07), `null` si absente. */
function splitLeadingQuantity(article: string): {
  quantity: number | null;
  rest: string;
} {
  const match = LEADING_QUANTITY.exec(article);
  return match
    ? { quantity: toQuantity(match[1]), rest: match[2] }
    : { quantity: null, rest: article };
}

/**
 * Quantité finale et libellé (décision client du 2026-11-13) : en tête, ou
 * collée au signe (`robe 2x15000`) ; les deux à la fois : erreur ; sans
 * quantité en tête, un nombre seul juste avant le signe (`robes 2 x 15000`) :
 * erreur plutôt que de deviner.
 */
function readQuantity(
  article: string,
  leading: number | null,
  split: PriceSplit,
  errors: string[],
): { quantity: number; label: string } {
  const glued = split.hasSign ? GLUED_QUANTITY.exec(split.label) : null;
  if (glued) {
    const label = compact(split.label.slice(0, glued.index));
    if (leading !== null) {
      errors.push(
        PARSE_ERRORS.duplicateQuantity(label === '' ? article : label),
      );
      return { quantity: leading, label };
    }
    return { quantity: toQuantity(glued[1]), label };
  }
  if (
    leading === null &&
    split.hasSign &&
    SPACED_TRAILING_NUMBER.test(split.label)
  ) {
    errors.push(PARSE_ERRORS.quantityFirst(article));
  }
  return { quantity: leading ?? 1, label: compact(split.label) };
}

function isInRange(value: number, min: number, max: number): boolean {
  return value >= min && value <= max;
}

/** Un article `[quantité] libellé x prix` (R-P4) ; erreurs ajoutées à `errors`. */
function parseItem(article: string, errors: string[]): ParsedItem | null {
  if (THOUSANDS_COMMA.test(article)) {
    errors.push(PARSE_ERRORS.commaInPrice(article));
    return null;
  }
  const before = errors.length;
  const leading = splitLeadingQuantity(article);
  const split = splitPrice(leading.rest);
  const { quantity, label } = readQuantity(
    article,
    leading.quantity,
    split,
    errors,
  );
  const shown = label === '' ? article : label;
  if (
    !isInRange(quantity, ORDER_LIMITS.minQuantity, ORDER_LIMITS.maxQuantity)
  ) {
    errors.push(PARSE_ERRORS.quantityOutOfRange(shown));
  }
  if (label === '') {
    errors.push(PARSE_ERRORS.missingLabel(article));
  } else if (label.length > ORDER_LIMITS.itemLabelMaxLength) {
    errors.push(PARSE_ERRORS.labelTooLong(label));
  }
  if ('error' in split) {
    errors.push(
      split.error === 'missing'
        ? PARSE_ERRORS.missingPrice(shown)
        : PARSE_ERRORS.invalidPrice(shown),
    );
  } else if (
    !isInRange(
      split.price,
      ORDER_LIMITS.minUnitPrice,
      ORDER_LIMITS.maxUnitPrice,
    )
  ) {
    errors.push(PARSE_ERRORS.priceOutOfRange(shown));
  }
  if (errors.length > before || 'error' in split) {
    return null;
  }
  return { label, quantity, unitPrice: split.price };
}

/** Articles séparés par `,`, `;` ou retour à la ligne, puces retirées (R-P2, R-P4). */
function parseItems(
  lines: readonly string[] | undefined,
  errors: string[],
): ParsedItem[] {
  const articles = (lines ?? [])
    .flatMap((line) => line.split(ITEM_SEPARATOR))
    .map((article) => compact(compact(article).replace(BULLET, '')))
    .filter((article) => article !== '');
  if (articles.length === 0) {
    errors.push(PARSE_ERRORS.missingItems);
    return [];
  }
  if (articles.length > ORDER_LIMITS.maxItems) {
    errors.push(PARSE_ERRORS.tooManyItems(articles.length));
  }
  const items: ParsedItem[] = [];
  for (const article of articles) {
    const item = parseItem(article, errors);
    if (item) {
      items.push(item);
    }
  }
  return items;
}

/** Total des articles valides ; au-delà du plafond PO-01 : erreur. */
function totalOf(items: readonly ParsedItem[], errors: string[]): number {
  try {
    return computeTotal(items);
  } catch (error) {
    if (error instanceof OrderTotalExceededError) {
      errors.push(PARSE_ERRORS.totalExceeded);
      return 0;
    }
    throw error;
  }
}

/**
 * Lit une commande au format du modèle (DAT section 6, R-P1 à R-P8, PO-07).
 * Fonction pure : toutes les erreurs sont renvoyées en une fois, en français.
 */
export function parseOrder(text: string): ParseOrderResult {
  if (text.length > MAX_ORDER_MESSAGE_LENGTH) {
    return { ok: false, errors: [PARSE_ERRORS.messageTooLong] };
  }
  const errors: string[] = [];
  const fields = splitFields(text.normalize('NFC').split(LINE_BREAK), errors);
  const customerName = parseText(
    textValue(fields.get('name')),
    ORDER_LIMITS.customerNameMaxLength,
    { missing: PARSE_ERRORS.missingName, tooLong: PARSE_ERRORS.nameTooLong },
    errors,
  );
  const customerPhone = parsePhone(textValue(fields.get('phone')), errors);
  const deliveryLocation = parseText(
    textValue(fields.get('location')),
    ORDER_LIMITS.deliveryLocationMaxLength,
    {
      missing: PARSE_ERRORS.missingLocation,
      tooLong: PARSE_ERRORS.locationTooLong,
    },
    errors,
  );
  const items = parseItems(fields.get('items'), errors);
  const total = totalOf(items, errors);
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    order: { customerName, customerPhone, deliveryLocation, items, total },
  };
}
