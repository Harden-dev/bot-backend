import { ApiProperty } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ORDER_LIMITS } from '../order-limits.js';
import { Trim } from './trim.transform.js';

export class OrderItemDto {
  @ApiProperty({
    example: 'Robe wax',
    maxLength: ORDER_LIMITS.itemLabelMaxLength,
  })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(ORDER_LIMITS.itemLabelMaxLength)
  label: string;

  @ApiProperty({
    example: 2,
    minimum: ORDER_LIMITS.minQuantity,
    maximum: ORDER_LIMITS.maxQuantity,
  })
  @IsInt()
  @Min(ORDER_LIMITS.minQuantity)
  @Max(ORDER_LIMITS.maxQuantity)
  quantity: number;

  @ApiProperty({
    example: 15000,
    description: 'Prix unitaire en XOF',
    minimum: ORDER_LIMITS.minUnitPrice,
    maximum: ORDER_LIMITS.maxUnitPrice,
  })
  @IsInt()
  @Min(ORDER_LIMITS.minUnitPrice)
  @Max(ORDER_LIMITS.maxUnitPrice)
  unitPrice: number;
}
