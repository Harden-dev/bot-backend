import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import pdfmake from 'pdfmake';
import type { Env } from '../config/index.js';
import { type OrderDetailDto, OrdersService } from '../orders/index.js';
import {
  buildReceiptDocument,
  type ReceiptOptions,
} from './receipt-document.js';

/** Polices Roboto livrées avec pdfmake (glyphes `× — •` et accents vérifiés, N-55). */
const requireFromHere = createRequire(import.meta.url);
const FONT_FILES = {
  normal: requireFromHere.resolve('pdfmake/fonts/Roboto/Roboto-Regular.ttf'),
  bold: requireFromHere.resolve('pdfmake/fonts/Roboto/Roboto-Medium.ttf'),
  italics: requireFromHere.resolve('pdfmake/fonts/Roboto/Roboto-Italic.ttf'),
  bolditalics: requireFromHere.resolve(
    'pdfmake/fonts/Roboto/Roboto-MediumItalic.ttf',
  ),
};
/** Seuls fichiers lisibles par pdfmake : les 4 polices, chemins résolus. */
const ALLOWED_FILES = new Set(
  Object.values(FONT_FILES).map((file) => resolve(file)),
);

/** Politique d'accès local de pdfmake : liste blanche exacte des polices. */
export function isAllowedFontPath(path: string): boolean {
  return ALLOWED_FILES.has(resolve(path));
}

/** Nom du PDF groupé : `recus-AAAAMMJJ.pdf` (jour UTC). */
export function batchReceiptsFilename(now: Date = new Date()): string {
  return `recus-${now.toISOString().slice(0, 10).replaceAll('-', '')}.pdf`;
}

export interface ReceiptFile {
  content: Buffer;
  filename: string;
}

/** Reçus PDF (US-REC-01, US-REC-02) : A5 ou ticket 80 mm selon `RECEIPT_FORMAT`. */
@Injectable()
export class ReceiptsService {
  private readonly options: ReceiptOptions;

  constructor(
    private readonly orders: OrdersService,
    config: ConfigService<Env, true>,
  ) {
    this.options = {
      companyName: config.get('RECEIPT_COMPANY_NAME', { infer: true }),
      format: config.get('RECEIPT_FORMAT', { infer: true }),
    };
    pdfmake.setFonts({ Roboto: FONT_FILES });
    // Aucune ressource distante ; seuls les fichiers de police sont lisibles.
    pdfmake.setUrlAccessPolicy(() => false);
    pdfmake.setLocalAccessPolicy(isAllowedFontPath);
  }

  /** Reçu d'une commande ; `404` si elle n'existe pas. */
  async generateOne(orderId: bigint): Promise<ReceiptFile> {
    const order = await this.orders.findOne(orderId);
    return {
      content: await this.render([order]),
      filename: `${order.reference}.pdf`,
    };
  }

  /**
   * Reçus groupés (PO-19) : doublons retirés, ordre de la liste reçue, tous
   * statuts ; un identifiant inconnu : `404` sans rien générer.
   */
  async generateBatch(orderIds: readonly number[]): Promise<ReceiptFile> {
    const ids = [...new Set(orderIds)].map((id) => BigInt(id));
    const orders = await this.orders.findDetails(ids);
    return {
      content: await this.render(orders),
      filename: batchReceiptsFilename(),
    };
  }

  private render(orders: readonly OrderDetailDto[]): Promise<Buffer> {
    return pdfmake
      .createPdf(buildReceiptDocument(orders, this.options))
      .getBuffer();
  }
}
