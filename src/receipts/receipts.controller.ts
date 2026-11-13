import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  StreamableFile,
} from '@nestjs/common';
import { ParseIdPipe } from '../common/index.js';
import { BatchReceiptsDto } from './dto/batch-receipts.dto.js';
import { type ReceiptFile, ReceiptsService } from './receipts.service.js';

const PDF_CONTENT_TYPE = 'application/pdf';
// Reçus avec données personnelles : jamais mis en cache, type non deviné.
const CACHE_CONTROL = ['Cache-Control', 'no-store'] as const;
const NO_SNIFF = ['X-Content-Type-Options', 'nosniff'] as const;

function toPdfResponse({ content, filename }: ReceiptFile): StreamableFile {
  return new StreamableFile(content, {
    type: PDF_CONTENT_TYPE,
    disposition: `inline; filename="${filename}"`,
    length: content.length,
  });
}

@Controller('receipts')
export class ReceiptsController {
  constructor(private readonly receiptsService: ReceiptsService) {}

  @Get(':orderId')
  @Header(...CACHE_CONTROL)
  @Header(...NO_SNIFF)
  async findOne(
    @Param('orderId', ParseIdPipe) orderId: bigint,
  ): Promise<StreamableFile> {
    return toPdfResponse(await this.receiptsService.generateOne(orderId));
  }

  /** Génère un document sans rien créer : `200`. */
  @Post('batch')
  @HttpCode(HttpStatus.OK)
  @Header(...CACHE_CONTROL)
  @Header(...NO_SNIFF)
  async batch(@Body() dto: BatchReceiptsDto): Promise<StreamableFile> {
    return toPdfResponse(
      await this.receiptsService.generateBatch(dto.orderIds),
    );
  }
}
