import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  Max,
  Min,
} from 'class-validator';

/** Nombre maximal d'identifiants d'un reçu groupé (PO-19). */
export const MAX_BATCH_RECEIPTS = 100;

/** Corps de `POST /receipts/batch` : 1 à 100 identifiants (PO-19). */
export class BatchReceiptsDto {
  @ApiProperty({
    type: [Number],
    minItems: 1,
    maxItems: MAX_BATCH_RECEIPTS,
    example: [12, 15],
    description: 'Doublons ignorés ; pages dans l’ordre de la liste',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_BATCH_RECEIPTS)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(Number.MAX_SAFE_INTEGER, { each: true })
  orderIds: number[];
}
