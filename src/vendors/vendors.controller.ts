import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Request,
} from '@nestjs/common';
import { VendorsService } from './vendors.service';
import { JwtAuth } from 'src/auth/jwt-auth.guard';
import { OrderStatus } from '../generated/client';

@Controller('vendors')
export class VendorsController {
  constructor(private vendorsService: VendorsService) {}

  @Get('me')
  @JwtAuth()
  async getMyVendor(@Request() req: any) {
    return this.vendorsService.getMyVendor(req.user.id, req.user?.condominiumId);
  }

  @Patch('me')
  @JwtAuth()
  async updateMyVendor(@Request() req: any, @Body() body: any) {
    return this.vendorsService.updateMyVendor(req.user.id, req.user?.condominiumId, {
      name: body.name,
      description: body.description,
      category: body.category,
      imageUrl: body.imageUrl,
      bannerUrl: body.bannerUrl,
      aboutText: body.aboutText,
      contactPhone: body.contactPhone,
      estimatedTimeMinutes:
        body.estimatedTimeMinutes !== undefined ? Number(body.estimatedTimeMinutes) : undefined,
      minOrderValue: body.minOrderValue !== undefined ? Number(body.minOrderValue) : undefined,
    });
  }

  @Post('me/menu-items')
  @JwtAuth()
  async addMenuItem(@Request() req: any, @Body() body: any) {
    return this.vendorsService.addMenuItem(req.user.id, req.user?.condominiumId, {
      name: body.name,
      description: body.description,
      price: Number(body.price),
      category: body.category,
      imageUrl: body.imageUrl,
      available: body.available,
    });
  }

  @Patch('me/menu-items/:itemId')
  @JwtAuth()
  async updateMenuItem(@Request() req: any, @Param('itemId') itemId: string, @Body() body: any) {
    return this.vendorsService.updateMenuItem(req.user.id, req.user?.condominiumId, itemId, {
      name: body.name,
      description: body.description,
      price: body.price !== undefined ? Number(body.price) : undefined,
      category: body.category,
      imageUrl: body.imageUrl,
      available: body.available,
    });
  }

  @Delete('me/menu-items/:itemId')
  @JwtAuth()
  async deleteMenuItem(@Request() req: any, @Param('itemId') itemId: string) {
    return this.vendorsService.deleteMenuItem(req.user.id, req.user?.condominiumId, itemId);
  }

  @Get('me/orders')
  @JwtAuth()
  async getMyOrders(@Request() req: any) {
    return this.vendorsService.getMyOrders(req.user.id, req.user?.condominiumId, false);
  }

  @Get('me/orders/history')
  @JwtAuth()
  async getMyOrdersHistory(@Request() req: any) {
    return this.vendorsService.getMyOrders(req.user.id, req.user?.condominiumId, true);
  }

  @Patch('me/orders/:orderId/status')
  @JwtAuth()
  async updateMyOrderStatus(
    @Request() req: any,
    @Param('orderId') orderId: string,
    @Body() body: any,
  ) {
    return this.vendorsService.updateMyOrderStatus(
      req.user.id,
      req.user?.condominiumId,
      orderId,
      body.status as OrderStatus,
      body.pickupCode,
    );
  }

  @Patch('me/orders/:orderId/cancel')
  @JwtAuth()
  async cancelMyOrder(
    @Request() req: any,
    @Param('orderId') orderId: string,
    @Body() body: any,
  ) {
    return this.vendorsService.cancelMyOrder(
      req.user.id,
      req.user?.condominiumId,
      orderId,
      body.reason,
    );
  }

  @Get('me/orders/:orderId/messages')
  @JwtAuth()
  async getOrderMessages(@Request() req: any, @Param('orderId') orderId: string) {
    return this.vendorsService.getOrderMessages(req.user.id, req.user?.condominiumId, orderId);
  }

  @Post('me/orders/:orderId/messages')
  @JwtAuth()
  async sendOrderMessage(
    @Request() req: any,
    @Param('orderId') orderId: string,
    @Body() body: any,
  ) {
    return this.vendorsService.sendOrderMessage(
      req.user.id,
      req.user?.condominiumId,
      orderId,
      body.content,
    );
  }

  @Get('me/dashboard')
  @JwtAuth()
  async getDashboard(@Request() req: any) {
    return this.vendorsService.getDashboard(req.user.id, req.user?.condominiumId);
  }

  @Get()
  @JwtAuth()
  async findAll(@Request() req: any) {
    return this.vendorsService.findAll(req.user?.condominiumId);
  }

  @Post(':id/orders')
  @JwtAuth()
  async createOrderFromVendor(@Request() req: any, @Param('id') id: string, @Body() body: any) {
    return this.vendorsService.createOrderFromMenu(id, req.user, {
      items: body.items,
      notes: body.notes,
      apartment: body.apartment,
      block: body.block,
    });
  }

  @Get(':id')
  @JwtAuth()
  async findById(@Param('id') id: string) {
    return this.vendorsService.findById(id);
  }
}
