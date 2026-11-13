/**
 * Catalogue de tous les textes envoyés aux vendeurs (PO-08). Les textes
 * imposés par le DAT sont repris mot pour mot ; les autres (aide, Modifier,
 * `mes commandes`, erreurs de parsing hors exemples du DAT) sont à relire
 * par le client.
 */
import {
  formatThousands,
  formatXof,
  ORDER_TOTAL_EXCEEDED_MESSAGE,
} from '../common/index.js';
import type { OrderStatus } from '../generated/prisma/client.js';
import { ORDER_LIMITS } from '../orders/index.js';
import { MAX_TEXT_BODY_LENGTH } from '../whatsapp/client/index.js';

/** Longueur maximale d'un message de commande (R-P6). */
export const MAX_ORDER_MESSAGE_LENGTH = 2_000;

/** Nombre de commandes listées par `mes commandes`. */
export const RECENT_ORDERS_COUNT = 5;

/** Longueur maximale (en caractères affichés) d'un extrait cité dans une erreur. */
const MAX_QUOTE_LENGTH = 60;
const ELLIPSIS = '…';
const GRAPHEMES = new Intl.Segmenter('fr', { granularity: 'grapheme' });
const FINAL_PERIOD = /\.$/;

/** Modèle à remplir (DAT section 6), renvoyé seul pour être copié. */
export const ORDER_TEMPLATE = [
  'Nom: Awa Koné',
  'Téléphone: 0707070707',
  'Lieu: Cocody Angré 8e tranche',
  'Articles: 2 robes bleues x 15000, 1 sac noir x 8000',
].join('\n');

/** Numéro absent de la liste blanche ou vendeur désactivé (DAT). */
export const UNAUTHORIZED_MESSAGE =
  "Ce numéro n'est pas autorisé à passer commande.";

/** Message non texte (DAT, PO-13). */
export const UNSUPPORTED_MESSAGE =
  'Seuls les messages texte sont acceptés. Tapez *modele* pour recevoir le modèle.';

/** Envoyé quand le traitement d'un message échoue (PO-24). */
export const PROCESSING_ERROR_MESSAGE =
  'Une erreur est survenue, veuillez renvoyer votre message.';

/** Brouillon expiré, annulé, inconnu, d'un autre vendeur ou bouton mal formé (DAT, PO-10, PO-11). */
export const DRAFT_NO_LONGER_VALID_MESSAGE =
  "Ce récapitulatif n'est plus valide, renvoyez la commande.";

/** Annulation d'un brouillon, par bouton ou par `annuler` (DAT). */
export const ORDER_CANCELLED_MESSAGE = 'Commande annulée.';

/** Récapitulatif de plus de 1 024 caractères : aucun brouillon (PO-06). */
export const RECAP_TOO_LONG_MESSAGE =
  "Cette commande est trop longue pour être récapitulée en un seul message. Scindez-la en deux messages (moins d'articles par message) et renvoyez-les séparément.";

/** `annuler` sans brouillon en attente (PO-09). */
export const NO_PENDING_DRAFT_MESSAGE = 'Aucune commande en attente à annuler.';

/** `mes commandes` sans commande (PO-09). */
export const NO_ORDERS_MESSAGE = "Vous n'avez encore aucune commande.";

/** Bouton Modifier : brouillon annulé, rappel du modèle (DAT, texte PO-08). */
export const MODIFY_MESSAGE = `Récapitulatif annulé. Renvoyez la commande corrigée en suivant ce modèle :\n\n${ORDER_TEMPLATE}`;

/** Titres des boutons du récapitulatif (≤ 20 caractères). */
export const RECAP_BUTTON_TITLES = {
  valider: 'Valider',
  modifier: 'Modifier',
  annuler: 'Annuler',
} as const;

/** Libellés du récapitulatif (DAT section 6). */
export const RECAP_TEXT = {
  title: 'Récapitulatif de la commande',
  customer: 'Client : ',
  phone: 'Tél : ',
  location: 'Lieu : ',
  items: 'Articles :',
  bullet: '• ',
  total: 'Total : ',
  currency: ' CFA',
} as const;

/** Libellés des statuts dans `mes commandes` (PO-08). */
export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  non_traitee: 'Non traitée',
  validee: 'Validée',
  prete: 'Prête',
  livree: 'Livrée',
  echec: 'Échec',
  annulee: 'Annulée',
};

/** Validation réussie, ou double clic sur Valider (DAT). */
export function orderConfirmedMessage(reference: string): string {
  return `Commande ${reference} enregistrée.`;
}

/** Modifier ou Annuler sur un brouillon déjà confirmé (PO-11). */
export function orderAlreadyRecordedMessage(reference: string): string {
  return `La commande ${reference} est déjà enregistrée. Pour la modifier ou l'annuler, contactez l'administration.`;
}

/** Réponse à `aide` (texte PO-08, distinction Valider / « Validée » PO-27). */
export function helpMessage(draftTtlMinutes: number): string {
  return [
    'Pour passer une commande :',
    '1. Tapez *modele* pour recevoir le modèle.',
    '2. Remplissez-le (client, téléphone, lieu, articles avec quantité et prix unitaire) et envoyez-le.',
    `3. Vérifiez le récapitulatif, puis appuyez sur Valider, Modifier ou Annuler dans les ${draftTtlMinutes} minutes.`,
    '',
    'Le bouton Valider enregistre la commande et vous donne sa référence (CMD-...).',
    "La commande est alors « Non traitée » ; c'est l'administration qui la passe ensuite à « Validée », « Prête » puis « Livrée ». Une commande enregistrée ne s'annule pas ici : contactez l'administration.",
    '',
    'Autres commandes :',
    `*mes commandes* : vos ${RECENT_ORDERS_COUNT} dernières commandes`,
    '*annuler* : annule votre dernier récapitulatif en attente',
    '*aide* : ce message',
  ].join('\n');
}

