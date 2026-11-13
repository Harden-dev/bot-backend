import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  ApiAdminAuth,
  CurrentUser,
  ErrorResponseDto,
  type PageResponse,
  ParseIdPipe,
} from '../common/index.js';
import type { User } from '../generated/prisma/client.js';
import { ChangeStatusDto } from './dto/change-status.dto.js';
import { ListOrdersQueryDto } from './dto/list-orders.query.dto.js';
import {
  OrderCountsDto,
  OrderDetailDto,
  OrderPageDto,
  type OrderSummaryDto,
} from './dto/order-response.dto.js';
import { UpdateOrderDto } from './dto/update-order.dto.js';
import { OrdersService } from './orders.service.js';

@ApiTags('orders')
@ApiAdminAuth()
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  @ApiOperation({ summary: 'Liste filtrable et paginée des commandes' })
  @ApiOkResponse({ type: OrderPageDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  findAll(
    @Query() query: ListOrdersQueryDto,
  ): Promise<PageResponse<OrderSummaryDto>> {
    return this.ordersService.findAll(query);
  }

  @Get('counts')
  @ApiOperation({ summary: 'Nombre de commandes par statut' })
  @ApiOkResponse({ type: OrderCountsDto })
  counts(): Promise<OrderCountsDto> {
    return this.ordersService.counts();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Détail : articles, vendeur, historique' })
  @ApiOkResponse({ type: OrderDetailDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  findOne(@Param('id', ParseIdPipe) id: bigint): Promise<OrderDetailDto> {
    return this.ordersService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Corriger une commande (non traitée ou validée)',
  })
  @ApiOkResponse({ type: OrderDetailDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'Commande ni non traitée ni validée',
  })
  update(
    @Param('id', ParseIdPipe) id: bigint,
    @Body() dto: UpdateOrderDto,
  ): Promise<OrderDetailDto> {
    return this.ordersService.update(id, dto);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Changer le statut (historique tracé)' })
  @ApiOkResponse({ type: OrderDetailDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'Transition de statut non autorisée',
  })
  changeStatus(
    @Param('id', ParseIdPipe) id: bigint,
    @Body() dto: ChangeStatusDto,
    @CurrentUser() user: Pick<User, 'id'>,
  ): Promise<OrderDetailDto> {
    return this.ordersService.changeStatus(id, dto, user.id);
  }
}
