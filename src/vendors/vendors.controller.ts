import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ParseIdPipe } from '../common/index.js';
import { CreateVendorDto } from './dto/create-vendor.dto.js';
import { UpdateVendorDto } from './dto/update-vendor.dto.js';
import { VendorResponseDto } from './dto/vendor-response.dto.js';
import { VendorsService } from './vendors.service.js';

@Controller('vendors')
export class VendorsController {
  constructor(private readonly vendorsService: VendorsService) {}

  @Get()
  findAll(): Promise<VendorResponseDto[]> {
    return this.vendorsService.findAll();
  }

  @Post()
  create(@Body() dto: CreateVendorDto): Promise<VendorResponseDto> {
    return this.vendorsService.create(dto);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIdPipe) id: bigint,
    @Body() dto: UpdateVendorDto,
  ): Promise<VendorResponseDto> {
    return this.vendorsService.update(id, dto);
  }
}
