import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import {
  CurrentUser,
  type PageResponse,
  ParseIdPipe,
} from '../common/index.js';
import type { User } from '../generated/prisma/client.js';
import { ChangeStatusDto } from './dto/change-status.dto.js';
import { ListOrdersQueryDto } from './dto/list-orders.query.dto.js';
import type {
  OrderCountsDto,
  OrderDetailDto,
  OrderSummaryDto,
} from './dto/order-response.dto.js';
import { UpdateOrderDto } from './dto/update-order.dto.js';
import { OrdersService } from './orders.service.js';

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  findAll(
    @Query() query: ListOrdersQueryDto,
  ): Promise<PageResponse<OrderSummaryDto>> {
    return this.ordersService.findAll(query);
  }

  @Get('counts')
  counts(): Promise<OrderCountsDto> {
    return this.ordersService.counts();
  }

  @Get(':id')
  findOne(@Param('id', ParseIdPipe) id: bigint): Promise<OrderDetailDto> {
    return this.ordersService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIdPipe) id: bigint,
    @Body() dto: UpdateOrderDto,
  ): Promise<OrderDetailDto> {
    return this.ordersService.update(id, dto);
  }

  @Patch(':id/status')
  changeStatus(
    @Param('id', ParseIdPipe) id: bigint,
    @Body() dto: ChangeStatusDto,
    @CurrentUser() user: Pick<User, 'id'>,
  ): Promise<OrderDetailDto> {
    return this.ordersService.changeStatus(id, dto, user.id);
  }
}