export interface OrderSummaryLine {
  reference: string;
  status: OrderStatus;
  totalAmount: number;
}

/** Réponse à `mes commandes` (texte PO-08). */
export function myOrdersMessage(orders: readonly OrderSummaryLine[]): string {
  if (orders.length === 0) {
    return NO_ORDERS_MESSAGE;
  }
  const lines = orders.map(
    (order) =>
      `• ${order.reference} — ${ORDER_STATUS_LABELS[order.status]} — ${formatXof(order.totalAmount)}`,
  );
  return ['Vos dernières commandes :', ...lines].join('\n');
}

/**
 * Extrait du message cité dans une erreur, tronqué à 60 caractères affichés
 * (graphèmes : un emoji n'est jamais coupé).
 */
export function quote(text: string): string {
  const characters = Array.from(GRAPHEMES.segment(text), (s) => s.segment);
  return characters.length <= MAX_QUOTE_LENGTH
    ? text
    : `${characters.slice(0, MAX_QUOTE_LENGTH - 1).join('')}${ELLIPSIS}`;
}

/** Noms des champs du modèle, pour les erreurs. */
export const FIELD_NAMES = {
  name: 'Nom',
  phone: 'Téléphone',
  location: 'Lieu',
  items: 'Articles',
} as const;

/** Erreurs de `parseOrder` (R-P8, PO-07), sans point final. */
export const PARSE_ERRORS = {
  messageTooLong: `Message trop long : ${formatThousands(MAX_ORDER_MESSAGE_LENGTH)} caractères au maximum, scindez la commande en plusieurs messages`,
  unrecognizedLine: (line: string) => `Ligne non reconnue : « ${quote(line)} »`,
  duplicateField: (field: string) => `Champ en double : ${field}`,
  missingName: 'Nom du client manquant',
  nameTooLong: `Nom trop long : ${ORDER_LIMITS.customerNameMaxLength} caractères au maximum`,
  missingPhone: 'Téléphone manquant',
  invalidPhone: 'Téléphone invalide : 10 chiffres attendus',
  missingLocation: 'Lieu de livraison manquant',
  locationTooLong: `Lieu trop long : ${ORDER_LIMITS.deliveryLocationMaxLength} caractères au maximum`,
  missingItems: 'Articles manquants',
  tooManyItems: (count: number) =>
    `Trop d'articles : ${ORDER_LIMITS.maxItems} au maximum (${count} reçus), scindez la commande`,
  missingPrice: (label: string) => `Prix manquant pour : ${quote(label)}`,
  invalidPrice: (label: string) =>
    `Prix invalide pour : ${quote(label)} (écrivez par exemple 15000 ou 15 000)`,
  commaInPrice: (article: string) =>
    `Prix invalide dans « ${quote(article)} » : écrivez 15000 ou 15 000 (sans virgule)`,
  priceOutOfRange: (label: string) =>
    `Prix hors limites pour : ${quote(label)} (${formatThousands(ORDER_LIMITS.minUnitPrice)} à ${formatXof(ORDER_LIMITS.maxUnitPrice)})`,
  duplicateQuantity: (label: string) =>
    `Quantité en double pour : ${quote(label)}`,
  quantityFirst: (article: string) =>
    `Quantité à écrire en tête pour « ${quote(article)} », par exemple : 2 robes x 15000`,
  quantityOutOfRange: (label: string) =>
    `Quantité invalide pour : ${quote(label)} (${ORDER_LIMITS.minQuantity} à ${ORDER_LIMITS.maxQuantity})`,
  missingLabel: (article: string) =>
    `Libellé d'article manquant dans « ${quote(article)} »`,
  labelTooLong: (label: string) =>
    `Libellé trop long (${ORDER_LIMITS.itemLabelMaxLength} caractères au maximum) : ${quote(label)}`,
  totalExceeded: ORDER_TOTAL_EXCEEDED_MESSAGE.replace(FINAL_PERIOD, ''),
} as const;

const PARSE_ERRORS_HEADER = "Votre commande n'a pas pu être lue :";
const PARSE_ERRORS_FOOTER = `Corrigez-la et renvoyez-la en suivant ce modèle :\n\n${ORDER_TEMPLATE}`;

function moreErrorsLine(count: number): string {
  return `- … et ${count} autre(s) erreur(s)`;
}

/**
 * Erreurs de parsing suivies du modèle (R-P8). La liste est tronquée si le
 * message dépasserait la limite d'un texte WhatsApp (4 096 caractères).
 */
export function parseErrorsMessage(errors: readonly string[]): string {
  const footer = `\n\n${PARSE_ERRORS_FOOTER}`;
  const lines = [PARSE_ERRORS_HEADER];
  let length = PARSE_ERRORS_HEADER.length + footer.length;
  for (const [index, error] of errors.entries()) {
    const line = `- ${error}`;
    const remaining = errors.length - index - 1;
    const reserve = remaining > 0 ? moreErrorsLine(remaining).length + 1 : 0;
    if (length + line.length + 1 + reserve > MAX_TEXT_BODY_LENGTH) {
      lines.push(moreErrorsLine(errors.length - index));
      break;
    }
    lines.push(line);
    length += line.length + 1;
  }
  return lines.join('\n') + footer;
}
