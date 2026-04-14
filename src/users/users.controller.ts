import {
  Controller,
  Get,
  Patch,
  Body,
  Param,
  Request,
  ForbiddenException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { JwtAuth } from 'src/auth/jwt-auth.guard';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get('me')
  @JwtAuth()
  async getMe(@Request() req: any) {
    const user = await this.usersService.findById(req.user.id);
    if (!user) throw new NotFoundException('Usuário não encontrado');
    const { password, ...safe } = user as any;
    return safe;
  }

  @Patch('me')
  @JwtAuth()
  async updateMe(@Request() req: any, @Body() body: any) {
    const { name, phone, apartment, block, vehicleInfo, personalDocument } = body;
    const updated = await this.usersService.updateProfile(req.user.id, {
      name,
      phone,
      apartment,
      block,
      vehicleInfo,
      personalDocument,
    });
    const { password, ...safe } = updated as any;
    return safe;
  }

  @Patch('me/documents')
  @JwtAuth()
  async updateDocuments(@Request() req: any, @Body() body: any) {
    const { personalDocument, vendorCnpj, vendorCnae, vendorLegalDocument } = body;
    const updated = await this.usersService.updateDocuments(req.user.id, {
      personalDocument,
      vendorCnpj,
      vendorCnae,
      vendorLegalDocument,
    });
    const { password, ...safe } = updated as any;
    return safe;
  }

  @Patch('me/condominium')
  @JwtAuth()
  async linkCondominium(@Request() req: any, @Body() body: any) {
    const { condominiumId } = body;
    if (!condominiumId || typeof condominiumId !== 'string') {
      throw new BadRequestException('Informe o código do condomínio');
    }

    const updated = await this.usersService.linkToCondominium(req.user.id, condominiumId);
    const { password, ...safe } = updated as any;
    return safe;
  }

  @Patch('me/password')
  @JwtAuth()
  async changePassword(@Request() req: any, @Body() body: any) {
    const { currentPassword, newPassword } = body;
    if (!currentPassword || !newPassword) {
      throw new BadRequestException('Senha atual e nova senha são obrigatórias');
    }
    if (newPassword.length < 6) {
      throw new BadRequestException('A nova senha deve ter pelo menos 6 caracteres');
    }
    await this.usersService.changePassword(req.user.id, currentPassword, newPassword);
    return { message: 'Senha alterada com sucesso' };
  }

  @Get('condominium')
  @JwtAuth()
  async getCondominiumUsers(@Request() req: any) {
    if (req.user.role !== 'CONDOMINIUM_ADMIN') {
      throw new ForbiddenException('Acesso restrito a administradores');
    }
    if (!req.user.condominiumId) {
      throw new BadRequestException('Nenhum condomínio vinculado a esta conta');
    }
    return this.usersService.listCondominiumUsers(req.user.condominiumId);
  }

  @Patch(':id/status')
  @JwtAuth()
  async toggleStatus(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    if (req.user.role !== 'CONDOMINIUM_ADMIN') {
      throw new ForbiddenException('Acesso restrito a administradores');
    }
    if (typeof body.active !== 'boolean') {
      throw new BadRequestException('Campo "active" deve ser verdadeiro ou falso');
    }
    return this.usersService.toggleUserStatus(id, body.active);
  }
}
