import type { Response } from 'supertest';

export { readPdf } from '../../src/receipts/testing/read-pdf.js';

/** Analyseur supertest : corps brut en `Buffer` (réponses PDF). */
export function binaryParser(
  res: Response,
  callback: (error: Error | null, body: Buffer) => void,
): void {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
}
