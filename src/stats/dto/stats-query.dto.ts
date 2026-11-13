import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional, Matches } from 'class-validator';

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MESSAGE = '$property doit être une date AAAA-MM-JJ';

/** Période des statistiques (PO-20) : 30 derniers jours par défaut. */
export class StatsQueryDto {
  @ApiPropertyOptional({
    example: '2026-11-01',
    description:
      'Inclus (UTC). Absent : to − 29 jours. Seul, to vaut aujourd’hui : un from postérieur à aujourd’hui donne donc 400 (from > to). Période de 366 jours au plus.',
  })
  @IsOptional()
  @Matches(DAY_PATTERN, { message: DAY_MESSAGE })
  @IsISO8601({ strict: true }, { message: DAY_MESSAGE })
  from?: string;

  @ApiPropertyOptional({
    example: '2026-11-30',
    description: 'Inclus (UTC). Absent : aujourd’hui (UTC).',
  })
  @IsOptional()
  @Matches(DAY_PATTERN, { message: DAY_MESSAGE })
  @IsISO8601({ strict: true }, { message: DAY_MESSAGE })
  to?: string;
}
