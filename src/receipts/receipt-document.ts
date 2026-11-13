import type {
  Content,
  Margins,
  PageSize,
  TableCell,
  TDocumentDefinitions,
} from 'pdfmake/interfaces.js';
import { formatXof } from '../common/index.js';
import type { ReceiptFormat } from '../config/index.js';
import type { OrderDetailDto } from '../orders/index.js';

/** Largeur du ticket de caisse : 80 mm en points PDF (1 pt = 1/72 pouce). */
const TICKET80_WIDTH_PT = 226.77;

interface ReceiptLayout {
  pageSize: PageSize;
  pageMargins: Margins;
  fontSize: number;
  companyFontSize: number;
  referenceFontSize: number;
  totalFontSize: number;
}

/**
 * Mise en page par format (DAT section 8). Ticket : hauteur automatique,
 * chaque reçu a la hauteur de son contenu (hypothèse à valider par un essai
 * d'impression).
 */
const LAYOUTS: Record<ReceiptFormat, ReceiptLayout> = {
  A5: {
    pageSize: 'A5',
    pageMargins: 36,
    fontSize: 10,
    companyFontSize: 14,
    referenceFontSize: 30,
    totalFontSize: 14,
  },
  TICKET80: {
    pageSize: { width: TICKET80_WIDTH_PT, height: 'auto' },
    pageMargins: [10, 10, 10, 14],
    fontSize: 8,
    companyFontSize: 11,
    referenceFontSize: 18,
    totalFontSize: 11,
  },
};

const ABIDJAN_TIME_ZONE = 'Africa/Abidjan';
const DATE_FORMAT = new Intl.DateTimeFormat('fr-FR', {
  timeZone: ABIDJAN_TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});
const TIME_FORMAT = new Intl.DateTimeFormat('fr-FR', {
  timeZone: ABIDJAN_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
});

/**
 * Mot sans espace de plus de 20 caractères : pdfmake ne le coupe pas et il
 * déborderait de sa colonne. Le texte qui en contient un est coupé n'importe
 * où (`break-all`) ; les autres textes restent coupés aux espaces.
 */
const LONG_WORD = /\S{21,}/;

function breakable(text: string): { text: string; wordBreak?: 'break-all' } {
  return LONG_WORD.test(text) ? { text, wordBreak: 'break-all' } : { text };
}

export interface ReceiptOptions {
  companyName: string;
  format: ReceiptFormat;
}

/** « Créée le 13/11/2026 à 14:05 » (heure d'Abidjan = UTC). */
export function formatCreatedAt(date: Date): string {
  return `Créée le ${DATE_FORMAT.format(date)} à ${TIME_FORMAT.format(date)}`;
}

function infoRow(label: string, value: string): TableCell[] {
  return [{ text: `${label} :`, bold: true }, breakable(value)];
}

function itemsTable(order: OrderDetailDto): Content {
  const amount = (value: number): TableCell => ({
    text: formatXof(value),
    alignment: 'right',
    noWrap: true,
  });
  const header: TableCell[] = [
    { text: 'Article', bold: true },
    { text: 'Qté', bold: true, alignment: 'right' },
    { text: 'P.U.', bold: true, alignment: 'right' },
    { text: 'Sous-total', bold: true, alignment: 'right' },
  ];
  const rows = order.items.map((item): TableCell[] => [
    breakable(item.label),
    { text: String(item.quantity), alignment: 'right' },
    amount(item.unitPrice),
    amount(item.quantity * item.unitPrice),
  ]);
  return {
    table: {
      headerRows: 1,
      widths: ['*', 'auto', 'auto', 'auto'],
      body: [header, ...rows],
    },
    layout: 'lightHorizontalLines',
    margin: [0, 8, 0, 4],
  };
}

function receiptContent(
  order: OrderDetailDto,
  layout: ReceiptLayout,
  companyName: string,
): Content[] {
  const content: Content[] = [
    {
      text: companyName,
      bold: true,
      fontSize: layout.companyFontSize,
      alignment: 'center',
    },
    {
      text: order.reference,
      bold: true,
      fontSize: layout.referenceFontSize,
      alignment: 'center',
      margin: [0, 6, 0, 2],
    },
    {
      text: formatCreatedAt(order.createdAt),
      alignment: 'center',
      margin: [0, 0, 0, 8],
    },
    {
      table: {
        widths: ['auto', '*'],
        body: [
          infoRow('Vendeur', order.vendor.name),
          infoRow('Client', order.customerName),
          infoRow('Téléphone', order.customerPhone),
          infoRow('Lieu de livraison', order.deliveryLocation),
        ],
      },
      layout: 'noBorders',
    },
    itemsTable(order),
    {
      text: `Total : ${formatXof(order.totalAmount)}`,
      bold: true,
      fontSize: layout.totalFontSize,
      alignment: 'right',
    },
  ];
  if (order.notes) {
    content.push({
      text: [{ text: 'Notes : ', bold: true }, order.notes],
      ...(LONG_WORD.test(order.notes) ? { wordBreak: 'break-all' } : {}),
      margin: [0, 8, 0, 0],
    });
  }
  return content;
}

/**
 * Document pdfmake : un reçu par page, dans l'ordre reçu (US-REC-01/02).
 * Contenu du DAT section 8.
 */
export function buildReceiptDocument(
  orders: readonly OrderDetailDto[],
  { companyName, format }: ReceiptOptions,
): TDocumentDefinitions {
  const layout = LAYOUTS[format];
  return {
    // Copie : pdfmake remplace en place la hauteur `auto` de l'objet reçu.
    pageSize:
      typeof layout.pageSize === 'string'
        ? layout.pageSize
        : { ...layout.pageSize },
    pageMargins: layout.pageMargins,
    info: { title: orders.map((order) => order.reference).join(', ') },
    defaultStyle: { font: 'Roboto', fontSize: layout.fontSize },
    content: orders.map((order, index): Content => ({
      stack: receiptContent(order, layout, companyName),
      pageBreak: index === 0 ? undefined : 'before',
    })),
  };
}
