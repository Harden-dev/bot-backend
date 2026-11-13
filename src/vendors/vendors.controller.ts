import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
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
import { CreateVendorDto } from './dto/create-vendor.dto.js';
import { UpdateVendorDto } from './dto/update-vendor.dto.js';
import { VendorResponseDto } from './dto/vendor-response.dto.js';
import { VendorsService } from './vendors.service.js';

const DUPLICATE_NUMBER_DESCRIPTION = 'Numéro WhatsApp déjà attribué';

@ApiTags('vendors')
@ApiAdminAuth()
@Controller('vendors')
export class VendorsController {
  constructor(private readonly vendorsService: VendorsService) {}

  @Get()
  @ApiOperation({ summary: 'Liste des vendeurs' })
  @ApiOkResponse({ type: [VendorResponseDto] })
  findAll(): Promise<VendorResponseDto[]> {
    return this.vendorsService.findAll();
  }

  @Post()
  @ApiOperation({ summary: 'Créer un vendeur (actif)' })
  @ApiCreatedResponse({ type: VendorResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: DUPLICATE_NUMBER_DESCRIPTION,
  })
  create(@Body() dto: CreateVendorDto): Promise<VendorResponseDto> {
    return this.vendorsService.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Modifier, désactiver ou réactiver un vendeur' })
  @ApiOkResponse({ type: VendorResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: DUPLICATE_NUMBER_DESCRIPTION,
  })
  update(
    @Param('id', ParseIdPipe) id: bigint,
    @Body() dto: UpdateVendorDto,
  ): Promise<VendorResponseDto> {
    return this.vendorsService.update(id, dto);
  }
}
