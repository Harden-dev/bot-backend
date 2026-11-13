import { createHmac } from 'node:crypto';

/** En-tête `X-Hub-Signature-256` attendu par le webhook pour `body`. */
export function signMetaBody(body: string | Buffer, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}
