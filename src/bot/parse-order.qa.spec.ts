import { ORDER_TEMPLATE } from './messages.js';
import { parseOrder } from './parse-order.js';

/**
 * Cas limites ajoutés par la QA (QA-001) : montants nuls, négatifs ou non
 * entiers, et formats d'entrée invalides propres au domaine (XOF entiers,
 * téléphones ivoiriens à 10 chiffres).
 */
function message(articles: string, phone = '0707070707'): string {
  return [
    'Nom: Awa Koné',
    `Téléphone: ${phone}`,
    'Lieu: Cocody',
    `Articles: ${articles}`,
  ].join('\n');
}

describe('parseOrder : cas limites QA', () => {
  it.each([
    ['prix nul', 'robe x 0'],
    ['prix nul avec suffixe', 'robe x 0F'],
    ['prix négatif', 'robe x -5000'],
    ['prix décimal', 'robe x 15.5'],
    ['prix avec virgule décimale', 'robe x 15,5'],
    ['quantité nulle', '0 robe x 5000'],
    ['quantité 1000', '1000 robes x 5'],
    ['prix au-delà de 10 000 000', 'robe x 10 000 001'],
    ['prix non numérique', 'robe x abc'],
  ])('refuse un article au %s, sans commande', (_label, articles) => {
    const result = parseOrder(message(articles));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.length).toBeGreaterThan(0);
  });

  it.each([
    ['9 chiffres', '070707070'],
    ['11 chiffres', '07070707070'],
    ['lettres', '07O7O7O7O7'],
    ['indicatif étranger', '+33 6 12 34 56 78'],
  ])('refuse un téléphone client à %s', (_label, phone) => {
    const result = parseOrder(message('robe x 5000', phone));

    expect(result).toEqual({
      ok: false,
      errors: ['Téléphone invalide : 10 chiffres attendus'],
    });
  });

  it('calcule le total en entiers XOF (somme quantité × prix unitaire)', () => {
    const result = parseOrder(
      message('3 pagnes x 2 500; bague x 1; 429 perles x 10 000 000'),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.order.total).toBe(3 * 2_500 + 1 + 429 * 10_000_000);
      expect(Number.isSafeInteger(result.order.total)).toBe(true);
    }
  });

  it('lit « -2 robe » comme une puce suivie de la quantité 2 (jamais une quantité négative)', () => {
    const result = parseOrder(message('-2 robe x 5000'));

    expect(result).toMatchObject({
      ok: true,
      order: {
        items: [{ label: 'robe', quantity: 2, unitPrice: 5_000 }],
        total: 10_000,
      },
    });
  });

  it('le modèle envoyé au vendeur est lui-même une commande valide de 38 000 F', () => {
    const result = parseOrder(ORDER_TEMPLATE);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.order.total).toBe(38_000);
  });
});
