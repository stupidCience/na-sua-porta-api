import {
  Controller,
  Get,
  Patch,
  Body,
  Param,
  Request,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { JwtAuth } from '../auth/jwt-auth.guard';
import { ResidentVerificationStatus, UserRole } from '../generated/client';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  private parseRequestedModule(value: unknown): UserRole {
    const normalized = String(value ?? '')
      .trim()
      .toUpperCase();

    if (!Object.values(UserRole).includes(normalized as UserRole)) {
      throw new BadRequestException('Modulo informado e invalido');
    }

    return normalized as UserRole;
  }

  private parseResidentVerificationStatus(
    value: unknown,
  ): ResidentVerificationStatus {
    const normalized = String(value ?? '')
      .trim()
      .toUpperCase();

    if (
      !Object.values(ResidentVerificationStatus).includes(
        normalized as ResidentVerificationStatus,
      )
    ) {
      throw new BadRequestException('Status de revisão inválido');
    }

    return normalized as ResidentVerificationStatus;
  }

  @Get('me')
  @JwtAuth()
  async getMe(@Request() req: any) {
    return this.usersService.getSafeUserById(req.user.id);
  }

  @Get('me/modules')
  @JwtAuth()
  async getMyModules(@Request() req: any) {
    return this.usersService.getAccountModules(req.user.id);
  }

  @Patch('me/modules/active')
  @JwtAuth()
  async switchActiveModule(@Request() req: any, @Body() body: any) {
    const module = this.parseRequestedModule(body.module ?? body.role);

    return this.usersService.switchActiveModule(req.user.id, module);
  }

  @Patch('me/modules/activate')
  @JwtAuth()
  async activateModule(@Request() req: any, @Body() body: any) {
    const module = this.parseRequestedModule(body.module ?? body.role);

    return this.usersService.activateModule(req.user.id, module, {
      phone: body.phone,
      apartment: body.apartment,
      block: body.block,
      communicationsConsent: body.communicationsConsent,
      personalDocument: body.personalDocument,
      residenceDocument: body.residenceDocument,
      vehicleInfo: body.vehicleInfo,
      condominiumCode: body.condominiumCode ?? body.condominiumId,
      vendorName: body.vendorName,
      vendorCategory: body.vendorCategory,
      vendorDescription: body.vendorDescription,
      vendorCnpj: body.vendorCnpj,
      vendorCnae: body.vendorCnae,
      vendorLegalDocument: body.vendorLegalDocument,
      vendorContactPhone: body.vendorContactPhone,
    });
  }

  @Patch('me')
  @JwtAuth()
  async updateMe(@Request() req: any, @Body() body: any) {
    const {
      name,
      phone,
      apartment,
      block,
      vehicleInfo,
      personalDocument,
      residenceDocument,
      communicationsConsent,
    } = body;
    const updated = await this.usersService.updateProfile(req.user.id, {
      name,
      phone,
      apartment,
      block,
      vehicleInfo,
      personalDocument,
      residenceDocument,
      communicationsConsent,
    });
    return this.usersService.buildSafeUserResponse(updated);
  }

  @Patch('me/documents')
  @JwtAuth()
  async updateDocuments(@Request() req: any, @Body() body: any) {
    const { personalDocument, vendorCnpj, vendorCnae, vendorLegalDocument } =
      body;
    const updated = await this.usersService.updateDocuments(req.user.id, {
      personalDocument,
      vendorCnpj,
      vendorCnae,
      vendorLegalDocument,
    });
    return this.usersService.buildSafeUserResponse(updated);
  }

  @Patch('me/condominium')
  @JwtAuth()
  async linkCondominium(@Request() req: any, @Body() body: any) {
    const condominiumCode = body.condominiumCode || body.condominiumId;
    if (!condominiumCode || typeof condominiumCode !== 'string') {
      throw new BadRequestException('Informe o código de acesso do condomínio');
    }

    const updated = await this.usersService.linkToCondominium(
      req.user.id,
      condominiumCode,
    );
    return this.usersService.buildSafeUserResponse(updated);
  }

  @Patch('me/password')
  @JwtAuth()
  async changePassword(@Request() req: any, @Body() body: any) {
    const { currentPassword, newPassword } = body;
    if (!currentPassword || !newPassword) {
      throw new BadRequestException(
        'Senha atual e nova senha são obrigatórias',
      );
    }
    if (newPassword.length < 6) {
      throw new BadRequestException(
        'A nova senha deve ter pelo menos 6 caracteres',
      );
    }
    await this.usersService.changePassword(
      req.user.id,
      currentPassword,
      newPassword,
    );
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
      throw new BadRequestException(
        'Campo "active" deve ser verdadeiro ou falso',
      );
    }
    return this.usersService.toggleUserStatus(id, body.active);
  }

  @Patch(':id/resident-verification')
  @JwtAuth()
  async reviewResidentVerification(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    if (req.user.role !== 'CONDOMINIUM_ADMIN') {
      throw new ForbiddenException('Acesso restrito a administradores');
    }

    if (!req.user.condominiumId) {
      throw new BadRequestException('Nenhum condomínio vinculado a esta conta');
    }

    const status = this.parseResidentVerificationStatus(body.status);

    return this.usersService.reviewResidentVerification(
      req.user.condominiumId,
      id,
      status,
    );
  }
}
