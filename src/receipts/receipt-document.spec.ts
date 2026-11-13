import type { ContentStack } from 'pdfmake/interfaces.js';
import type { OrderDetailDto } from '../orders/index.js';
import { buildReceiptDocument, formatCreatedAt } from './receipt-document.js';

const CREATED_AT = new Date('2026-11-10T14:05:00.000Z');

function order(overrides: Partial<OrderDetailDto> = {}): OrderDetailDto {
  return {
    id: 7,
    reference: 'CMD-20261110-003',
    status: 'non_traitee',
    customerName: 'Aya Kouassi',
    customerPhone: '0707070707',
    deliveryLocation: 'Cocody Angré',
    totalAmount: 38_000,
    vendor: { id: 2, name: 'Boutique Awa' },
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    notes: null,
    items: [
      { id: 1, label: 'Robe wax', quantity: 2, unitPrice: 15_000 },
      { id: 2, label: 'Sac', quantity: 1, unitPrice: 8_000 },
    ],
    history: [],
    ...overrides,
  };
}

const OPTIONS = { companyName: 'Ma Boutique', format: 'A5' } as const;
const TEXT_KEYS = new Set(['text', 'stack', 'table', 'body']);

/** Textes du reçu, dans l'ordre, pour vérifier le contenu sans rendu. */
function texts(node: unknown): string[] {
  if (typeof node === 'string') {
    return [node];
  }
  if (Array.isArray(node)) {
    return node.flatMap(texts);
  }
  if (node && typeof node === 'object') {
    return Object.entries(node).flatMap(([key, value]) =>
      TEXT_KEYS.has(key) ? texts(value) : [],
    );
  }
  return [];
}

describe('formatCreatedAt', () => {
  it("affiche la date et l'heure d'Abidjan (UTC)", () => {
    expect(formatCreatedAt(CREATED_AT)).toBe('Créée le 10/11/2026 à 14:05');
  });
});

describe('buildReceiptDocument', () => {
  it('contient tout le contenu du DAT section 8', () => {
    const doc = buildReceiptDocument([order({ notes: 'Fragile' })], OPTIONS);

    expect(texts(doc.content)).toEqual([
      'Ma Boutique',
      'CMD-20261110-003',
      'Créée le 10/11/2026 à 14:05',
      'Vendeur :',
      'Boutique Awa',
      'Client :',
      'Aya Kouassi',
      'Téléphone :',
      '0707070707',
      'Lieu de livraison :',
      'Cocody Angré',
      'Article',
      'Qté',
      'P.U.',
      'Sous-total',
      'Robe wax',
      '2',
      '15 000 F',
      '30 000 F',
      'Sac',
      '1',
      '8 000 F',
      '8 000 F',
      'Total : 38 000 F',
      'Notes : ',
      'Fragile',
    ]);
  });

  it('ne coupe en break-all que les textes contenant un mot de plus de 20 caractères', () => {
    const word = 'A'.repeat(21);
    const json = (doc: unknown) => JSON.stringify(doc);

    expect(
      json(buildReceiptDocument([order({ notes: 'Fragile' })], OPTIONS)),
    ).not.toContain('break-all');
    expect(
      json(
        buildReceiptDocument(
          [order({ notes: 'B'.repeat(20), customerName: 'C'.repeat(20) })],
          OPTIONS,
        ),
      ),
    ).not.toContain('break-all');
    const doc = buildReceiptDocument(
      [
        order({
          notes: `Code ${word}`,
          deliveryLocation: word,
          items: [{ id: 1, label: word, quantity: 1, unitPrice: 1 }],
        }),
      ],
      OPTIONS,
    );
    expect(json(doc).match(/break-all/g)).toHaveLength(3);
  });

  it('omet les notes absentes', () => {
    const doc = buildReceiptDocument([order()], OPTIONS);

    expect(texts(doc.content).some((text) => text.startsWith('Notes'))).toBe(
      false,
    );
  });

  it('affiche la référence en gros caractères', () => {
    const [receipt] = buildReceiptDocument([order()], OPTIONS)
      .content as ContentStack[];

    expect(receipt.stack[1]).toMatchObject({
      text: 'CMD-20261110-003',
      bold: true,
      fontSize: 30,
    });
  });

  it("met un reçu par page, dans l'ordre reçu", () => {
    const doc = buildReceiptDocument(
      [order(), order({ reference: 'CMD-20261110-001' })],
      OPTIONS,
    );
    const receipts = doc.content as ContentStack[];

    expect(receipts.map((receipt) => receipt.pageBreak)).toEqual([
      undefined,
      'before',
    ]);
    expect(doc.info?.title).toBe('CMD-20261110-003, CMD-20261110-001');
  });

  it('A5 par défaut, ticket de 80 mm à hauteur automatique', () => {
    expect(buildReceiptDocument([order()], OPTIONS).pageSize).toBe('A5');
    expect(
      buildReceiptDocument([order()], { ...OPTIONS, format: 'TICKET80' })
        .pageSize,
    ).toEqual({ width: 226.77, height: 'auto' });
  });

  it('fournit une taille de page neuve à chaque document (pdfmake la modifie)', () => {
    const options = { ...OPTIONS, format: 'TICKET80' } as const;
    const first = buildReceiptDocument([order()], options).pageSize;
    const second = buildReceiptDocument([order()], options).pageSize;

    expect(first).not.toBe(second);
  });
});
