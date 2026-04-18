import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CondominiumsService {
  constructor(private prisma: PrismaService) {}

  private async generateUniqueAccessCode() {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidate = `NSP-${randomBytes(4).toString('hex').toUpperCase()}`;
      const existing = await this.prisma.condominium.findUnique({
        where: { accessCode: candidate },
        select: { id: true },
      });

      if (!existing) {
        return candidate;
      }
    }

    throw new BadRequestException(
      'Nao foi possivel gerar um codigo de acesso unico para o condominio',
    );
  }

  private async ensureAccessCode(condominiumId: string) {
    const condo = await this.prisma.condominium.findUnique({
      where: { id: condominiumId },
      select: {
        id: true,
        name: true,
        accessCode: true,
      },
    });

    if (!condo) {
      throw new NotFoundException('Condomínio não encontrado');
    }

    if (condo.accessCode) {
      return condo;
    }

    const accessCode = await this.generateUniqueAccessCode();

    return this.prisma.condominium.update({
      where: { id: condominiumId },
      data: { accessCode },
      select: {
        id: true,
        name: true,
        accessCode: true,
      },
    });
  }

  async resolveAccessCode(accessCode: string) {
    const normalizedAccessCode = accessCode?.trim();

    if (!normalizedAccessCode) {
      throw new BadRequestException(
        'Código de acesso do condomínio é obrigatório',
      );
    }

    const condo = await this.prisma.condominium.findUnique({
      where: { accessCode: normalizedAccessCode.toUpperCase() },
      select: {
        id: true,
        name: true,
        active: true,
        accessCode: true,
      },
    });

    if (!condo || !condo.active) {
      throw new NotFoundException(
        'Código de acesso do condomínio não encontrado',
      );
    }

    return condo;
  }

  async getMyCondominium(condominiumId: string) {
    const condo = await this.prisma.condominium.findUnique({
      where: { id: condominiumId },
    });
    if (!condo) throw new NotFoundException('Condomínio não encontrado');
    return condo;
  }

  async getMyAccessCode(condominiumId: string) {
    const condo = await this.ensureAccessCode(condominiumId);
    const accessCode = condo.accessCode;

    if (!accessCode) {
      throw new BadRequestException(
        'Nao foi possivel preparar o codigo de acesso do condominio',
      );
    }

    const frontendBaseUrl = (
      process.env.FRONTEND_URL || 'http://localhost:3001'
    ).replace(/\/+$/, '');

    return {
      ...condo,
      inviteUrl: `${frontendBaseUrl}/register?invite=${encodeURIComponent(
        accessCode,
      )}`,
    };
  }

  async updateMyCondominium(
    condominiumId: string,
    data: {
      name?: string;
      address?: string;
      operatingHours?: string;
      maxActiveDeliveries?: number;
    },
  ) {
    const condo = await this.prisma.condominium.findUnique({
      where: { id: condominiumId },
    });
    if (!condo) throw new NotFoundException('Condomínio não encontrado');

    if (data.name !== undefined && data.name.trim().length < 3) {
      throw new BadRequestException(
        'Nome do condomínio deve ter pelo menos 3 caracteres',
      );
    }

    if (
      data.maxActiveDeliveries !== undefined &&
      (data.maxActiveDeliveries < 1 || data.maxActiveDeliveries > 500)
    ) {
      throw new BadRequestException('Capacidade máxima deve ser entre 1 e 500');
    }

    return this.prisma.condominium.update({
      where: { id: condominiumId },
      data: {
        ...(data.name !== undefined && { name: data.name.trim() }),
        ...(data.address !== undefined && {
          address: data.address.trim() || null,
        }),
        ...(data.operatingHours !== undefined && {
          operatingHours: data.operatingHours.trim() || null,
        }),
        ...(data.maxActiveDeliveries !== undefined && {
          maxActiveDeliveries: data.maxActiveDeliveries,
        }),
      },
    });
  }
}
