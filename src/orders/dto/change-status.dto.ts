import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsString, MaxLength, ValidateIf } from 'class-validator';
import type { OrderStatus } from '../../generated/prisma/client.js';
import { ORDER_LIMITS } from '../order-limits.js';
import { ORDER_STATUSES } from '../order-status.js';
import { Trim } from './trim.transform.js';

export class ChangeStatusDto {
  @ApiProperty({ enum: ORDER_STATUSES })
  @IsIn(ORDER_STATUSES)
  status: OrderStatus;

  @ApiPropertyOptional({ maxLength: ORDER_LIMITS.statusCommentMaxLength })
  @ValidateIf((_dto: ChangeStatusDto, value: unknown) => value !== undefined)
  @Trim()
  @IsString()
  @MaxLength(ORDER_LIMITS.statusCommentMaxLength)
  comment?: string;
}
