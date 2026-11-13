import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ApiAdminAuth, ErrorResponseDto } from '../common/index.js';
import { StatsQueryDto } from './dto/stats-query.dto.js';
import {
  StatsByDayDto,
  StatsByVendorDto,
  StatsOverviewDto,
} from './dto/stats-response.dto.js';
import { StatsService } from './stats.service.js';

@ApiTags('stats')
@ApiAdminAuth()
@ApiBadRequestResponse({ type: ErrorResponseDto })
@Controller('stats')
export class StatsController {
  constructor(private readonly statsService: StatsService) {}

  @Get('overview')
  @ApiOperation({ summary: 'Indicateurs globaux sur la période' })
  @ApiOkResponse({ type: StatsOverviewDto })
  overview(@Query() query: StatsQueryDto): Promise<StatsOverviewDto> {
    return this.statsService.overview(query);
  }

  @Get('by-vendor')
  @ApiOperation({ summary: 'Commandes et montant par vendeur' })
  @ApiOkResponse({ type: StatsByVendorDto })
  byVendor(@Query() query: StatsQueryDto): Promise<StatsByVendorDto> {
    return this.statsService.byVendor(query);
  }

  @Get('by-day')
  @ApiOperation({ summary: 'Commandes et montant par jour' })
  @ApiOkResponse({ type: StatsByDayDto })
  byDay(@Query() query: StatsQueryDto): Promise<StatsByDayDto> {
    return this.statsService.byDay(query);
  }
}
