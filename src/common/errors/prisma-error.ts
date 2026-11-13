export const PRISMA_UNIQUE_VIOLATION = 'P2002';
export const PRISMA_RECORD_NOT_FOUND = 'P2025';

const PRISMA_KNOWN_ERROR_NAME = 'PrismaClientKnownRequestError';
const PRISMA_ERROR_NAME_PREFIX = 'PrismaClient';

interface PrismaError extends Error {
  code?: unknown;
  meta?: { modelName?: unknown };
}

export interface PrismaKnownError extends PrismaError {
  code: string;
}

function isPrismaError(error: unknown): error is PrismaError {
  return (
    error instanceof Error && error.name.startsWith(PRISMA_ERROR_NAME_PREFIX)
  );
}

/** Erreur Prisma connue (`P2xxx`), reconnue par son nom (sans import du client). */
export function isPrismaKnownError(error: unknown): error is PrismaKnownError {
  return (
    isPrismaError(error) &&
    error.name === PRISMA_KNOWN_ERROR_NAME &&
    typeof error.code === 'string'
  );
}

/** Violation d'unicité (`P2002`). */
export function isUniqueViolation(error: unknown): boolean {
  return isPrismaKnownError(error) && error.code === PRISMA_UNIQUE_VIOLATION;
}

/**
 * Description d'une erreur pour les logs. Le message et la stack d'une
 * erreur Prisma peuvent contenir les valeurs de la requête (téléphone, nom
 * du client) : seuls le nom, le code et le modèle sont journalisés.
 */
export function describeError(exception: unknown): string {
  if (isPrismaError(exception)) {
    const code = typeof exception.code === 'string' ? exception.code : '-';
    const modelName = exception.meta?.modelName;
    const model = typeof modelName === 'string' ? modelName : '-';
    return `${exception.name} code=${code} model=${model}`;
  }
  return exception instanceof Error
    ? (exception.stack ?? exception.message)
    : String(exception);
}
