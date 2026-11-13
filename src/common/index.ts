export { CurrentUser } from './decorators/current-user.decorator.js';
export { IS_PUBLIC_KEY, Public } from './decorators/public.decorator.js';
export {
  describeError,
  isPrismaKnownError,
  isTransactionConflict,
  isUniqueViolation,
  PRISMA_RECORD_NOT_FOUND,
  PRISMA_TRANSACTION_CONFLICT,
  PRISMA_UNIQUE_VIOLATION,
} from './errors/prisma-error.js';
export type { PrismaKnownError } from './errors/prisma-error.js';
export { AllExceptionsFilter } from './filters/all-exceptions.filter.js';
export {
  AUTH_REQUIRED_MESSAGE,
  JwtAuthGuard,
} from './guards/jwt-auth.guard.js';
export { buildPinoHttpOptions } from './logger/pino-http-options.js';
export { paginate, toSkipTake } from './pagination/paginate.js';
export type { PageMeta, PageResponse } from './pagination/paginate.js';
export { PageMetaDto } from './pagination/page-meta.dto.js';
export {
  MAX_LIMIT,
  PaginationQueryDto,
} from './pagination/pagination-query.dto.js';
export { maskPhone } from './phone/mask-phone.js';
export {
  CI_COUNTRY_CODE,
  normalizeCiPhone,
  normalizeVendorNumber,
} from './phone/normalize-phone.js';
export { INVALID_ID_MESSAGE, ParseIdPipe } from './pipes/parse-id.pipe.js';
export {
  computeTotal,
  INVALID_TOTAL_MESSAGE,
  MAX_ORDER_TOTAL,
  ORDER_TOTAL_EXCEEDED_MESSAGE,
  OrderTotalExceededError,
} from './money/compute-total.js';
export type { PricedItem } from './money/compute-total.js';
export { formatThousands, formatXof } from './money/format-xof.js';
export { INVALID_PERIOD_MESSAGE, toDayRange } from './period/day-range.js';
export type { DayRange } from './period/day-range.js';
export { foldCase, normalizeForMatch } from './text/normalize-for-match.js';
export { ApiAdminAuth } from './swagger/api-admin-auth.decorator.js';
export { ErrorResponseDto } from './swagger/error-response.dto.js';
