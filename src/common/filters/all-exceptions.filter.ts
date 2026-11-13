import { STATUS_CODES } from 'node:http';
import {
  type ArgumentsHost,
  BadRequestException,
  Catch,
  ConflictException,
  type ExceptionFilter,
  HttpException,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import {
  describeError,
  isPrismaKnownError,
  PRISMA_RECORD_NOT_FOUND,
  PRISMA_UNIQUE_VIOLATION,
} from '../errors/prisma-error.js';

export const INTERNAL_ERROR_MESSAGE = 'Erreur interne';
export const CONFLICT_MESSAGE = 'Cette ressource existe déjà';
export const NOT_FOUND_MESSAGE = 'Ressource introuvable';
/** Remplace le message de l'analyseur JSON, qui cite un extrait du corps (I-04). */
export const INVALID_JSON_MESSAGE = 'Corps de requête JSON invalide';

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
      return exception.cause instanceof SyntaxError
        ? new BadRequestException(INVALID_JSON_MESSAGE)
        : exception;
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
