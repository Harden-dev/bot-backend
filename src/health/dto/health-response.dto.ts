import { ApiProperty } from '@nestjs/swagger';

export const HEALTH_OK = 'ok';

export class HealthResponseDto {
  @ApiProperty({ type: String, enum: [HEALTH_OK] })
  status: typeof HEALTH_OK;
}
