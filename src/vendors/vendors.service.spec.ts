import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma, type Vendor } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/index.js';
import {
  DUPLICATE_VENDOR_NUMBER_MESSAGE,
  VENDOR_NOT_FOUND_MESSAGE,
  VendorsService,
} from './vendors.service.js';

const VENDOR: Vendor = {
  id: 3n,
  name: 'Boutique Awa',
  whatsappNumber: '2250707070707',
  isActive: true,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-02T00:00:00Z'),
};

const VENDOR_RESPONSE = {
  id: 3,
  name: 'Boutique Awa',
  whatsappNumber: '2250707070707',
  isActive: true,
  createdAt: VENDOR.createdAt,
  updatedAt: VENDOR.updatedAt,
};

function prismaError(code: string) {
  return new Prisma.PrismaClientKnownRequestError('erreur', {
    code,
    clientVersion: 'test',
  });
}

describe('VendorsService', () => {
  const vendor = {
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    findFirst: vi.fn(),
  };
  let service: VendorsService;

  beforeEach(async () => {
    vi.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        VendorsService,
        { provide: PrismaService, useValue: { vendor } },
      ],
    }).compile();
    service = moduleRef.get(VendorsService);
  });

  it('liste tous les vendeurs par nom, ids en number', async () => {
    vendor.findMany.mockResolvedValue([VENDOR]);

    await expect(service.findAll()).resolves.toEqual([VENDOR_RESPONSE]);
    expect(vendor.findMany).toHaveBeenCalledWith({
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
  });

  it('crée un vendeur avec le numéro reçu du DTO', async () => {
    vendor.create.mockResolvedValue(VENDOR);

    await expect(
      service.create({ name: 'Boutique Awa', whatsappNumber: '2250707070707' }),
    ).resolves.toEqual(VENDOR_RESPONSE);
    expect(vendor.create).toHaveBeenCalledWith({
      data: { name: 'Boutique Awa', whatsappNumber: '2250707070707' },
    });
  });

  it('refuse un numéro en doublon à la création en 409 (PO-16)', async () => {
    vendor.create.mockRejectedValue(prismaError('P2002'));

    await expect(
      service.create({ name: 'B', whatsappNumber: '2250707070707' }),
    ).rejects.toThrow(new ConflictException(DUPLICATE_VENDOR_NUMBER_MESSAGE));
  });

  it('propage une erreur inattendue sans la convertir', async () => {
    const error = new Error('connexion perdue');
    vendor.create.mockRejectedValue(error);

    await expect(
      service.create({ name: 'B', whatsappNumber: '2250707070707' }),
    ).rejects.toBe(error);
  });

  it('propage une erreur Prisma d’un autre code', async () => {
    const error = prismaError('P2000');
    vendor.update.mockRejectedValue(error);

    await expect(service.update(3n, { name: 'B' })).rejects.toBe(error);
  });

  it('met à jour uniquement les champs fournis', async () => {
    vendor.update.mockResolvedValue({ ...VENDOR, isActive: false });

    await expect(service.update(3n, { isActive: false })).resolves.toEqual({
      ...VENDOR_RESPONSE,
      isActive: false,
    });
    expect(vendor.update).toHaveBeenCalledWith({
      where: { id: 3n },
      data: { name: undefined, whatsappNumber: undefined, isActive: false },
    });
  });

  it('refuse un numéro en doublon à la modification en 409', async () => {
    vendor.update.mockRejectedValue(prismaError('P2002'));

    await expect(
      service.update(3n, { whatsappNumber: '2250505050505' }),
    ).rejects.toThrow(new ConflictException(DUPLICATE_VENDOR_NUMBER_MESSAGE));
  });

  it('répond 404 pour un vendeur inconnu', async () => {
    vendor.update.mockRejectedValue(prismaError('P2025'));

    await expect(service.update(99n, { name: 'B' })).rejects.toThrow(
      new NotFoundException(VENDOR_NOT_FOUND_MESSAGE),
    );
  });

  describe('findActiveByWhatsappNumber', () => {
    it('normalise le numéro et cherche un vendeur actif', async () => {
      vendor.findFirst.mockResolvedValue(VENDOR);

      await expect(
        service.findActiveByWhatsappNumber('+225 07 07 07 07 07'),
      ).resolves.toBe(VENDOR);
      expect(vendor.findFirst).toHaveBeenCalledWith({
        where: { whatsappNumber: '2250707070707', isActive: true },
      });
    });

    it('renvoie null sans requête pour un numéro non ivoirien', async () => {
      await expect(
        service.findActiveByWhatsappNumber('33612345678'),
      ).resolves.toBeNull();
      expect(vendor.findFirst).not.toHaveBeenCalled();
    });
  });
});
