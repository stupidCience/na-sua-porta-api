import { Controller, Post, Body, BadRequestException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { UserRole } from '../generated';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('register')
  async register(@Body() body: any) {
    const { email, password, name, role = UserRole.RESIDENT, apartment, block } = body;

    if (!email || !password || !name) {
      throw new BadRequestException('Missing required fields');
    }

    return this.authService.register(
      email,
      password,
      name,
      role,
      apartment,
      block,
    );
  }

  @Post('login')
  async login(@Body() body: any) {
    const { email, password } = body;

    if (!email || !password) {
      throw new BadRequestException('Email and password are required');
    }

    return this.authService.login(email, password);
  }
}

