import type { PaginationQueryDto } from './pagination-query.dto.js';

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
}

export interface PageResponse<T> {
  data: T[];
  meta: PageMeta;
}

export function toSkipTake(query: PaginationQueryDto): {
  skip: number;
  take: number;
} {
  return { skip: (query.page - 1) * query.limit, take: query.limit };
}

export function paginate<T>(
  data: T[],
  total: number,
  query: PaginationQueryDto,
): PageResponse<T> {
  return { data, meta: { page: query.page, limit: query.limit, total } };
}
