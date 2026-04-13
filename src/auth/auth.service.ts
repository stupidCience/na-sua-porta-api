import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from 'src/users/users.service';
import { UserRole } from '../generated';

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
  ) {
    const user = await this.usersService.create(
      email,
      password,
      name,
      role,
      apartment,
      block,
    );

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
        apartment: user.apartment,
        block: user.block,
      },
    };
  }

  async login(email: string, password: string) {
    const user = await this.usersService.findByEmail(email);

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await this.usersService.validatePassword(
      password,
      user.password,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
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
        apartment: user.apartment,
        block: user.block,
      },
    };
  }

  async validateToken(payload: JwtPayload) {
    const user = await this.usersService.findById(payload.sub);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    return user;
  }
}

