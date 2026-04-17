import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from 'src/users/users.service';
import { UserRole } from './generated';

export interface JwtPayload {
  sub: string;
  email: string;
  role: UserRole;
}

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
  ) {}

  async register(
    email: string,
    password: string,
    name: string,
    role: UserRole = UserRole.RESIDENT,
    apartment?: string,
    block?: string,
    condominiumId?: string,
    condominiumName?: string,
    personalDocument?: string,
    vendorName?: string,
    vendorCategory?: string,
    vendorDescription?: string,
    vendorCnpj?: string,
    vendorCnae?: string,
    vendorLegalDocument?: string,
    vendorContactPhone?: string,
  ) {
    const user = await this.usersService.create(
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

    const fullUser = await this.usersService.findById(user.id);

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };

    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        condominiumId: user.condominiumId,
        condominiumName: (fullUser as any)?.condominium?.name ?? null,
        apartment: user.apartment,
        block: user.block,
        personalDocument: (fullUser as any)?.personalDocument ?? null,
        isVendor: user.role === UserRole.VENDOR,
        vendorId: (fullUser as any)?.vendorProfile?.id ?? null,
      },
    };
  }

  async login(email: string, password: string) {
    const user = await this.usersService.findByEmail(email);

    if (!user) {
      throw new UnauthorizedException('Email ou senha inválidos');
    }

    const isPasswordValid = await this.usersService.validatePassword(
      password,
      user.password,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException('Email ou senha inválidos');
    }

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };

    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        condominiumId: user.condominiumId,
        condominiumName: (user as any)?.condominium?.name ?? null,
        apartment: user.apartment,
        block: user.block,
        personalDocument: (user as any)?.personalDocument ?? null,
        isVendor: user.role === UserRole.VENDOR,
        vendorId: (user as any)?.vendorProfile?.id ?? null,
      },
    };
  }

  async validateToken(payload: JwtPayload) {
    const user = await this.usersService.findById(payload.sub);
    if (!user) {
      throw new UnauthorizedException('Usuário não encontrado');
    }
    return user;
  }
}

