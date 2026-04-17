import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { User, UserRole, VendorType } from '../generated/client';
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
  ): Promise<User> {
    // Check if user already exists
    const existingUser = await this.prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      throw new BadRequestException('Já existe uma conta com este email');
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    let resolvedCondominiumId = condominiumId;

    if (role === UserRole.CONDOMINIUM_ADMIN) {
      if (!resolvedCondominiumId) {
        const createdCondominium = await this.prisma.condominium.create({
          data: {
            name: condominiumName?.trim() || `Condomínio de ${name}`,
          },
        });
        resolvedCondominiumId = createdCondominium.id;
      }
    } else if (!resolvedCondominiumId && role === UserRole.RESIDENT) {
      const firstActiveCondominium = await this.prisma.condominium.findFirst({
        where: { active: true },
        select: { id: true },
      });
      resolvedCondominiumId = firstActiveCondominium?.id;
    }

    if ((role === UserRole.DELIVERY_PERSON || role === UserRole.VENDOR) && !resolvedCondominiumId?.trim()) {
      throw new BadRequestException('Código do condomínio é obrigatório para este tipo de conta');
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

    if (resolvedCondominiumId) {
      const condominium = await this.prisma.condominium.findUnique({
        where: { id: resolvedCondominiumId },
        select: { id: true, active: true },
      });

      if (!condominium || !condominium.active) {
        throw new BadRequestException('Condomínio informado não está disponível');
      }
    }

    const createdUser = await this.prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name,
        role,
        apartment,
        block,
        personalDocument: personalDocument?.trim() || null,
        condominiumId: resolvedCondominiumId,
      },
    });

    if (role === UserRole.VENDOR) {
      await this.prisma.vendor.create({
        data: {
          name: vendorName!.trim(),
          category: vendorCategory?.trim() || 'Comércio',
          description: vendorDescription?.trim() || null,
          contactPhone: vendorContactPhone?.trim() || null,
          cnpj: vendorCnpj?.trim() || null,
          cnae: vendorCnae?.trim() || null,
          legalRepresentativeDocument: vendorLegalDocument?.trim() || null,
          type: VendorType.RESIDENT,
          active: true,
          condominiumId: resolvedCondominiumId,
          userId: createdUser.id,
          rating: 5,
          estimatedTimeMinutes: 30,
          minOrderValue: 0,
        },
      });
    }

    return createdUser;
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { email },
      include: {
        condominium: {
          select: { id: true, name: true },
        },
        vendorProfile: {
          select: { id: true, name: true, category: true, active: true },
        },
      },
    });
  }

  async findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { id },
      include: {
        condominium: {
          select: { id: true, name: true },
        },
        vendorProfile: {
          select: { id: true, name: true, category: true, active: true },
        },
      },
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

  async updateProfile(
    userId: string,
    data: {
      name?: string;
      phone?: string;
      apartment?: string;
      block?: string;
      vehicleInfo?: string;
      personalDocument?: string;
    },
  ): Promise<User> {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(data.name !== undefined && { name: data.name.trim() }),
        ...(data.phone !== undefined && { phone: data.phone.trim() || null }),
        ...(data.apartment !== undefined && { apartment: data.apartment.trim() || null }),
        ...(data.block !== undefined && { block: data.block.trim() || null }),
        ...(data.vehicleInfo !== undefined && { vehicleInfo: data.vehicleInfo.trim() || null }),
        ...(data.personalDocument !== undefined && { personalDocument: data.personalDocument.trim() || null }),
      },
      include: {
        condominium: { select: { id: true, name: true } },
      },
    });
  }

  async updateDocuments(
    userId: string,
    data: {
      personalDocument?: string;
      vendorCnpj?: string;
      vendorCnae?: string;
      vendorLegalDocument?: string;
    },
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { vendorProfile: true },
    });

    if (!user) {
      throw new NotFoundException('Usuário não encontrado');
    }

    if (user.role === UserRole.DELIVERY_PERSON && !data.personalDocument?.trim()) {
      throw new BadRequestException('Documento pessoal (RG/CPF) é obrigatório para entregadores');
    }

    if (user.role === UserRole.VENDOR) {
      const cnpj = data.vendorCnpj?.trim() || user.vendorProfile?.cnpj;
      const cnae = data.vendorCnae?.trim() || user.vendorProfile?.cnae;
      const legalDoc = data.vendorLegalDocument?.trim() || user.vendorProfile?.legalRepresentativeDocument;
      if (!cnpj || !cnae || !legalDoc) {
        throw new BadRequestException('CNPJ, CNAE e documento do responsável são obrigatórios para comerciantes');
      }

      if (user.vendorProfile) {
        await this.prisma.vendor.update({
          where: { id: user.vendorProfile.id },
          data: {
            ...(data.vendorCnpj !== undefined && { cnpj: data.vendorCnpj.trim() || null }),
            ...(data.vendorCnae !== undefined && { cnae: data.vendorCnae.trim() || null }),
            ...(data.vendorLegalDocument !== undefined && {
              legalRepresentativeDocument: data.vendorLegalDocument.trim() || null,
            }),
          },
        });
      }
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(data.personalDocument !== undefined && {
          personalDocument: data.personalDocument.trim() || null,
        }),
      },
      include: {
        condominium: { select: { id: true, name: true } },
        vendorProfile: true,
      },
    });
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuário não encontrado');

    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) throw new BadRequestException('Senha atual incorreta');

    const hashed = await bcrypt.hash(newPassword, 10);
    await this.prisma.user.update({
      where: { id: userId },
      data: { password: hashed },
    });
  }

  async linkToCondominium(userId: string, condominiumId: string): Promise<User> {
    const normalizedCondominiumId = condominiumId?.trim();
    if (!normalizedCondominiumId) {
      throw new BadRequestException('Código do condomínio é obrigatório');
    }

    const condominium = await this.prisma.condominium.findUnique({
      where: { id: normalizedCondominiumId },
      select: { id: true, active: true },
    });

    if (!condominium || !condominium.active) {
      throw new BadRequestException('Condomínio informado não está disponível');
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: { condominiumId: normalizedCondominiumId },
      include: {
        condominium: { select: { id: true, name: true } },
      },
    });
  }

  async listCondominiumUsers(condominiumId: string) {
    return this.prisma.user.findMany({
      where: { condominiumId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        active: true,
        apartment: true,
        block: true,
        phone: true,
        personalDocument: true,
        vehicleInfo: true,
        createdAt: true,
      },
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
    });
  }

  async toggleUserStatus(userId: string, active: boolean): Promise<User> {
    return this.prisma.user.update({
      where: { id: userId },
      data: { active },
    });
  }
}

