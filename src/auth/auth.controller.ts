import { Controller, Post, Body, BadRequestException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { UserRole } from 'src/generated';

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
      apartment,
      block,
      condominiumId,
      condominiumName,
      personalDocument,
      vendorName,
      vendorCategory,
      vendorDescription,
      vendorCnpj,
      vendorCnae,
      vendorLegalDocument,
      vendorContactPhone,
    } = body;

    if (!email || !password || !name) {
      throw new BadRequestException('Preencha email, senha e nome para continuar');
    }

    if ((role === UserRole.DELIVERY_PERSON || role === UserRole.VENDOR) && !condominiumId?.trim()) {
      throw new BadRequestException('Código do condomínio é obrigatório para esta conta');
    }

    if (role === UserRole.DELIVERY_PERSON && !personalDocument?.trim()) {
      throw new BadRequestException('Documento pessoal (RG/CPF) é obrigatório para entregadores');
    }

    if (role === UserRole.VENDOR) {
      if (!vendorName?.trim()) {
        throw new BadRequestException('Nome do comércio é obrigatório');
      }
      if (!vendorCnpj?.trim() || !vendorCnae?.trim() || !vendorLegalDocument?.trim()) {
        throw new BadRequestException('CNPJ, CNAE e documento do responsável são obrigatórios para comerciantes');
      }
    }

    return this.authService.register(
      email,
      password,
      name,
      role,
      apartment,
      block,
      condominiumId,
      condominiumName,
      personalDocument,
      vendorName,
      vendorCategory,
      vendorDescription,
      vendorCnpj,
      vendorCnae,
      vendorLegalDocument,
      vendorContactPhone,
    );
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

