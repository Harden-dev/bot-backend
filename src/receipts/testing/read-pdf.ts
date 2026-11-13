import { extractText, getDocumentProxy } from 'unpdf';

/**
 * Lecture de PDF pour les tests uniquement (dépendance de dev `unpdf`) ;
 * dossier `testing/` exclu du build (`tsconfig.build.json`).
 */
export interface PdfPage {
  width: number;
  height: number;
  text: string;
  /** Abscisse maximale atteinte par un fragment de texte (pt). */
  textRight: number;
}

export interface PdfSummary {
  /** Cinq premiers octets (`%PDF-`). */
  header: string;
  pages: PdfPage[];
}

/** Ouvre un PDF (pdf.js via `unpdf`) : en-tête, dimensions et texte de chaque page. */
export async function readPdf(content: Uint8Array): Promise<PdfSummary> {
  const header = Buffer.from(content.subarray(0, 5)).toString('latin1');
  // Copie : pdf.js peut détacher le tampon reçu.
  const pdf = await getDocumentProxy(new Uint8Array(content));
  try {
    const { text } = await extractText(pdf, { mergePages: false });
    const pages: PdfPage[] = [];
    for (let index = 1; index <= pdf.numPages; index += 1) {
      const page = await pdf.getPage(index);
      const [left, bottom, right, top] = page.view;
      const { items } = await page.getTextContent();
      const textRight = Math.max(
        0,
        ...items.map((item) =>
          'transform' in item ? item.transform[4] + item.width : 0,
        ),
      );
      pages.push({
        width: right - left,
        height: top - bottom,
        text: text[index - 1],
        textRight,
      });
    }
    return { header, pages };
  } finally {
    await pdf.loadingTask.destroy();
  }
}
