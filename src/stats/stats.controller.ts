import { Controller, Get, Query } from '@nestjs/common';
import { StatsQueryDto } from './dto/stats-query.dto.js';
import type {
  StatsByDayDto,
  StatsByVendorDto,
  StatsOverviewDto,
} from './dto/stats-response.dto.js';
import { StatsService } from './stats.service.js';

@Controller('stats')
export class StatsController {
  constructor(private readonly statsService: StatsService) {}

  @Get('overview')
  overview(@Query() query: StatsQueryDto): Promise<StatsOverviewDto> {
    return this.statsService.overview(query);
  }

  @Get('by-vendor')
  byVendor(@Query() query: StatsQueryDto): Promise<StatsByVendorDto> {
    return this.statsService.byVendor(query);
  }

  @Get('by-day')
  byDay(@Query() query: StatsQueryDto): Promise<StatsByDayDto> {
    return this.statsService.byDay(query);
  }
}
