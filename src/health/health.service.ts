import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/index.js';
import {
  HEALTH_OK,
  type HealthResponseDto,
} from './dto/health-response.dto.js';

export const DATABASE_UNAVAILABLE_MESSAGE = 'Base de données indisponible';

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(private readonly prisma: PrismaService) {}

  async check(): Promise<HealthResponseDto> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch (error) {
      this.logger.error(
        `Base de données injoignable : ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new ServiceUnavailableException(DATABASE_UNAVAILABLE_MESSAGE);
    }
    return { status: HEALTH_OK };
  }
}
