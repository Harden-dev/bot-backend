import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';
import { CI_COUNTRY_CODE, normalizeVendorNumber } from '../../common/index.js';

const NAME_MAX_LENGTH = 120;
const VENDOR_NUMBER_PATTERN = new RegExp(`^${CI_COUNTRY_CODE}\\d{10}$`);

export const INVALID_VENDOR_NUMBER_MESSAGE =
  'whatsappNumber doit être un numéro ivoirien : 10 chiffres, avec ou sans +225 / 00225';

export class CreateVendorDto {
  @ApiProperty({ example: 'Boutique Awa', maxLength: NAME_MAX_LENGTH })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(NAME_MAX_LENGTH)
  name: string;

  /** Normalisé en E.164 sans `+` (PO-15) avant validation. */
  @ApiProperty({
    example: '+225 07 07 07 07 07',
    description: 'Stocké en E.164 sans + (ex. 2250707070707)',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? (normalizeVendorNumber(value) ?? value) : value,
  )
  @IsString()
  @Matches(VENDOR_NUMBER_PATTERN, { message: INVALID_VENDOR_NUMBER_MESSAGE })
  whatsappNumber: string;
}
