import { ApiProperty } from '@nestjs/swagger';
import { UserResponseDto } from '../../users/index.js';

export class LoginResponseDto {
  @ApiProperty({
    description: 'JWT Bearer, durée JWT_EXPIRES_IN (8 h par défaut)',
  })
  accessToken: string;

  @ApiProperty({ type: UserResponseDto })
  user: UserResponseDto;
}
