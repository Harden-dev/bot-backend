import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { readPdf } from './testing/read-pdf.js';
import type { ReceiptFormat } from '../config/index.js';
import { type OrderDetailDto, OrdersService } from '../orders/index.js';
import {
  batchReceiptsFilename,
  isAllowedFontPath,
  ReceiptsService,
} from './receipts.service.js';

const CREATED_AT = new Date('2026-11-10T14:05:00.000Z');
const A5 = { width: 419.53, height: 595.28 };
const TICKET_WIDTH = 226.77;
const NOTES = 'Appeler avant — portail bleu • code 2×3, ça é è à';

function order(id: number, reference: string, itemCount = 1): OrderDetailDto {
  return {
    id,
    reference,
    status: 'livree',
    customerName: 'Aya Kouassi',
    customerPhone: '0707070707',
    deliveryLocation: 'Cocody Angré',
    totalAmount: 15_000 * itemCount,
    vendor: { id: 2, name: 'Boutique Awa' },
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    notes: NOTES,
    items: Array.from({ length: itemCount }, (_, index) => ({
      id: index + 1,
      label: `Robe wax ${index + 1}`,
      quantity: 1,
      unitPrice: 15_000,
    })),
    history: [],
  };
}

describe('ReceiptsService', () => {
  const orders = { findOne: vi.fn(), findDetails: vi.fn() };

  async function createService(format: ReceiptFormat) {
    const config = {
      get: vi.fn((key: string) =>
        key === 'RECEIPT_FORMAT' ? format : 'Société Générale de Colis',
      ),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        ReceiptsService,
        { provide: OrdersService, useValue: orders },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();
    return moduleRef.get(ReceiptsService);
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('format A5', () => {
    // Premier rendu pdfmake et première ouverture pdf.js du fichier : démarrage
    // à froid, parfois plus de 5 s sous charge (QA-A1).
    it(
      'génère un reçu PDF A5 nommé par la référence, au texte extractible',
      { timeout: 20_000 },
      async () => {
        orders.findOne.mockResolvedValue(order(7, 'CMD-20261110-003'));
        const service = await createService('A5');

        const receipt = await service.generateOne(7n);
        const pdf = await readPdf(receipt.content);

        expect(orders.findOne).toHaveBeenCalledWith(7n);
        expect(receipt.filename).toBe('CMD-20261110-003.pdf');
        expect(pdf.header).toBe('%PDF-');
        expect(pdf.pages).toHaveLength(1);
        expect(pdf.pages[0]).toMatchObject(A5);
        for (const expected of [
          'Société Générale de Colis',
          'CMD-20261110-003',
          'Créée le 10/11/2026 à 14:05',
          'Boutique Awa',
          'Cocody Angré',
          'Total : 15 000 F',
          NOTES,
        ]) {
          expect(pdf.pages[0].text).toContain(expected);
        }
      },
    );

    it("propage le 404 d'une commande inconnue", async () => {
      orders.findOne.mockRejectedValue(new NotFoundException());
      const service = await createService('A5');

      await expect(service.generateOne(99n)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('format TICKET80', () => {
    it('génère un ticket de 80 mm dont la hauteur suit le contenu', async () => {
      const service = await createService('TICKET80');
      orders.findOne.mockResolvedValueOnce(order(1, 'CMD-20261110-001', 1));
      orders.findOne.mockResolvedValueOnce(order(2, 'CMD-20261110-002', 20));

      const short = await readPdf((await service.generateOne(1n)).content);
      const long = await readPdf((await service.generateOne(2n)).content);

      expect(short.pages).toHaveLength(1);
      expect(long.pages).toHaveLength(1);
      expect(short.pages[0].width).toBeCloseTo(TICKET_WIDTH, 1);
      expect(long.pages[0].height).toBeGreaterThan(short.pages[0].height);
      expect(long.pages[0].text).toContain('CMD-20261110-002');
      expect(long.pages[0].text).toContain(NOTES);
    });
  });

  describe('mot de 190 caractères sans espace', () => {
    // Marge droite des deux formats : A5 36 pt, ticket 10 pt.
    it.each<[ReceiptFormat, number]>([
      ['TICKET80', 10],
      ['A5', 36],
    ])(
      'coupe le libellé et la note sans dépasser la marge (%s)',
      async (format, rightMargin) => {
        const word = 'Robe'.repeat(47) + 'XY';
        const long = order(1, 'CMD-20261110-001');
        long.items[0].label = word;
        long.notes = word;
        orders.findOne.mockResolvedValue(long);
        const service = await createService(format);

        const pdf = await readPdf((await service.generateOne(1n)).content);

        expect(word).toHaveLength(190);
        expect(pdf.pages).toHaveLength(1);
        expect(pdf.pages[0].textRight).toBeLessThanOrEqual(
          pdf.pages[0].width - rightMargin + 0.5,
        );
        expect(pdf.pages[0].text.replaceAll(/\s/g, '')).toContain(
          `Notes:${word}`,
        );
      },
    );
  });

  describe('generateBatch (PO-19)', () => {
    it.each<ReceiptFormat>(['A5', 'TICKET80'])(
      "dédoublonne, garde l'ordre reçu et met un reçu par page (%s)",
      async (format) => {
        orders.findDetails.mockResolvedValue([
          order(3, 'CMD-20261110-003'),
          order(1, 'CMD-20261110-001'),
        ]);
        const service = await createService(format);

        const receipt = await service.generateBatch([3, 1, 3]);
        const pdf = await readPdf(receipt.content);

        expect(orders.findDetails).toHaveBeenCalledWith([3n, 1n]);
        expect(receipt.filename).toBe(batchReceiptsFilename());
        expect(pdf.header).toBe('%PDF-');
        expect(pdf.pages).toHaveLength(2);
        expect(pdf.pages[0].text).toContain('CMD-20261110-003');
        expect(pdf.pages[1].text).toContain('CMD-20261110-001');
      },
    );
  });
});

describe('isAllowedFontPath (accès local de pdfmake)', () => {
  const regular = createRequire(import.meta.url).resolve(
    'pdfmake/fonts/Roboto/Roboto-Regular.ttf',
  );
  const fontDirectory = dirname(regular);

  it('autorise exactement les 4 fichiers de police', () => {
    for (const file of [
      'Roboto-Regular.ttf',
      'Roboto-Medium.ttf',
      'Roboto-Italic.ttf',
      'Roboto-MediumItalic.ttf',
    ]) {
      expect(isAllowedFontPath(join(fontDirectory, file))).toBe(true);
    }
    // Chemin non normalisé qui désigne bien une police.
    expect(
      isAllowedFontPath(`${fontDirectory}/../Roboto/Roboto-Regular.ttf`),
    ).toBe(true);
  });

  it('refuse tout le reste', () => {
    for (const path of [
      fontDirectory,
      join(fontDirectory, 'autre.ttf'),
      `${fontDirectory}/../Roboto.js`,
      `${fontDirectory}/../../../../package.json`,
      `${fontDirectory}X/Roboto-Regular.ttf`,
      join(`${fontDirectory}X`, 'Roboto-Regular.ttf'),
      'Roboto-Regular.ttf',
      '/etc/passwd',
    ]) {
      expect(isAllowedFontPath(path)).toBe(false);
    }
  });
});

describe('batchReceiptsFilename', () => {
  it('date le lot du jour UTC', () => {
    expect(batchReceiptsFilename(new Date('2026-11-13T23:59:59.999Z'))).toBe(
      'recus-20261113.pdf',
    );
    expect(batchReceiptsFilename(new Date('2026-11-14T00:00:00.000Z'))).toBe(
      'recus-20261114.pdf',
    );
  });
});
