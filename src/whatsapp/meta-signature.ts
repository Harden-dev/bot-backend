import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const SIGNATURE_PREFIX = 'sha256=';

/**
 * Vérifie l'en-tête `X-Hub-Signature-256` de Meta : `sha256=` + HMAC-SHA256
 * hexadécimal des octets bruts reçus, clé `META_APP_SECRET`. Comparaison en
 * temps constant ; une longueur différente (ou un en-tête/corps absent) est
 * refusée sans appeler `timingSafeEqual`, qui lèverait une exception.
 */
export function verifyMetaSignature(
  rawBody: Buffer | undefined,
  header: string | undefined,
  secret: string,
): boolean {
  if (rawBody === undefined || header === undefined) {
    return false;
  }
  const expected = Buffer.from(
    SIGNATURE_PREFIX +
      createHmac('sha256', secret).update(rawBody).digest('hex'),
  );
  const received = Buffer.from(header);
  return (
    received.length === expected.length && timingSafeEqual(received, expected)
  );
}

/**
 * Compare deux chaînes en temps constant, sans révéler leur longueur : les
 * deux valeurs sont d'abord réduites à un condensat SHA-256 de taille fixe.
 */
export function safeEqualStrings(a: string, b: string): boolean {
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(a), digest(b));
}
