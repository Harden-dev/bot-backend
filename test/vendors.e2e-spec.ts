import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { PrismaService } from '../src/prisma/index.js';
import { VendorsService } from '../src/vendors/index.js';
import { createApp, seedAdminWithToken } from './helpers/create-app.js';
import { resetDb } from './helpers/reset-db.js';

interface VendorBody {
  id: number;
  name: string;
  whatsappNumber: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

describe('Vendors (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let token: string;

  const api = () => request(app.getHttpServer());
  const auth = () => ({ Authorization: `Bearer ${token}` });

  async function createVendor(
    name: string,
    whatsappNumber: string,
  ): Promise<VendorBody> {
    const res = await api()
      .post('/api/v1/vendors')
      .set(auth())
      .send({ name, whatsappNumber })
      .expect(201);
    return res.body as VendorBody;
  }

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDb(prisma);
    token = await seedAdminWithToken(app);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/v1/vendors', () => {
    it('crée un vendeur actif avec un numéro normalisé en E.164 sans +', async () => {
      const vendor = await createVendor(
        '  Boutique Awa ',
        '+225 07 07 07 07 07',
      );

      expect(vendor).toEqual({
        id: expect.any(Number),
        name: 'Boutique Awa',
        whatsappNumber: '2250707070707',
        isActive: true,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });
      await expect(
        prisma.vendor.count({ where: { whatsappNumber: '2250707070707' } }),
      ).resolves.toBe(1);
    });

    it('préfixe une saisie locale à 10 chiffres par 225 (PO-15)', async () => {
      const vendor = await createVendor('Kofi', '05.05.05.05.05');

      expect(vendor.whatsappNumber).toBe('2250505050505');
    });

    it('refuse un numéro déjà attribué après normalisation en 409 (PO-16)', async () => {
      await createVendor('Awa', '0707070707');

      await api()
        .post('/api/v1/vendors')
        .set(auth())
        .send({ name: 'Autre', whatsappNumber: '00225 07-07-07-07-07' })
        .expect(409, {
          statusCode: 409,
          message: 'Ce numéro WhatsApp est déjà attribué à un vendeur',
          error: 'Conflict',
        });
    });

    it.each([
      ['numéro étranger', { name: 'A', whatsappNumber: '+33612345678' }],
      ['numéro trop court', { name: 'A', whatsappNumber: '070707070' }],
      ['numéro non texte', { name: 'A', whatsappNumber: 707070707 }],
      ['nom vide', { name: '   ', whatsappNumber: '0707070707' }],
      [
        'nom trop long',
        { name: 'a'.repeat(121), whatsappNumber: '0707070707' },
      ],
      ['champ manquant', { name: 'A' }],
      [
        'champ non autorisé',
        { name: 'A', whatsappNumber: '0707070707', isActive: false },
      ],
    ])('refuse en 400 : %s', async (_, body) => {
      const res = await api()
        .post('/api/v1/vendors')
        .set(auth())
        .send(body)
        .expect(400);

      expect(res.body).toMatchObject({ statusCode: 400, error: 'Bad Request' });
      await expect(prisma.vendor.count()).resolves.toBe(0);
    });
  });

  describe('GET /api/v1/vendors', () => {
    it('liste tous les vendeurs, actifs et inactifs, triés par nom', async () => {
      const zoe = await createVendor('Zoé', '0101010101');
      await createVendor('Awa', '0707070707');
      await prisma.vendor.update({
        where: { id: BigInt(zoe.id) },
        data: { isActive: false },
      });

      const res = await api().get('/api/v1/vendors').set(auth()).expect(200);

      expect(
        (res.body as VendorBody[]).map(
          ({ name, whatsappNumber, isActive }) => ({
            name,
            whatsappNumber,
            isActive,
          }),
        ),
      ).toEqual([
        { name: 'Awa', whatsappNumber: '2250707070707', isActive: true },
        { name: 'Zoé', whatsappNumber: '2250101010101', isActive: false },
      ]);
    });
  });

  describe('PATCH /api/v1/vendors/:id', () => {
    it('modifie le nom et le numéro (normalisé)', async () => {
      const vendor = await createVendor('Awa', '0707070707');

      const res = await api()
        .patch(`/api/v1/vendors/${vendor.id}`)
        .set(auth())
        .send({ name: 'Awa Couture', whatsappNumber: '+225 05 05 05 05 05' })
        .expect(200);

      expect(res.body).toMatchObject({
        id: vendor.id,
        name: 'Awa Couture',
        whatsappNumber: '2250505050505',
        isActive: true,
      });
    });

    it('désactive puis réactive un vendeur, retiré puis remis en liste blanche', async () => {
      const vendor = await createVendor('Awa', '0707070707');
      const vendors = app.get(VendorsService);
      await expect(
        vendors.findActiveByWhatsappNumber('2250707070707'),
      ).resolves.toMatchObject({ id: BigInt(vendor.id) });

      await api()
        .patch(`/api/v1/vendors/${vendor.id}`)
        .set(auth())
        .send({ isActive: false })
        .expect(200)
        .expect((res) => expect(res.body).toMatchObject({ isActive: false }));
      await expect(
        vendors.findActiveByWhatsappNumber('2250707070707'),
      ).resolves.toBeNull();

      await api()
        .patch(`/api/v1/vendors/${vendor.id}`)
        .set(auth())
        .send({ isActive: true })
        .expect(200);
      await expect(
        vendors.findActiveByWhatsappNumber('2250707070707'),
      ).resolves.toMatchObject({ id: BigInt(vendor.id) });
    });

    it('refuse le numéro d’un autre vendeur en 409', async () => {
      await createVendor('Awa', '0707070707');
      const kofi = await createVendor('Kofi', '0505050505');

      await api()
        .patch(`/api/v1/vendors/${kofi.id}`)
        .set(auth())
        .send({ whatsappNumber: '0707070707' })
        .expect(409);
      await expect(
        prisma.vendor.findUniqueOrThrow({ where: { id: BigInt(kofi.id) } }),
      ).resolves.toMatchObject({ whatsappNumber: '2250505050505' });
    });

    it('répond 404 pour un vendeur inconnu', async () => {
      await api()
        .patch('/api/v1/vendors/999')
        .set(auth())
        .send({ name: 'X' })
        .expect(404, {
          statusCode: 404,
          message: 'Vendeur introuvable',
          error: 'Not Found',
        });
    });

    it.each([['0'], ['-1'], ['abc'], ['1.5']])(
      'refuse l’identifiant « %s » en 400',
      async (id) => {
        await api()
          .patch(`/api/v1/vendors/${id}`)
          .set(auth())
          .send({ name: 'X' })
          .expect(400, {
            statusCode: 400,
            message: 'Identifiant invalide',
            error: 'Bad Request',
          });
      },
    );

    it.each([
      ['isActive non booléen', { isActive: 'false' }],
      ['nom null', { name: null }],
      ['numéro null', { whatsappNumber: null }],
      ['numéro invalide', { whatsappNumber: '12345' }],
      ['champ non autorisé', { createdAt: '2026-01-01' }],
    ])('refuse en 400 : %s', async (_, body) => {
      const vendor = await createVendor('Awa', '0707070707');

      await api()
        .patch(`/api/v1/vendors/${vendor.id}`)
        .set(auth())
        .send(body)
        .expect(400);
    });
  });

  it('n’expose aucune route de suppression', async () => {
    const vendor = await createVendor('Awa', '0707070707');

    await api().delete(`/api/v1/vendors/${vendor.id}`).set(auth()).expect(404);
    await expect(prisma.vendor.count()).resolves.toBe(1);
  });
});
