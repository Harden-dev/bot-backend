import { applyDecorators } from '@nestjs/common';
import { ApiBearerAuth, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { ErrorResponseDto } from './error-response.dto.js';

/**
 * Route réservée à l'admin (JWT Bearer) dans Swagger. Les routes `@Public()`
 * (login, webhook, health) ne le portent pas.
 */
export const ApiAdminAuth = () =>
  applyDecorators(
    ApiBearerAuth(),
    ApiUnauthorizedResponse({
      type: ErrorResponseDto,
      description: 'Jeton absent, invalide ou expiré',
    }),
  );
