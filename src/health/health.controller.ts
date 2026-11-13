import { Controller, Get } from '@nestjs/common';
import { Public } from '../common/index.js';
import { HealthResponseDto } from './dto/health-response.dto.js';
import { HealthService } from './health.service.js';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Public()
  @Get()
  check(): Promise<HealthResponseDto> {
    return this.healthService.check();
  }
}
