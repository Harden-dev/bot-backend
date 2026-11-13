import { ApiProperty } from '@nestjs/swagger';
import type { Vendor } from '../../generated/prisma/client.js';
import { toNumberId } from '../../prisma/index.js';

export class VendorResponseDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'Boutique Awa' })
  name: string;

  @ApiProperty({ example: '2250707070707' })
  whatsappNumber: string;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export function toVendorResponse(vendor: Vendor): VendorResponseDto {
  return {
    id: toNumberId(vendor.id),
    name: vendor.name,
    whatsappNumber: vendor.whatsappNumber,
    isActive: vendor.isActive,
    createdAt: vendor.createdAt,
    updatedAt: vendor.updatedAt,
  };
}
