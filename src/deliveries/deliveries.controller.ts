import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Param,
  UseGuards,
  Request,
  Query,
  ForbiddenException,
} from '@nestjs/common';
import { DeliveriesService } from './deliveries.service';
import { DeliveryStatus } from '../generated';
import { JwtAuth } from 'src/auth/jwt-auth.guard';

@Controller('deliveries')
export class DeliveriesController {
  constructor(private deliveriesService: DeliveriesService) {}

  @Post()
  @JwtAuth()
  async create(@Request() req: any, @Body() body: any) {
    const apartment = body.apartment || req.user.apartment;
    const block = body.block || req.user.block;
    const { description, notes } = body;
    return this.deliveriesService.create(
      req.user.id,
      apartment,
      block,
      description,
      notes,
    );
  }

  @Get()
  @JwtAuth()
  async findAll(
    @Request() req: any,
    @Query('status') status?: DeliveryStatus,
    @Query('deliveryPersonId') deliveryPersonId?: string,
  ) {
    return this.deliveriesService.findAll(
      req.user.id,
      req.user.role,
      status,
      deliveryPersonId,
      req.user.condominiumId,
    );
  }

  @Get('available')
  @JwtAuth()
  async getAvailableDeliveries(@Request() req: any) {
    if (req.user.role !== 'DELIVERY_PERSON') {
      throw new ForbiddenException('Apenas entregadores podem ver pedidos disponíveis');
    }
    return this.deliveriesService.getAvailableDeliveries(req.user.condominiumId);
  }

  @Get('my-deliveries')
  @JwtAuth()
  async getMyDeliveries(@Request() req: any) {
    if (req.user.role !== 'DELIVERY_PERSON') {
      throw new ForbiddenException('Apenas entregadores podem acessar suas entregas');
    }
    return this.deliveriesService.getDeliveryPersonDeliveries(
      req.user.id,
      req.user.condominiumId,
    );
  }

  @Get('history')
  @JwtAuth()
  async getHistory(@Request() req: any) {
    return this.deliveriesService.getHistory(
      req.user.id,
      req.user.role,
      req.user.condominiumId,
    );
  }

  @Get('stats')
  @JwtAuth()
  async getStats(@Request() req: any) {
    return this.deliveriesService.getStats(req.user.condominiumId);
  }

  @Get(':id')
  @JwtAuth()
  async findById(@Request() req: any, @Param('id') id: string) {
    return this.deliveriesService.findById(id, req.user.condominiumId);
  }

  @Patch(':id/accept')
  @JwtAuth()
  async acceptDelivery(@Param('id') id: string, @Request() req: any) {
    if (req.user.role !== 'DELIVERY_PERSON') {
      throw new ForbiddenException('Apenas entregadores podem aceitar pedidos');
    }
    return this.deliveriesService.acceptDelivery(
      id,
      req.user.id,
      req.user.condominiumId,
    );
  }

  @Patch(':id/status')
  @JwtAuth()
  async updateStatus(@Param('id') id: string, @Body() body: any, @Request() req: any) {
    const { status } = body;
    return this.deliveriesService.updateStatus(
      id,
      status,
      req.user.id,
      req.user.role,
      req.user.condominiumId,
    );
  }

  @Patch(':id/cancel')
  @JwtAuth()
  async cancelDelivery(@Param('id') id: string, @Request() req: any) {
    return this.deliveriesService.cancelDelivery(
      id,
      req.user.id,
      req.user.role,
      req.user.condominiumId,
    );
  }

  @Patch('cancel/:id')
  @JwtAuth()
  async cancelDeliveryCompat(@Param('id') id: string, @Request() req: any) {
    return this.deliveriesService.cancelDelivery(
      id,
      req.user.id,
      req.user.role,
      req.user.condominiumId,
    );
  }

  @Patch(':id/rate')
  @JwtAuth()
  async rateDelivery(@Param('id') id: string, @Request() req: any, @Body() body: any) {
    const { rating, comment } = body;
    return this.deliveriesService.rateDelivery(
      id,
      req.user.id,
      rating,
      comment,
      req.user.condominiumId,
    );
  }
}

