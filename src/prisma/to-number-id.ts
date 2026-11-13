/**
 * Convertit un identifiant `BIGINT UNSIGNED` (exposé en `bigint` par Prisma)
 * en `number` pour les objets de réponse. Aucun patch global de `BigInt`.
 */
export function toNumberId(id: bigint): number {
  if (id > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError('Identifiant hors de la plage des entiers sûrs');
  }
  return Number(id);
}
