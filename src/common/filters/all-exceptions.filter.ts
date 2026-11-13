import { STATUS_CODES } from 'node:http';
import {
  type ArgumentsHost,
  Catch,
  ConflictException,
  type ExceptionFilter,
  HttpException,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';

export const INTERNAL_ERROR_MESSAGE = 'Erreur interne';
export const CONFLICT_MESSAGE = 'Cette ressource existe déjà';
export const NOT_FOUND_MESSAGE = 'Ressource introuvable';

const PRISMA_UNIQUE_VIOLATION = 'P2002';
const PRISMA_RECORD_NOT_FOUND = 'P2025';
const PRISMA_KNOWN_ERROR_NAME = 'PrismaClientKnownRequestError';
const PRISMA_ERROR_NAME_PREFIX = 'PrismaClient';

interface PrismaError extends Error {
  code?: unknown;
  meta?: { modelName?: unknown };
}

interface PrismaKnownError extends PrismaError {
  code: string;
}

function isPrismaError(error: unknown): error is PrismaError {
  return (
    error instanceof Error && error.name.startsWith(PRISMA_ERROR_NAME_PREFIX)
  );
}

function isPrismaKnownError(error: unknown): error is PrismaKnownError {
  return (
    isPrismaError(error) &&
    error.name === PRISMA_KNOWN_ERROR_NAME &&
    typeof error.code === 'string'
  );
}

/**
 * Le message et la stack d'une erreur Prisma peuvent contenir les valeurs
 * de la requête (téléphone, nom du client) : seuls le nom, le code et le
 * modèle sont journalisés.
 */
function describeError(exception: unknown): string {
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

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly adapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const httpException = this.toHttpException(exception);
    const status = httpException.getStatus();
    const response = httpException.getResponse();
    const body =
      typeof response === 'string'
        ? { statusCode: status, message: response, error: STATUS_CODES[status] }
        : response;

    this.adapterHost.httpAdapter.reply(
      host.switchToHttp().getResponse(),
      body,
      status,
    );
  }

  private toHttpException(exception: unknown): HttpException {
    if (exception instanceof HttpException) {
      return exception;
    }
    if (isPrismaKnownError(exception)) {
      if (exception.code === PRISMA_UNIQUE_VIOLATION) {
        return new ConflictException(CONFLICT_MESSAGE);
      }
      if (exception.code === PRISMA_RECORD_NOT_FOUND) {
        return new NotFoundException(NOT_FOUND_MESSAGE);
      }
    }
    this.logger.error(describeError(exception));
    return new InternalServerErrorException(INTERNAL_ERROR_MESSAGE);
  }
}
