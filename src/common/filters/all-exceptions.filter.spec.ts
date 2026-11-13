import {
  type ArgumentsHost,
  BadRequestException,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { HttpAdapterHost } from '@nestjs/core';
import {
  AllExceptionsFilter,
  CONFLICT_MESSAGE,
  INTERNAL_ERROR_MESSAGE,
  INVALID_JSON_MESSAGE,
  NOT_FOUND_MESSAGE,
} from './all-exceptions.filter.js';

const CUSTOMER_DATA = '0707070707 Awa Koné';

function prismaError(code: string): Error {
  return Object.assign(new Error('requête SQL interne'), {
    name: 'PrismaClientKnownRequestError',
    code,
  });
}

describe('AllExceptionsFilter', () => {
  const response = {};
  const host = {
    switchToHttp: () => ({ getResponse: () => response }),
  } as unknown as ArgumentsHost;
  let reply: ReturnType<typeof vi.fn>;
  let filter: AllExceptionsFilter;
  let logError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    reply = vi.fn();
    filter = new AllExceptionsFilter({
      httpAdapter: { reply },
    } as unknown as HttpAdapterHost);
    logError = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renvoie une exception HTTP Nest telle quelle', () => {
    filter.catch(new BadRequestException('Champ invalide'), host);

    expect(reply).toHaveBeenCalledWith(
      response,
      { statusCode: 400, message: 'Champ invalide', error: 'Bad Request' },
      400,
    );
    expect(logError).not.toHaveBeenCalled();
  });

  it('remplace le message de l’analyseur JSON par un message générique (I-04)', () => {
    const parseError = new SyntaxError(
      `Unexpected token 'a', "${CUSTOMER_DATA}" is not valid JSON`,
    );
    filter.catch(
      new BadRequestException(parseError.message, { cause: parseError }),
      host,
    );

    expect(reply).toHaveBeenCalledWith(
      response,
      { statusCode: 400, message: INVALID_JSON_MESSAGE, error: 'Bad Request' },
      400,
    );
    expect(JSON.stringify(reply.mock.calls)).not.toContain(CUSTOMER_DATA);
  });

  it.each([
    [413, 'request entity too large', 'Payload Too Large'],
    [415, 'unsupported charset "UTF-7"', 'Unsupported Media Type'],
    [400, 'Unexpected end of JSON input', 'Bad Request'],
    [503, 'Indisponible', 'Service Unavailable'],
  ])(
    'complète une exception HTTP %i dont la réponse est une chaîne',
    (status, message, error) => {
      filter.catch(new HttpException(message, status), host);

      expect(reply).toHaveBeenCalledWith(
        response,
        { statusCode: status, message, error },
        status,
      );
    },
  );

  it('transforme P2002 en 409', () => {
    filter.catch(prismaError('P2002'), host);

    expect(reply).toHaveBeenCalledWith(
      response,
      { statusCode: 409, message: CONFLICT_MESSAGE, error: 'Conflict' },
      HttpStatus.CONFLICT,
    );
  });

  it('transforme P2025 en 404', () => {
    filter.catch(prismaError('P2025'), host);

    expect(reply).toHaveBeenCalledWith(
      response,
      { statusCode: 404, message: NOT_FOUND_MESSAGE, error: 'Not Found' },
      HttpStatus.NOT_FOUND,
    );
  });

  it.each([
    ['une erreur Prisma non gérée', prismaError('P1001')],
    ['une erreur inattendue', new Error('SELECT * FROM users')],
    ['une valeur non Error', 'échec'],
  ])('renvoie 500 sans détail et journalise %s', (_label, exception) => {
    filter.catch(exception, host);

    expect(reply).toHaveBeenCalledWith(
      response,
      {
        statusCode: 500,
        message: INTERNAL_ERROR_MESSAGE,
        error: 'Internal Server Error',
      },
      500,
    );
    expect(logError).toHaveBeenCalledOnce();
  });

  it.each([
    ['PrismaClientKnownRequestError', 'P1001', 'code=P1001'],
    ['PrismaClientUnknownRequestError', undefined, 'code=-'],
    ['PrismaClientValidationError', undefined, 'code=-'],
  ])(
    'journalise %s sans message ni stack (données client)',
    (name, code, expectedCode) => {
      const exception = Object.assign(
        new Error(`Argument customerPhone: ${CUSTOMER_DATA}`),
        { name, code, meta: { modelName: 'Order' } },
      );

      filter.catch(exception, host);

      const logged = String(logError.mock.calls[0]?.[0]);
      expect(logged).toBe(`${name} ${expectedCode} model=Order`);
      expect(logged).not.toContain(CUSTOMER_DATA);
    },
  );

  it('journalise la stack complète d’une erreur non Prisma', () => {
    const exception = new Error('panne inattendue');

    filter.catch(exception, host);

    expect(logError).toHaveBeenCalledWith(exception.stack);
  });
});
