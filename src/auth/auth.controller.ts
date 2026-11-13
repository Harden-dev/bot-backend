import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import {
  ApiAdminAuth,
  CurrentUser,
  ErrorResponseDto,
  Public,
} from '../common/index.js';
import { toUserResponse, UserResponseDto } from '../users/index.js';
import { type AuthUser, AuthService } from './auth.service.js';
import { LoginDto } from './dto/login.dto.js';
import { LoginResponseDto } from './dto/login-response.dto.js';
import { LOGIN_RATE_LIMIT } from './login-rate-limit.js';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // Seule route limitée ; options et compteur viennent du ThrottlerModule
  // (global) importé par AuthModule.
  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: LOGIN_RATE_LIMIT })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Connexion (public)',
    description: '5 tentatives par minute et par IP, 429 au-delà.',
  })
  @ApiOkResponse({ type: LoginResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiUnauthorizedResponse({
    type: ErrorResponseDto,
    description: 'E-mail ou mot de passe incorrect',
  })
  @ApiTooManyRequestsResponse({ type: ErrorResponseDto })
  login(@Body() dto: LoginDto): Promise<LoginResponseDto> {
    return this.authService.login(dto.email, dto.password);
  }

  @Get('me')
  @ApiAdminAuth()
  @ApiOperation({ summary: 'Utilisateur courant' })
  @ApiOkResponse({ type: UserResponseDto })
  me(@CurrentUser() user: AuthUser): UserResponseDto {
    return toUserResponse(user);
  }
}
