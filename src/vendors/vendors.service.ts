import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  isPrismaKnownError,
  normalizeVendorNumber,
  PRISMA_RECORD_NOT_FOUND,
  PRISMA_UNIQUE_VIOLATION,
} from '../common/index.js';
import type { Vendor } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/index.js';
import type { CreateVendorDto } from './dto/create-vendor.dto.js';
import type { UpdateVendorDto } from './dto/update-vendor.dto.js';
import {
  toVendorResponse,
  type VendorResponseDto,
} from './dto/vendor-response.dto.js';

export const DUPLICATE_VENDOR_NUMBER_MESSAGE =
  'Ce numéro WhatsApp est déjà attribué à un vendeur';
export const VENDOR_NOT_FOUND_MESSAGE = 'Vendeur introuvable';

/** Traduit les erreurs Prisma attendues d'une écriture sur `vendors`. */
function toVendorWriteError(error: unknown): unknown {
  if (!isPrismaKnownError(error)) {
    return error;
  }
  if (error.code === PRISMA_UNIQUE_VIOLATION) {
    return new ConflictException(DUPLICATE_VENDOR_NUMBER_MESSAGE);
  }
  if (error.code === PRISMA_RECORD_NOT_FOUND) {
    return new NotFoundException(VENDOR_NOT_FOUND_MESSAGE);
  }
  return error;
}

/** Vendeurs et liste blanche des numéros (aucune suppression). */
@Injectable()
export class VendorsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Tous les vendeurs, actifs et inactifs, sans pagination (PO-21). */
  async findAll(): Promise<VendorResponseDto[]> {
    const vendors = await this.prisma.vendor.findMany({
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    return vendors.map(toVendorResponse);
  }

  /** Numéro déjà normalisé par le DTO ; doublon : `409` (PO-16). */
  async create(dto: CreateVendorDto): Promise<VendorResponseDto> {
    try {
      const vendor = await this.prisma.vendor.create({
        data: { name: dto.name, whatsappNumber: dto.whatsappNumber },
      });
      return toVendorResponse(vendor);
    } catch (error) {
      throw toVendorWriteError(error);
    }
  }

  /** Champs fournis uniquement ; vendeur inconnu `404`, doublon `409`. */
  async update(id: bigint, dto: UpdateVendorDto): Promise<VendorResponseDto> {
    try {
      const vendor = await this.prisma.vendor.update({
        where: { id },
        data: {
          name: dto.name,
          whatsappNumber: dto.whatsappNumber,
          isActive: dto.isActive,
        },
      });
      return toVendorResponse(vendor);
    } catch (error) {
      throw toVendorWriteError(error);
    }
  }

  /**
   * Liste blanche du bot : vendeur actif pour ce numéro (tout format accepté
   * par PO-15, ex. le `from` de Meta), sinon `null`.
   */
  async findActiveByWhatsappNumber(number: string): Promise<Vendor | null> {
    const whatsappNumber = normalizeVendorNumber(number);
    if (whatsappNumber === null) {
      return null;
    }
    return this.prisma.vendor.findFirst({
      where: { whatsappNumber, isActive: true },
    });
  }
}
