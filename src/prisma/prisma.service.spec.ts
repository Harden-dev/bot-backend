import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PrismaService } from './prisma.service.js';

describe('PrismaService', () => {
  async function createService() {
    const moduleRef = await Test.createTestingModule({
      providers: [
        PrismaService,
        {
          provide: ConfigService,
          useValue: {
            get: vi.fn(() => 'mysql://user:pass@127.0.0.1:3306/commandes_test'),
          },
        },
      ],
    }).compile();
    return { moduleRef, service: moduleRef.get(PrismaService) };
  }

  // Premier chargement du client Prisma et de l'adaptateur : démarrage à
  // froid, parfois plus de 5 s sous charge (suite complète en parallèle).
  it(
    'lit DATABASE_URL dans la configuration validée',
    { timeout: 20_000 },
    async () => {
      const { moduleRef } = await createService();
      const config = moduleRef.get(ConfigService);

      expect(config.get).toHaveBeenCalledWith('DATABASE_URL', { infer: true });
    },
  );

  it('se connecte à l’initialisation et se déconnecte à l’arrêt du module', async () => {
    const { moduleRef, service } = await createService();
    const connect = vi.spyOn(service, '$connect').mockResolvedValue();
    const disconnect = vi.spyOn(service, '$disconnect').mockResolvedValue();

    await moduleRef.init();
    expect(connect).toHaveBeenCalledOnce();

    await moduleRef.close();
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
