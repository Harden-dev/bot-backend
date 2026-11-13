import { computeTotal, ORDER_TOTAL_EXCEEDED_MESSAGE } from '../common/index.js';
import { ORDER_TEMPLATE, PARSE_ERRORS } from './messages.js';
import { type ParsedOrder, parseOrder } from './parse-order.js';

// computeTotal réel, remplaçable dans un test (erreur autre que le plafond).
vi.mock('../common/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../common/index.js')>();
  return { ...actual, computeTotal: vi.fn(actual.computeTotal) };
});

const TEMPLATE_ORDER: ParsedOrder = {
  customerName: 'Awa Koné',
  customerPhone: '0707070707',
  deliveryLocation: 'Cocody Angré 8e tranche',
  items: [
    { label: 'robes bleues', quantity: 2, unitPrice: 15_000 },
    { label: 'sac noir', quantity: 1, unitPrice: 8_000 },
  ],
  total: 38_000,
};

function message(articles: string, overrides: Record<string, string> = {}) {
  const fields = {
    Nom: 'Awa Koné',
    Téléphone: '0707070707',
    Lieu: 'Cocody',
    Articles: articles,
    ...overrides,
  };
  return Object.entries(fields)
    .map(([label, value]) => `${label}: ${value}`)
    .join('\n');
}

function order(text: string): ParsedOrder {
  const result = parseOrder(text);
  if (!result.ok) {
    throw new Error(`Échec inattendu : ${result.errors.join(' | ')}`);
  }
  return result.order;
}

function errors(text: string): string[] {
  const result = parseOrder(text);
  if (result.ok) {
    throw new Error('Succès inattendu');
  }
  return result.errors;
}

function items(articles: string) {
  return order(message(articles)).items;
}

