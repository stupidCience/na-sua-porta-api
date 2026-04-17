import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Request,
} from '@nestjs/common';
import { JwtAuth } from '../auth/jwt-auth.guard';
import { OrdersService } from './orders.service';

@Controller()
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post('orders')
  @JwtAuth()
  async createOrder(@Request() req: any, @Body() body: any) {
    return this.ordersService.createOrderByUser(req.user, {
      customerName: body.customerName,
      apartment: body.apartment,
      block: body.block,
      description: body.description,
      vendorId: body.vendorId,
      vendorName: body.vendorName,
      paymentStatus: body.paymentStatus,
      source: 'app',
    });
  }

  @Get('orders')
  @JwtAuth()
  async listOrders(@Request() req: any) {
    return this.ordersService.findAll(
      req.user.id,
      req.user.role,
      req.user.condominiumId,
    );
  }

  @Get('orders/chats')
  @JwtAuth()
  async listChats(@Request() req: any) {
    return this.ordersService.getChats(
      req.user.id,
      req.user.role,
      req.user.condominiumId,
    );
  }

  @Get('orders/:id')
  @JwtAuth()
  async getOrderById(@Request() req: any, @Param('id') id: string) {
    return this.ordersService.findById(
      id,
      req.user.id,
      req.user.role,
      req.user.condominiumId,
    );
  }

  @Get('orders/:id/messages')
  @JwtAuth()
  async getOrderMessages(
    @Request() req: any,
    @Param('id') id: string,
    @Query('kind') kind?: string,
  ) {
    return this.ordersService.getMessages(
      id,
      req.user.id,
      req.user.role,
      req.user.condominiumId,
      kind,
    );
  }

  @Post('orders/:id/messages')
  @JwtAuth()
  async sendOrderMessage(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: any,
    @Query('kind') kind?: string,
  ) {
    return this.ordersService.sendMessage(
      id,
      req.user.id,
      req.user.role,
      req.user.condominiumId,
      body.content,
      kind,
    );
  }

  @Post('external/orders')
  async createExternalOrder(@Body() body: any) {
    return this.ordersService.createExternalOrder({
      name: body.name,
      apartment: body.apartment,
      description: body.description,
      block: body.block,
    });
  }
}
