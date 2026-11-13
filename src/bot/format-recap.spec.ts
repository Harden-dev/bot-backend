import { fitsInRecap, formatRecap, MAX_RECAP_LENGTH } from './format-recap.js';
import type { ParsedOrder } from './parse-order.js';

const ORDER: ParsedOrder = {
  customerName: 'Awa Koné',
  customerPhone: '0707070707',
  deliveryLocation: 'Cocody Angré 8e tranche',
  items: [
    { label: 'robes bleues', quantity: 2, unitPrice: 15_000 },
    { label: 'sac noir', quantity: 1, unitPrice: 8_000 },
  ],
  total: 38_000,
};

describe('formatRecap', () => {
  it('respecte le format exact du DAT (sous-total seulement si quantité > 1, PO-05)', () => {
    expect(formatRecap(ORDER)).toBe(
      [
        'Récapitulatif de la commande',
        'Client : Awa Koné',
        'Tél : 0707070707',
        'Lieu : Cocody Angré 8e tranche',
        'Articles :',
        '• 2 × robes bleues — 15 000 F = 30 000 F',
        '• 1 × sac noir — 8 000 F',
        'Total : 38 000 F CFA',
      ].join('\n'),
    );
  });
});

describe('fitsInRecap', () => {
  it('accepte 1 024 caractères et refuse au-delà (PO-06)', () => {
    expect(MAX_RECAP_LENGTH).toBe(1_024);
    expect(fitsInRecap('a'.repeat(1_024))).toBe(true);
    expect(fitsInRecap('a'.repeat(1_025))).toBe(false);
  });
});
