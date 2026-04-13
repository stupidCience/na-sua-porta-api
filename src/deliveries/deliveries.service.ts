import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { DeliveriesGateway } from './deliveries.gateway';
import { Delivery, DeliveryStatus } from '../generated';
import { tenantScope } from 'src/common/tenant-scope.util';

@Injectable()
export class DeliveriesService {
  constructor(
    private prisma: PrismaService,
    private gateway: DeliveriesGateway,
  ) {}

  private async logEvent(deliveryId: string, event: string, userId?: string, metadata?: Record<string, any>) {
    await this.prisma.deliveryEvent.create({
      data: {
        deliveryId,
        event,
        userId,
        metadata: metadata ? JSON.stringify(metadata) : undefined,
      },
    });
  }

  async create(
    residentId: string,
    apartment: string,
    block: string,
    description?: string,
    notes?: string,
  ): Promise<Delivery> {
    // Get resident to inherit condominiumId
    const resident = await this.prisma.user.findUnique({ where: { id: residentId } });

    const delivery = await this.prisma.delivery.create({
      data: {
        residentId,
        apartment,
        block,
        description,
        notes,
        status: DeliveryStatus.REQUESTED,
        condominiumId: resident?.condominiumId ?? undefined,
      },
      include: {
        resident: {
          select: { id: true, name: true, email: true },
        },
        deliveryPerson: {
          select: { id: true, name: true, email: true, phone: true },
        },
      },
    });

    await this.logEvent(delivery.id, 'delivery_created', residentId, { apartment, block });
    this.gateway.deliveryCreated(delivery);
    return delivery;
  }

