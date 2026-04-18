import { Controller, Post, Body, BadRequestException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { UserRole } from '../generated/client';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('register')
  async register(@Body() body: any) {
    const {
      email,
      password,
      name,
      role = UserRole.RESIDENT,
      phone,
      apartment,
      block,
      condominiumId,
      condominiumCode,
      condominiumAccessCode,
      condominiumName,
      personalDocument,
      residenceDocument,
      communicationsConsent,
      vendorName,
      vendorCategory,
      vendorDescription,
      vendorCnpj,
      vendorCnae,
      vendorLegalDocument,
      vendorContactPhone,
    } = body;

    if (!email || !password || !name) {
      throw new BadRequestException(
        'Preencha email, senha e nome para continuar',
      );
    }

    if (role === UserRole.DELIVERY_PERSON || role === UserRole.VENDOR) {
      throw new BadRequestException(
        'Cadastros de entregador e comerciante agora sao habilitados dentro da conta do morador, na area de configuracoes.',
      );
    }

    if (role === UserRole.RESIDENT && !phone?.trim()) {
      throw new BadRequestException(
        'Telefone ou WhatsApp é obrigatório para moradores',
      );
    }

    if (role === UserRole.RESIDENT && communicationsConsent !== true) {
      throw new BadRequestException(
        'Você precisa autorizar comunicações para concluir o cadastro',
      );
    }

    return this.authService.register({
      email,
      password,
      name,
      role,
      phone,
      apartment,
      block,
      condominiumId,
      condominiumAccessCode:
        condominiumAccessCode || condominiumCode || condominiumId,
      condominiumName,
      personalDocument,
      residenceDocument,
      communicationsConsent,
      vendorName,
      vendorCategory,
      vendorDescription,
      vendorCnpj,
      vendorCnae,
      vendorLegalDocument,
      vendorContactPhone,
    });
  }

  @Post('login')
  async login(@Body() body: any) {
    const { email, password } = body;

    if (!email || !password) {
      throw new BadRequestException('Email e senha são obrigatórios');
    }

    return this.authService.login(email, password);
  }
}
