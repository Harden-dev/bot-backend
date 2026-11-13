import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { paginate, toSkipTake } from './paginate.js';
import {
  DEFAULT_LIMIT,
  DEFAULT_PAGE,
  MAX_PAGE,
  PaginationQueryDto,
} from './pagination-query.dto.js';

function parse(query: Record<string, string>) {
  const dto = plainToInstance(PaginationQueryDto, query);
  return { dto, errors: validateSync(dto) };
}

describe('PaginationQueryDto', () => {
  it('applique page=1 et limit=20 par défaut', () => {
    const { dto, errors } = parse({});

    expect(errors).toHaveLength(0);
    expect(dto.page).toBe(DEFAULT_PAGE);
    expect(dto.limit).toBe(DEFAULT_LIMIT);
  });

  it('convertit les paramètres de requête en nombres', () => {
    const { dto, errors } = parse({ page: '3', limit: '100' });

    expect(errors).toHaveLength(0);
    expect(dto).toMatchObject({ page: 3, limit: 100 });
  });

  it('accepte la page maximale (B-04)', () => {
    const { dto, errors } = parse({ page: String(MAX_PAGE) });

    expect(errors).toHaveLength(0);
    expect(dto.page).toBe(MAX_PAGE);
  });

  it.each([
    [{ limit: '101' }, 'limit'],
    [{ limit: '0' }, 'limit'],
    [{ page: '0' }, 'page'],
    [{ page: '1.5' }, 'page'],
    [{ page: 'abc' }, 'page'],
    [{ page: String(MAX_PAGE + 1) }, 'page'],
    [{ page: '999999999999999999999' }, 'page'],
  ])('refuse %o', (query, property) => {
    const { errors } = parse(query);

    expect(errors.map((error) => error.property)).toEqual([property]);
  });
});

describe('toSkipTake', () => {
  it('calcule le décalage à partir de la page', () => {
    expect(toSkipTake({ page: 3, limit: 20 })).toEqual({ skip: 40, take: 20 });
  });
});

describe('paginate', () => {
  it('construit la réponse { data, meta }', () => {
    expect(paginate(['a'], 41, { page: 2, limit: 20 })).toEqual({
      data: ['a'],
      meta: { page: 2, limit: 20, total: 41 },
    });
  });
});
