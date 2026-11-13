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
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  ApiAdminAuth,
  ErrorResponseDto,
  ParseIdPipe,
} from '../common/index.js';
import { BatchReceiptsDto } from './dto/batch-receipts.dto.js';
import { type ReceiptFile, ReceiptsService } from './receipts.service.js';

const PDF_CONTENT_TYPE = 'application/pdf';
// Reçus avec données personnelles : jamais mis en cache, type non deviné.
const CACHE_CONTROL = ['Cache-Control', 'no-store'] as const;
const NO_SNIFF = ['X-Content-Type-Options', 'nosniff'] as const;
const PDF_RESPONSE = {
  description: 'Document PDF (un reçu par page)',
  content: {
    [PDF_CONTENT_TYPE]: { schema: { type: 'string', format: 'binary' } },
  },
};

function toPdfResponse({ content, filename }: ReceiptFile): StreamableFile {
  return new StreamableFile(content, {
    type: PDF_CONTENT_TYPE,
    disposition: `inline; filename="${filename}"`,
    length: content.length,
  });
}

@ApiTags('receipts')
@ApiAdminAuth()
@ApiBadRequestResponse({ type: ErrorResponseDto })
@ApiNotFoundResponse({
  type: ErrorResponseDto,
  description: 'Commande introuvable',
})
@Controller('receipts')
export class ReceiptsController {
  constructor(private readonly receiptsService: ReceiptsService) {}

  @Get(':orderId')
  @ApiOperation({ summary: 'Reçu PDF d’une commande' })
  @ApiOkResponse(PDF_RESPONSE)
  @Header(...CACHE_CONTROL)
  @Header(...NO_SNIFF)
  async findOne(
    @Param('orderId', ParseIdPipe) orderId: bigint,
  ): Promise<StreamableFile> {
    return toPdfResponse(await this.receiptsService.generateOne(orderId));
  }

  /** Génère un document sans rien créer : `200`. */
  @Post('batch')
  @ApiOperation({ summary: 'Reçus groupés : 1 à 100 commandes, un PDF' })
  @ApiOkResponse(PDF_RESPONSE)
  @HttpCode(HttpStatus.OK)
  @Header(...CACHE_CONTROL)
  @Header(...NO_SNIFF)
  async batch(@Body() dto: BatchReceiptsDto): Promise<StreamableFile> {
    return toPdfResponse(
      await this.receiptsService.generateBatch(dto.orderIds),
    );
  }
}
