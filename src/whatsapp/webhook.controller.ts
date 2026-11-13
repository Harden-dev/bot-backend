import {
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  type RawBodyRequest,
} from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../common/index.js';
import { WebhookService } from './webhook.service.js';

const SIGNATURE_HEADER = 'x-hub-signature-256';

@Public()
@Controller('whatsapp/webhook')
export class WebhookController {
  constructor(private readonly webhookService: WebhookService) {}

  // Paramètres lus sans DTO : tout écart doit donner 403 (US-BOT-01), pas 400.
  @Get()
  @Header('Content-Type', 'text/plain; charset=utf-8')
  verify(
    @Query('hub.mode') mode: unknown,
    @Query('hub.verify_token') verifyToken: unknown,
    @Query('hub.challenge') challenge: unknown,
  ): string {
    return this.webhookService.verifySubscription({
      mode,
      verifyToken,
      challenge,
    });
  }

  // Corps lu sur la requête : payload Meta validé à la main (PO-29), pas par DTO.
  @Post()
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
