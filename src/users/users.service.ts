import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { User, UserRole } from '../generated';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async create(
    email: string,
    password: string,
    name: string,
    role: UserRole = UserRole.RESIDENT,
    apartment?: string,
    block?: string,
  ): Promise<User> {
    // Check if user already exists
    const existingUser = await this.prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      throw new BadRequestException('User already exists');
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    return this.prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name,
        role,
        apartment,
        block,
      },
    });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { email },
    });
  }

  async findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { id },
    });
  }

  async validatePassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  async getDeliveryPersons(): Promise<User[]> {
    return this.prisma.user.findMany({
      where: {
        role: UserRole.DELIVERY_PERSON,
        active: true,
      },
    });
  }

  async findAll(): Promise<User[]> {
    return this.prisma.user.findMany();
  }
}