  async findAll(
    userId: string,
    role: string,
    status?: DeliveryStatus,
    deliveryPersonId?: string,
    condominiumId?: string,
  ): Promise<Delivery[]> {
    const where: any = {
      ...tenantScope(condominiumId),
    };

    if (role === 'RESIDENT') {
      where.residentId = userId;
    }

    if (status) {
      where.status = status;
    }

    if (deliveryPersonId) {
      where.deliveryPersonId = deliveryPersonId;
    }

    return this.prisma.delivery.findMany({
      where,
      include: {
        resident: {
          select: { id: true, name: true, email: true, apartment: true, block: true },
        },
        deliveryPerson: {
          select: { id: true, name: true, email: true, phone: true },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findById(id: string, condominiumId?: string): Promise<Delivery | null> {
    return this.prisma.delivery.findFirst({
      where: {
        id,
        ...tenantScope(condominiumId),
      },
      include: {
        resident: {
          select: { id: true, name: true, email: true },
        },
        deliveryPerson: {
          select: { id: true, name: true, email: true, phone: true },
        },
      },
    });
  }

  async acceptDelivery(
    deliveryId: string,
    deliveryPersonId: string,
    condominiumId?: string,
  ): Promise<Delivery> {
    const delivery = await this.findById(deliveryId, condominiumId);

    if (!delivery) {
      throw new NotFoundException('Delivery not found');
    }

    if (delivery.status !== DeliveryStatus.REQUESTED) {
      throw new BadRequestException('Delivery cannot be accepted in this status');
    }

    const updated = await this.prisma.delivery.update({
      where: { id: deliveryId },
      data: {
        deliveryPersonId,
        status: DeliveryStatus.ACCEPTED,
        acceptedAt: new Date(),
      },
      include: {
        resident: {
          select: { id: true, name: true, email: true },
        },
        deliveryPerson: {
          select: { id: true, name: true, email: true, phone: true },
        },
      },
    });

    await this.logEvent(deliveryId, 'delivery_accepted', deliveryPersonId);
    this.gateway.deliveryAccepted(updated);
    // Notify the resident that their delivery was accepted
    if (updated.residentId) {
      this.gateway.sendToUser(updated.residentId, 'delivery_updated', updated);
    }
    return updated;
  }

  async updateStatus(
    deliveryId: string,
    newStatus: DeliveryStatus,
    userId: string,
    role: string,
    condominiumId?: string,
  ): Promise<Delivery> {
    const delivery = await this.findById(deliveryId, condominiumId);

    if (!delivery) {
      throw new NotFoundException('Delivery not found');
    }

    // Validate status progression
    const validTransitions: Record<DeliveryStatus, DeliveryStatus[]> = {
      [DeliveryStatus.REQUESTED]: [DeliveryStatus.ACCEPTED],
      [DeliveryStatus.ACCEPTED]: [DeliveryStatus.PICKED_UP],
      [DeliveryStatus.PICKED_UP]: [DeliveryStatus.DELIVERED],
      [DeliveryStatus.DELIVERED]: [],
    };

    if (!validTransitions[delivery.status].includes(newStatus)) {
      throw new BadRequestException(
        `Cannot transition from ${delivery.status} to ${newStatus}`,
      );
    }

    if (role !== 'DELIVERY_PERSON') {
      throw new BadRequestException('Somente entregadores podem atualizar status da entrega');
    }

    if (!delivery.deliveryPersonId || delivery.deliveryPersonId !== userId) {
      throw new BadRequestException('Apenas o entregador responsável pode atualizar esta entrega');
    }

    const updateData: any = {
      status: newStatus,
    };

    if (newStatus === DeliveryStatus.PICKED_UP) {
      updateData.pickedUpAt = new Date();
    } else if (newStatus === DeliveryStatus.DELIVERED) {
      updateData.deliveredAt = new Date();
    }

    const updated = await this.prisma.delivery.update({
      where: { id: deliveryId },
      data: updateData,
      include: {
        resident: {
          select: { id: true, name: true, email: true },
        },
        deliveryPerson: {
          select: { id: true, name: true, email: true, phone: true },
        },
      },
    });

    const eventName =
      newStatus === DeliveryStatus.DELIVERED ? 'delivery_completed' : `delivery_${newStatus.toLowerCase()}`;
    await this.logEvent(deliveryId, eventName, delivery.deliveryPersonId ?? undefined);
    this.gateway.deliveryStatusUpdated(updated);
    // Notify the resident about status change
    if (updated.residentId) {
      this.gateway.sendToUser(updated.residentId, 'delivery_updated', updated);
    }
    return updated;
  }

  async cancelDelivery(
    deliveryId: string,
    userId: string,
    role: string,
    condominiumId?: string,
  ): Promise<Delivery | { id: string; cancelled: true }> {
    const delivery = await this.findById(deliveryId, condominiumId);

    if (!delivery) {
      throw new NotFoundException('Delivery not found');
    }

    if (role === 'RESIDENT') {
      if (delivery.residentId !== userId) {
        throw new BadRequestException('Apenas o morador dono pode cancelar este pedido');
      }

      if ([DeliveryStatus.PICKED_UP, DeliveryStatus.DELIVERED].includes(delivery.status)) {
        throw new BadRequestException('Não é possível cancelar após a coleta');
      }

      await this.logEvent(deliveryId, 'delivery_cancelled', userId, { by: 'RESIDENT' });
      await this.prisma.delivery.delete({ where: { id: deliveryId } });
      this.gateway.sendToAll('delivery_cancelled', { id: deliveryId, by: 'RESIDENT' });
      return { id: deliveryId, cancelled: true };
    }

    if (role === 'DELIVERY_PERSON') {
      if (delivery.status !== DeliveryStatus.ACCEPTED) {
        throw new BadRequestException('Só é possível cancelar o aceite antes da coleta');
      }

      if (!delivery.deliveryPersonId || delivery.deliveryPersonId !== userId) {
        throw new BadRequestException('Apenas o entregador responsável pode cancelar o aceite');
      }

      const updated = await this.prisma.delivery.update({
        where: { id: deliveryId },
        data: {
          status: DeliveryStatus.REQUESTED,
          deliveryPersonId: null,
          acceptedAt: null,
        },
        include: {
          resident: {
            select: { id: true, name: true, email: true },
          },
          deliveryPerson: {
            select: { id: true, name: true, email: true, phone: true },
          },
        },
      });

      await this.logEvent(deliveryId, 'delivery_reopened', userId, { by: 'DELIVERY_PERSON' });
      this.gateway.deliveryStatusUpdated(updated);
      if (updated.residentId) {
        this.gateway.sendToUser(updated.residentId, 'delivery_updated', updated);
      }
      return updated;
    }

    throw new BadRequestException('Perfil sem permissão para cancelamento');
  }

  async getAvailableDeliveries(condominiumId?: string): Promise<Delivery[]> {
    const where: any = {
      status: DeliveryStatus.REQUESTED,
      ...tenantScope(condominiumId),
    };

    return this.prisma.delivery.findMany({
      where,
      include: {
        resident: {
          select: { id: true, name: true, email: true, apartment: true, block: true },
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
    });
  }

  async getDeliveryPersonDeliveries(
    deliveryPersonId: string,
    condominiumId?: string,
  ): Promise<Delivery[]> {
    return this.prisma.delivery.findMany({
      where: {
        deliveryPersonId,
        ...tenantScope(condominiumId),
        status: {
          in: [DeliveryStatus.ACCEPTED, DeliveryStatus.PICKED_UP, DeliveryStatus.DELIVERED],
        },
      },
      include: {
        resident: {
          select: { id: true, name: true, email: true, apartment: true, block: true },
        },
      },
      orderBy: {
        updatedAt: 'desc',
      },
    });
  }

  async getHistory(userId: string, role: string, condominiumId?: string): Promise<Delivery[]> {
    const where: any = {
      status: DeliveryStatus.DELIVERED,
      ...tenantScope(condominiumId),
    };

    if (role === 'RESIDENT') {
      where.residentId = userId;
    } else if (role === 'DELIVERY_PERSON') {
      where.deliveryPersonId = userId;
    } else {
      throw new BadRequestException('Perfil de usuário inválido para consultar histórico');
    }

    return this.prisma.delivery.findMany({
      where,
      include: {
        resident: {
          select: { id: true, name: true, email: true, apartment: true, block: true },
        },
        deliveryPerson: {
          select: { id: true, name: true, email: true, phone: true },
        },
      },
      orderBy: {
        deliveredAt: 'desc',
      },
    });
  }

  async getStats(condominiumId?: string) {
    const condominiumWhere = tenantScope(condominiumId);

    const [total, delivered, pending, inProgress] = await Promise.all([
      this.prisma.delivery.count({ where: condominiumWhere }),
      this.prisma.delivery.count({
        where: { ...condominiumWhere, status: DeliveryStatus.DELIVERED },
      }),
      this.prisma.delivery.count({
        where: { ...condominiumWhere, status: DeliveryStatus.REQUESTED },
      }),
      this.prisma.delivery.count({
        where: {
          ...condominiumWhere,
          status: { in: [DeliveryStatus.ACCEPTED, DeliveryStatus.PICKED_UP] },
        },
      }),
    ]);

    // Calculate average delivery time for completed deliveries
    const completedDeliveries = await this.prisma.delivery.findMany({
      where: {
        ...condominiumWhere,
        status: DeliveryStatus.DELIVERED,
        deliveredAt: { not: null },
      },
      select: { createdAt: true, deliveredAt: true },
    });

    let avgDeliveryTimeMinutes = 0;
    if (completedDeliveries.length > 0) {
      const totalMinutes = completedDeliveries.reduce((sum, d) => {
        const diff = new Date(d.deliveredAt!).getTime() - new Date(d.createdAt).getTime();
        return sum + diff / 60000;
      }, 0);
      avgDeliveryTimeMinutes = Math.round(totalMinutes / completedDeliveries.length);
    }

    // Today's deliveries
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayDelivered = await this.prisma.delivery.count({
      where: {
        ...condominiumWhere,
        status: DeliveryStatus.DELIVERED,
        deliveredAt: { gte: today },
      },
    });

    return {
      total,
      delivered,
      pending,
      inProgress,
      todayDelivered,
      avgDeliveryTimeMinutes,
    };
  }

  async rateDelivery(
    deliveryId: string,
    residentId: string,
    rating: number,
    comment?: string,
    condominiumId?: string,
  ): Promise<Delivery> {
    const delivery = await this.findById(deliveryId, condominiumId);

    if (!delivery) {
      throw new NotFoundException('Delivery not found');
    }

    if (delivery.residentId !== residentId) {
      throw new BadRequestException('Apenas o morador pode avaliar esta entrega');
    }

    if (delivery.status !== DeliveryStatus.DELIVERED) {
      throw new BadRequestException('Só é possível avaliar entregas concluídas');
    }

    if (delivery.rating) {
      throw new BadRequestException('Esta entrega já foi avaliada');
    }

    if (rating < 1 || rating > 5) {
      throw new BadRequestException('Avaliação deve ser entre 1 e 5');
    }

    const updated = await this.prisma.delivery.update({
      where: { id: deliveryId },
      data: { rating, ratingComment: comment },
      include: {
        resident: {
          select: { id: true, name: true, email: true },
        },
        deliveryPerson: {
          select: { id: true, name: true, email: true, phone: true },
        },
      },
    });

    await this.logEvent(deliveryId, 'RATED', residentId, { rating, comment });
    return updated;
  }
}

