import {
  BadRequestException,
  Injectable,
  type PipeTransform,
} from '@nestjs/common';

export const INVALID_ID_MESSAGE = 'Identifiant invalide';

const POSITIVE_INTEGER = /^[1-9]\d*$/;

/**
 * Paramètre `:id` : entier strictement positif (au plus 2^53 - 1), converti
 * en `bigint` pour Prisma (ids `BIGINT UNSIGNED`).
 */
@Injectable()
export class ParseIdPipe implements PipeTransform<string, bigint> {
  transform(value: string): bigint {
    if (!POSITIVE_INTEGER.test(value) || !Number.isSafeInteger(Number(value))) {
      throw new BadRequestException(INVALID_ID_MESSAGE);
    }
    return BigInt(value);
  }
}