describe('parseOrder', () => {
  describe('modèle et libellés (R-P1, R-P2)', () => {
    it('lit le modèle complet du DAT et calcule le total', () => {
      expect(order(ORDER_TEMPLATE)).toEqual(TEMPLATE_ORDER);
    });

    it('accepte libellés en majuscules, sans accents et les séparateurs = et -', () => {
      const text = [
        'NOM = Awa Koné',
        'TELEPHONE - 0707070707',
        'LIEU: Cocody Angré 8e tranche',
        'ARTICLES = 2 robes bleues x 15000, 1 sac noir x 8000',
      ].join('\n');
      expect(order(text)).toEqual(TEMPLATE_ORDER);
    });

    it.each([
      ['client', 'tel', 'adresse', 'article'],
      ['Client', 'Numéro', 'Livraison', 'Commande'],
      ['nom', 'contact', 'Lieu de livraison', 'Produits'],
      ['  Nom  ', 'Tél', '  LIEU DE   LIVRAISON ', 'articles'],
    ])(
      'accepte les variantes %s / %s / %s / %s',
      (name, phone, location, list) => {
        const text = [
          `${name}: Awa`,
          `${phone} : 0707070707`,
          `${location} : Cocody`,
          `${list}: sac x 8000`,
        ].join('\n');
        expect(order(text)).toMatchObject({
          customerName: 'Awa',
          customerPhone: '0707070707',
          deliveryLocation: 'Cocody',
          items: [{ label: 'sac', quantity: 1, unitPrice: 8_000 }],
        });
      },
    );

    it('accepte les libellés dans n’importe quel ordre, lignes vides et fins de ligne Windows', () => {
      const text =
        '\r\nArticles: sac x 8000\r\n\r\nLieu: Cocody\r\nNom: Awa\r\nTel: 0707070707\r\n';
      expect(order(text)).toMatchObject({
        customerName: 'Awa',
        deliveryLocation: 'Cocody',
      });
    });

    it('prolonge une valeur sur les lignes suivantes jusqu’au libellé suivant', () => {
      const text = [
        'Nom: Awa',
        'Koné',
        'Tel: 0707070707',
        'Lieu: Cocody Angré',
        '  8e tranche, près de la pharmacie',
        'Articles: sac x 8000',
      ].join('\n');
      expect(order(text)).toMatchObject({
        customerName: 'Awa Koné',
        deliveryLocation: 'Cocody Angré 8e tranche, près de la pharmacie',
      });
    });

    it('ne reconnaît un libellé qu’en début de ligne (le plus long gagne)', () => {
      const text = [
        'Nom: Awa',
        'Tel: 0707070707',
        'Lieu de livraison: Cocody, livraison: avant midi',
        'Articles: sac x 8000',
      ].join('\n');
      expect(order(text).deliveryLocation).toBe(
        'Cocody, livraison: avant midi',
      );
    });

    it('ne confond pas un mot commençant par un libellé (nombre, telex)', () => {
      expect(errors(['nombre: 3', 'telex: 1'].join('\n')).slice(0, 2)).toEqual([
        PARSE_ERRORS.unrecognizedLine('nombre: 3'),
        PARSE_ERRORS.unrecognizedLine('telex: 1'),
      ]);
    });

    it('accepte des accents décomposés (NFD) dans les libellés et les valeurs', () => {
      const text = message('sac x 8000', {
        Téléphone: '0707070707',
      }).normalize('NFD');
      expect(order(text).customerName).toBe('Awa Koné');
    });
  });

  describe('téléphone (R-P3)', () => {
    it.each([
      ['+225 07 07 07 07 07'],
      ['00225 07.07.07.07.07'],
      ['225-0707070707'],
      ['07 07 07 07 07'],
      ['07 07 07 07 07'],
      ['+225 07 07 07 07 07'],
    ])('normalise « %s » en 10 chiffres', (phone) => {
      expect(
        order(message('sac x 8000', { Téléphone: phone })).customerPhone,
      ).toBe('0707070707');
    });

    it.each([
      ['070707070'],
      ['07070707070'],
      ['07 07 AB 07 07'],
      ['+33 6 12 34 56 78'],
    ])('refuse « %s »', (phone) => {
      expect(errors(message('sac x 8000', { Téléphone: phone }))).toEqual([
        PARSE_ERRORS.invalidPhone,
      ]);
    });
  });

  describe('articles (R-P4, R-P5, PO-07)', () => {
    it('sépare les articles par virgule, point-virgule et retour à la ligne, avec ou sans puce', () => {
      const text = [
        'Nom: Awa',
        'Tel: 0707070707',
        'Lieu: Cocody',
        'Articles:',
        '- 2 robes x 15000',
        '• 1 sac x 8000; 3 foulards x 1000',
        'chaussures x 12000, ceinture x 2500,',
      ].join('\n');
      expect(order(text).items.map((item) => item.label)).toEqual([
        'robes',
        'sac',
        'foulards',
        'chaussures',
        'ceinture',
      ]);
    });

    it('prend 1 comme quantité absente', () => {
      expect(items('sac noir x 8000')).toEqual([
        { label: 'sac noir', quantity: 1, unitPrice: 8_000 },
      ]);
    });

    it.each([
      ['15000', 15_000],
      ['15 000', 15_000],
      ['15.000', 15_000],
      ['15000F', 15_000],
      ['15000 FCFA', 15_000],
      ['15 000 f cfa', 15_000],
      ['15000 CFA', 15_000],
      ['1.500.000', 1_500_000],
      ['1 500 000 F', 1_500_000],
    ])('accepte le prix « %s »', (price, expected) => {
      expect(items(`robe x ${price}`)[0].unitPrice).toBe(expected);
    });

    it.each([['x'], ['X'], ['×'], ['*']])('accepte le signe « %s »', (sign) => {
      expect(items(`2 robes ${sign} 15000`)).toEqual([
        { label: 'robes', quantity: 2, unitPrice: 15_000 },
      ]);
    });

    it('retient le dernier signe suivi d’un prix valide (robe XL, taxi)', () => {
      expect(items('robe XL x 15000; taxi x 5000')).toEqual([
        { label: 'robe XL', quantity: 1, unitPrice: 15_000 },
        { label: 'taxi', quantity: 1, unitPrice: 5_000 },
      ]);
    });

    it.each([['x'], ['×'], ['*']])(
      'lit la quantité collée au signe « %s » (robe 2x15000, décision client)',
      (sign) => {
        const parsed = order(message(`robe 2${sign}15000`));
        expect(parsed.items).toEqual([
          { label: 'robe', quantity: 2, unitPrice: 15_000 },
        ]);
        expect(parsed.total).toBe(30_000);
      },
    );

    it('lit aussi la quantité collée en fin de libellé (pagne taille 42x15000)', () => {
      expect(items('pagne taille 42x15000')).toEqual([
        { label: 'pagne taille', quantity: 42, unitPrice: 15_000 },
      ]);
    });

    it('refuse une quantité en tête et une quantité collée', () => {
      expect(errors(message('3 robes 2x15000'))).toEqual([
        PARSE_ERRORS.duplicateQuantity('robes'),
      ]);
      expect(errors(message('3 2x15000'))).toEqual([
        PARSE_ERRORS.duplicateQuantity('3 2x15000'),
        PARSE_ERRORS.missingLabel('3 2x15000'),
      ]);
      expect(PARSE_ERRORS.duplicateQuantity('robes')).toBe(
        'Quantité en double pour : robes',
      );
    });

    it('refuse un nombre seul juste avant le signe sans quantité en tête', () => {
      expect(errors(message('robes 2 x 15000'))).toEqual([
        PARSE_ERRORS.quantityFirst('robes 2 x 15000'),
      ]);
      expect(PARSE_ERRORS.quantityFirst('robes 2 x 15000')).toBe(
        'Quantité à écrire en tête pour « robes 2 x 15000 », par exemple : 2 robes x 15000',
      );
    });

    it('garde un nombre qui n’est pas le dernier mot avant le signe, ou avec une quantité en tête', () => {
      expect(
        items('robe taille 42 bleue x 15000; 2 robes taille 42 x 1000'),
      ).toEqual([
        { label: 'robe taille 42 bleue', quantity: 1, unitPrice: 15_000 },
        { label: 'robes taille 42', quantity: 2, unitPrice: 1_000 },
      ]);
    });

    it('signale une quantité collée sans libellé ou hors limites', () => {
      expect(errors(message('2x15000; robe 1000x5; robe 0x5'))).toEqual([
        PARSE_ERRORS.missingLabel('2x15000'),
        PARSE_ERRORS.quantityOutOfRange('robe'),
        PARSE_ERRORS.quantityOutOfRange('robe'),
      ]);
    });

    it.each([['-'], ['–'], ['—'], ['•'], ['·'], ['▪'], ['*']])(
      'retire la puce « %s » avant la quantité',
      (bullet) => {
        expect(
          items(`
${bullet} 2 robes x 15000`),
        ).toEqual([{ label: 'robes', quantity: 2, unitPrice: 15_000 }]);
      },
    );

    it('accepte des espaces insécables (U+00A0, U+202F) dans un prix', () => {
      expect(items('robe x 15 000; sac x 1 500 000')).toEqual([
        { label: 'robe', quantity: 1, unitPrice: 15_000 },
        { label: 'sac', quantity: 1, unitPrice: 1_500_000 },
      ]);
    });

    it('garde un emoji dans un libellé', () => {
      expect(items('2 robes 👗 rouges x 15000')).toEqual([
        { label: 'robes 👗 rouges', quantity: 2, unitPrice: 15_000 },
      ]);
    });

    it('lit toujours un entier de 1 à 3 chiffres en tête comme la quantité', () => {
      expect(items('3 pièces wax x 5000')).toEqual([
        { label: 'pièces wax', quantity: 3, unitPrice: 5_000 },
      ]);
    });

    it('compacte les espaces du libellé', () => {
      expect(items('2   robes    bleues   x 15000')[0].label).toBe(
        'robes bleues',
      );
    });
  });

  describe('erreurs (R-P6, R-P8)', () => {
    it('signale un article sans prix', () => {
      expect(errors(message('1 sac noir'))).toEqual([
        PARSE_ERRORS.missingPrice('sac noir'),
      ]);
      expect(PARSE_ERRORS.missingPrice('sac noir')).toBe(
        'Prix manquant pour : sac noir',
      );
    });

    it('signale un prix sans signe (box 5000) et un signe sans prix', () => {
      expect(errors(message('box 5000, robe x'))).toEqual([
        PARSE_ERRORS.missingPrice('box'),
        PARSE_ERRORS.missingPrice('robe'),
      ]);
    });

    it('cite le libellé avant le dernier signe quand le prix est invalide (robe XL)', () => {
      expect(errors(message('robe XL x 15.5'))).toEqual([
        PARSE_ERRORS.invalidPrice('robe XL'),
      ]);
    });

    it.each([['15.5'], ['15.50'], ['15 00'], ['quinze mille']])(
      'refuse le prix « %s »',
      (price) => {
        expect(errors(message(`robe x ${price}`))).toEqual([
          PARSE_ERRORS.invalidPrice('robe'),
        ]);
      },
    );

    it('refuse une virgule dans un prix, sans la prendre pour un séparateur', () => {
      expect(errors(message('2 robes x 15,000, 1 sac x 8000'))).toEqual([
        PARSE_ERRORS.commaInPrice('2 robes x 15,000'),
      ]);
      expect(PARSE_ERRORS.commaInPrice('2 robes x 15,000')).toBe(
        'Prix invalide dans « 2 robes x 15,000 » : écrivez 15000 ou 15 000 (sans virgule)',
      );
    });

    it.each([
      ['0 robe x 1000', 'robe'],
      ['1000 perles x 50', 'perles'],
    ])('refuse la quantité de « %s »', (article, label) => {
      expect(errors(message(article))).toEqual([
        PARSE_ERRORS.quantityOutOfRange(label),
      ]);
    });

    it('accepte les quantités et prix aux bornes', () => {
      expect(items('999 perles x 1; bague x 10 000 000')).toEqual([
        { label: 'perles', quantity: 999, unitPrice: 1 },
        { label: 'bague', quantity: 1, unitPrice: 10_000_000 },
      ]);
    });

    it.each([['0'], ['10 000 001']])('refuse le prix %s', (price) => {
      expect(errors(message(`robe x ${price}`))).toEqual([
        PARSE_ERRORS.priceOutOfRange('robe'),
      ]);
    });

    it('signale un article sans libellé', () => {
      expect(errors(message('2 x 15000'))).toEqual([
        PARSE_ERRORS.missingLabel('2 x 15000'),
      ]);
    });

    it('limite le libellé à 190 caractères', () => {
      const label = 'a'.repeat(191);
      expect(items(`${'a'.repeat(190)} x 1000`)[0].label).toHaveLength(190);
      expect(errors(message(`${label} x 1000`))).toEqual([
        PARSE_ERRORS.labelTooLong(label),
      ]);
    });

    it('accepte 30 articles et en refuse 31', () => {
      const list = (count: number) =>
        Array.from({ length: count }, (_, i) => `article-${i} x 100`).join(
          ', ',
        );
      expect(items(list(30))).toHaveLength(30);
      expect(errors(message(list(31)))).toEqual([
        PARSE_ERRORS.tooManyItems(31),
      ]);
    });

    it('refuse un total au-delà du plafond PO-01', () => {
      const list = Array.from(
        { length: 5 },
        (_, i) => `999 bijoux ${i} x 1 000 000`,
      ).join(', ');
      expect(errors(message(list))).toEqual([PARSE_ERRORS.totalExceeded]);
      expect(PARSE_ERRORS.totalExceeded).toBe(
        ORDER_TOTAL_EXCEEDED_MESSAGE.slice(0, -1),
      );
    });

    it('laisse remonter une erreur de calcul autre que le plafond', () => {
      vi.mocked(computeTotal).mockImplementationOnce(() => {
        throw new RangeError('Total invalide');
      });
      expect(() => parseOrder(message('sac x 8000'))).toThrow(RangeError);
    });

    it('signale chaque champ manquant ou vide', () => {
      expect(errors('Nom:\nArticles:')).toEqual([
        PARSE_ERRORS.missingName,
        PARSE_ERRORS.missingPhone,
        PARSE_ERRORS.missingLocation,
        PARSE_ERRORS.missingItems,
      ]);
    });

    it('limite le nom à 120 et le lieu à 255 caractères', () => {
      const text = message('sac x 8000', {
        Nom: 'n'.repeat(121),
        Lieu: 'l'.repeat(256),
      });
      expect(errors(text)).toEqual([
        PARSE_ERRORS.nameTooLong,
        PARSE_ERRORS.locationTooLong,
      ]);
      expect(
        order(
          message('sac x 8000', {
            Nom: 'n'.repeat(120),
            Lieu: 'l'.repeat(255),
          }),
        ),
      ).toBeDefined();
    });

    it('signale un champ en double et une ligne avant le premier libellé', () => {
      const text = `Bonjour\n${message('sac x 8000')}\nTel: 0505050505`;
      expect(errors(text)).toEqual([
        PARSE_ERRORS.unrecognizedLine('Bonjour'),
        PARSE_ERRORS.duplicateField('Téléphone'),
      ]);
    });

    it('ne prend pas en charge un message sur une seule ligne', () => {
      expect(errors('Nom: Awa Tel: 0707070707 Lieu: Cocody')).toEqual([
        PARSE_ERRORS.missingPhone,
        PARSE_ERRORS.missingLocation,
        PARSE_ERRORS.missingItems,
      ]);
    });

    it('liste toutes les erreurs en une fois (téléphone à 9 chiffres et article sans prix)', () => {
      const text = message('2 robes x 15000, 1 sac noir', {
        Téléphone: '070707070',
      });
      expect(errors(text)).toEqual([
        PARSE_ERRORS.invalidPhone,
        PARSE_ERRORS.missingPrice('sac noir'),
      ]);
      expect(PARSE_ERRORS.invalidPhone).toBe(
        'Téléphone invalide : 10 chiffres attendus',
      );
    });

    it('accepte 2 000 caractères et refuse au-delà', () => {
      const base = message('sac x 8000', { Lieu: '' });
      const padded = (length: number) =>
        base.replace('Lieu: ', `Lieu: ${'l'.repeat(length - base.length)}`);
      expect(padded(2_000)).toHaveLength(2_000);
      expect(errors(padded(2_000))).toEqual([PARSE_ERRORS.locationTooLong]);
      expect(errors(padded(2_001))).toEqual([PARSE_ERRORS.messageTooLong]);
    });

    it('n’écrit aucun message d’erreur avec un point final', () => {
      const samples = [
        PARSE_ERRORS.messageTooLong,
        PARSE_ERRORS.tooManyItems(31),
        PARSE_ERRORS.commaInPrice('a'),
        PARSE_ERRORS.totalExceeded,
        PARSE_ERRORS.quantityFirst('robes 2 x 15000'),
        PARSE_ERRORS.invalidPhone,
      ];
      for (const sample of samples) {
        expect(sample).not.toMatch(/\.$/);
      }
    });

    it('cite un extrait tronqué pour une ligne très longue', () => {
      const [error] = errors(`${'z'.repeat(100)}\n${message('sac x 8000')}`);
      expect(error).toBe(PARSE_ERRORS.unrecognizedLine('z'.repeat(100)));
      expect(error).toContain('…');
      expect(error.length).toBeLessThan(100);
    });
  });
});
