import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsBoolean, ValidateIf } from 'class-validator';
import { CreateVendorDto } from './create-vendor.dto.js';

// Champs facultatifs, mais `null` refusé (400) : seule l'absence vaut « inchangé ».
export class UpdateVendorDto extends PartialType(CreateVendorDto, {
  skipNullProperties: false,
}) {
  @ApiPropertyOptional({ description: 'false : vendeur désactivé' })
  @ValidateIf((_dto: UpdateVendorDto, value: unknown) => value !== undefined)
  @IsBoolean()
  isActive?: boolean;
}
