import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { WhatsappClient } from './whatsapp-client.js';

// Délai maximal d'un appel à Meta : au-delà, traité comme une erreur réseau
// (une nouvelle tentative).
const META_HTTP_TIMEOUT_MS = 10_000;

/** Envoi vers Meta uniquement : ne dépend ni du webhook ni du bot. */
@Module({
  imports: [HttpModule.register({ timeout: META_HTTP_TIMEOUT_MS })],
  providers: [WhatsappClient],
  exports: [WhatsappClient],
})
export class WhatsappClientModule {}
