import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class CondominiumsService {
  constructor(private prisma: PrismaService) {}

  async getMyCondominium(condominiumId: string) {
    const condo = await this.prisma.condominium.findUnique({
      where: { id: condominiumId },
    });
    if (!condo) throw new NotFoundException('Condomínio não encontrado');
    return condo;
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
      throw new BadRequestException('Nome do condomínio deve ter pelo menos 3 caracteres');
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
        ...(data.address !== undefined && { address: data.address.trim() || null }),
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
