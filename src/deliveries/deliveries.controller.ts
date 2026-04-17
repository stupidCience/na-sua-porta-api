import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Param,
  Request,
  Query,
  Res,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { Response } from 'express';
import { DeliveriesService } from './deliveries.service';
import { DeliveryStatus } from '../generated/client';
import { JwtAuth } from 'src/auth/jwt-auth.guard';

@Controller('deliveries')
export class DeliveriesController {
  constructor(private deliveriesService: DeliveriesService) {}

  private ensureCondominiumLinked(req: any) {
    if (!req.user?.condominiumId) {
      throw new BadRequestException(
        'Conta sem condomínio vinculado. Use a aba "Vínculo Condomínio" no perfil para continuar.',
      );
    }
  }

  @Post()
  @JwtAuth()
  async create(@Request() req: any, @Body() body: any) {
    if (req.user.role !== 'RESIDENT') {
      throw new ForbiddenException('Apenas moradores podem criar pedidos');
    }
    this.ensureCondominiumLinked(req);

    const apartment = body.apartment || req.user.apartment;
    const block = body.block || req.user.block;
    const { description, notes, externalPlatform, externalCode } = body;

    if (!apartment || !block) {
      throw new BadRequestException('Apartamento e bloco são obrigatórios para criar pedido');
    }

    return this.deliveriesService.create(
      req.user.id,
      apartment,
      block,
      description,
      notes,
      undefined,
      externalPlatform,
      externalCode,
    );
  }

  @Get()
  @JwtAuth()
  async findAll(
    @Request() req: any,
    @Query('status') status?: DeliveryStatus,
    @Query('deliveryPersonId') deliveryPersonId?: string,
  ) {
    if (req.user.role === 'DELIVERY_PERSON') {
      this.ensureCondominiumLinked(req);
    }

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
    this.ensureCondominiumLinked(req);

    return this.deliveriesService.getAvailableDeliveries(req.user.condominiumId);
  }

  @Get('my-deliveries')
  @JwtAuth()
  async getMyDeliveries(@Request() req: any) {
    if (req.user.role !== 'DELIVERY_PERSON') {
      throw new ForbiddenException('Apenas entregadores podem acessar suas entregas');
    }
    this.ensureCondominiumLinked(req);

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
    return this.deliveriesService.getStats(
      req.user.id,
      req.user.role,
      req.user.condominiumId,
    );
  }

  @Get('admin/overview')
  @JwtAuth()
  async getAdminOverview(@Request() req: any) {
    if (req.user.role !== 'CONDOMINIUM_ADMIN') {
      throw new ForbiddenException('Apenas administradores do condomínio podem acessar este painel');
    }

    return this.deliveriesService.getAdminOverview(req.user.condominiumId);
  }

  @Get('export')
  @JwtAuth()
  async exportCsv(@Request() req: any, @Res() res: Response) {
    if (req.user.role !== 'CONDOMINIUM_ADMIN') {
      throw new ForbiddenException('Acesso restrito a administradores');
    }
    if (!req.user.condominiumId) {
      throw new BadRequestException('Nenhum condomínio vinculado à conta');
    }
    const csv = await this.deliveriesService.exportCsv(req.user.condominiumId);
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="entregas-${date}.csv"`);
    res.send('\uFEFF' + csv); // BOM prefix for Excel compatibility
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
    this.ensureCondominiumLinked(req);

    return this.deliveriesService.acceptDelivery(
      id,
      req.user.id,
      req.user.condominiumId,
    );
  }

  @Patch(':id/status')
  @JwtAuth()
  async updateStatus(@Param('id') id: string, @Body() body: any, @Request() req: any) {
    const { status, deliveryCode } = body;

    if (!status || !Object.values(DeliveryStatus).includes(status)) {
      throw new BadRequestException('Status inválido para atualização');
    }

    if (req.user.role === 'DELIVERY_PERSON') {
      this.ensureCondominiumLinked(req);
    }

    return this.deliveriesService.updateStatus(
      id,
      status,
      req.user.id,
      req.user.role,
      deliveryCode,
      req.user.condominiumId,
    );
  }

  @Patch(':id/cancel')
  @JwtAuth()
  async cancelDelivery(@Param('id') id: string, @Request() req: any) {
    if (req.user.role === 'DELIVERY_PERSON') {
      this.ensureCondominiumLinked(req);
    }

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
    if (req.user.role === 'DELIVERY_PERSON') {
      this.ensureCondominiumLinked(req);
    }

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

    if (typeof rating !== 'number') {
      throw new BadRequestException('A avaliação deve ser um número de 1 a 5');
    }

    return this.deliveriesService.rateDelivery(
      id,
      req.user.id,
      rating,
      comment,
      req.user.condominiumId,
    );
  }
}

