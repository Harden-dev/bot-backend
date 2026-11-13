import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/index.js';
import { VendorsModule } from '../vendors/index.js';
import { WhatsappClientModule } from '../whatsapp/client/index.js';
import { BotService } from './bot.service.js';
import { DraftsCleanup } from './drafts.cleanup.js';
import { DraftsService } from './drafts.service.js';

/** Bot : `bot` -> `orders`, `vendors`, `whatsapp/client` (sans cycle). */
@Module({
  imports: [OrdersModule, VendorsModule, WhatsappClientModule],
  providers: [BotService, DraftsService, DraftsCleanup],
  exports: [BotService],
})
export class BotModule {}
