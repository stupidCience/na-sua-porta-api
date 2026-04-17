import {
  Controller,
  Get,
  Patch,
  Body,
  Request,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { JwtAuth } from 'src/auth/jwt-auth.guard';
import { CondominiumsService } from './condominiums.service';

@Controller('condominiums')
export class CondominiumsController {
  constructor(private condominiumsService: CondominiumsService) {}

  @Get('me')
  @JwtAuth()
  async getMe(@Request() req: any) {
    if (req.user.role !== 'CONDOMINIUM_ADMIN') {
      throw new ForbiddenException('Acesso restrito a administradores');
    }
    if (!req.user.condominiumId) {
      throw new BadRequestException('Nenhum condomínio vinculado a esta conta');
    }
    return this.condominiumsService.getMyCondominium(req.user.condominiumId);
  }

  @Patch('me')
  @JwtAuth()
  async updateMe(@Request() req: any, @Body() body: any) {
    if (req.user.role !== 'CONDOMINIUM_ADMIN') {
      throw new ForbiddenException('Acesso restrito a administradores');
    }
    if (!req.user.condominiumId) {
      throw new BadRequestException('Nenhum condomínio vinculado a esta conta');
    }
    const { name, address, operatingHours, maxActiveDeliveries } = body;
    return this.condominiumsService.updateMyCondominium(
      req.user.condominiumId,
      {
        name,
        address,
        operatingHours,
        maxActiveDeliveries:
          maxActiveDeliveries !== undefined
            ? Number(maxActiveDeliveries)
            : undefined,
      },
    );
  }
}
