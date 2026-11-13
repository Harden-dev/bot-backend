import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/index.js';
import type { OrderStatus } from '../../generated/prisma/client.js';
import { ORDER_STATUSES } from '../order-status.js';
import { Trim } from './trim.transform.js';

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MESSAGE = '$property doit être une date AAAA-MM-JJ';
const SEARCH_MAX_LENGTH = 100;

/** Filtres cumulables de `GET /orders` (US-CMD-02, PO-21). */
export class ListOrdersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Référence (préfixe), nom du client ou téléphone (contient)',
    maxLength: SEARCH_MAX_LENGTH,
  })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(SEARCH_MAX_LENGTH)
  search?: string;

  @ApiPropertyOptional({ enum: ORDER_STATUSES })
  @IsOptional()
  @IsIn(ORDER_STATUSES)
  status?: OrderStatus;

  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  vendorId?: number;

  @ApiPropertyOptional({ example: '2026-11-01', description: 'Inclus (UTC)' })
  @IsOptional()
  @Matches(DAY_PATTERN, { message: DAY_MESSAGE })
  @IsISO8601({ strict: true }, { message: DAY_MESSAGE })
  from?: string;

  @ApiPropertyOptional({ example: '2026-11-30', description: 'Inclus (UTC)' })
  @IsOptional()
  @Matches(DAY_PATTERN, { message: DAY_MESSAGE })
  @IsISO8601({ strict: true }, { message: DAY_MESSAGE })
  to?: string;
}
