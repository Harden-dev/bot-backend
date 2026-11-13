import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { normalizeCiPhone } from '../../common/index.js';
import { ORDER_LIMITS } from '../order-limits.js';
import { OrderItemDto } from './order-item.dto.js';
import { Trim } from './trim.transform.js';

const LOCAL_PHONE_PATTERN = /^\d{10}$/;

export const INVALID_CUSTOMER_PHONE_MESSAGE =
  'customerPhone doit être un numéro ivoirien de 10 chiffres, avec ou sans +225 / 00225';

const isPresent = (_dto: object, value: unknown) => value !== undefined;

/**
 * Correction d'une commande (US-CMD-05, PO-14). Champs facultatifs ; `null`
 * refusé (400) : seule l'absence vaut « inchangé ». `notes` vide : effacées.
 */
export class UpdateOrderDto {
  @ApiPropertyOptional({ maxLength: ORDER_LIMITS.customerNameMaxLength })
  @ValidateIf(isPresent)
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(ORDER_LIMITS.customerNameMaxLength)
  customerName?: string;

  /** Normalisé en 10 chiffres (R-P3) avant validation. */
  @ApiPropertyOptional({ example: '+225 07 07 07 07 07' })
  @ValidateIf(isPresent)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? (normalizeCiPhone(value) ?? value) : value,
  )
  @IsString()
  @Matches(LOCAL_PHONE_PATTERN, { message: INVALID_CUSTOMER_PHONE_MESSAGE })
  customerPhone?: string;

  @ApiPropertyOptional({ maxLength: ORDER_LIMITS.deliveryLocationMaxLength })
  @ValidateIf(isPresent)
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(ORDER_LIMITS.deliveryLocationMaxLength)
  deliveryLocation?: string;

  @ApiPropertyOptional({
    maxLength: ORDER_LIMITS.notesMaxLength,
    description: 'Chaîne vide : notes effacées',
  })
  @ValidateIf(isPresent)
  @Trim()
  @IsString()
  @MaxLength(ORDER_LIMITS.notesMaxLength)
  notes?: string;

  /** Remplace entièrement les articles ; total recalculé par le serveur. */
  @ApiPropertyOptional({ type: [OrderItemDto] })
  @ValidateIf(isPresent)
  @IsArray()
  @ArrayMinSize(ORDER_LIMITS.minItems)
  @ArrayMaxSize(ORDER_LIMITS.maxItems)
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items?: OrderItemDto[];
}
