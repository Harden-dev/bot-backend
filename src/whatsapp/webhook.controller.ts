import {
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
  type RawBodyRequest,
} from '@nestjs/common';
import {
  ApiBody,
  ApiForbiddenResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { ErrorResponseDto, Public } from '../common/index.js';
import { WebhookService } from './webhook.service.js';

const SIGNATURE_HEADER = 'x-hub-signature-256';
const TEXT_PLAIN = 'text/plain; charset=utf-8';

@ApiTags('whatsapp')
@ApiForbiddenResponse({ type: ErrorResponseDto })
@Public()
@Controller('whatsapp/webhook')
export class WebhookController {
  constructor(private readonly webhookService: WebhookService) {}

  // Paramètres lus sans DTO : tout écart doit donner 403 (US-BOT-01), pas 400.
  @Get()
  @ApiOperation({
    summary: 'Vérification du webhook par Meta (public, jeton de vérification)',
  })
  @ApiQuery({ name: 'hub.mode', type: String, example: 'subscribe' })
  @ApiQuery({ name: 'hub.verify_token', type: String })
  @ApiQuery({ name: 'hub.challenge', type: String })
  @ApiOkResponse({
    description: 'Valeur de hub.challenge',
    content: { 'text/plain': { schema: { type: 'string' } } },
  })
  verify(
    @Query('hub.mode') mode: unknown,
    @Query('hub.verify_token') verifyToken: unknown,
    @Query('hub.challenge') challenge: unknown,
    @Res({ passthrough: true }) res: Response,
  ): string {
    const accepted = this.webhookService.verifySubscription({
      mode,
      verifyToken,
      challenge,
    });
    // Texte brut seulement pour le challenge : le refus 403 reste en JSON (I-03).
    res.type(TEXT_PLAIN);
    return accepted;
  }

  // Corps lu sur la requête : payload Meta validé à la main (PO-29), pas par DTO.
  @Post()
  @ApiOperation({
    summary: 'Notifications Meta (public, signature X-Hub-Signature-256)',
    description: 'Réponse 200 immédiate, traitement asynchrone.',
  })
  @ApiHeader({ name: SIGNATURE_HEADER, required: true })
  @ApiBody({
    description: 'Payload Meta (WhatsApp Cloud API)',
    schema: { type: 'object' },
  })
  @ApiOkResponse({ description: 'Notification journalisée' })
  @HttpCode(HttpStatus.OK)
  receive(
    @Req() req: RawBodyRequest<Request>,
    @Headers(SIGNATURE_HEADER) signature: string | undefined,
  ): Promise<void> {
    return this.webhookService.receive(
      req.rawBody,
      signature,
      req.body as unknown,
    );
  }
}
