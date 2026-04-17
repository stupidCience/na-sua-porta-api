import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { DeliveriesGateway } from './deliveries.gateway';
import {
  Delivery,
  DeliveryStatus,
  DeliveryType,
  OrderStatus,
} from '../generated/client';
import { tenantScope } from 'src/common/tenant-scope.util';

@Injectable()
export class DeliveriesService {
  constructor(
    private prisma: PrismaService,
    private gateway: DeliveriesGateway,
  ) {}

  private generateDeliveryCode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  private generatePickupCode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  private async assertResidentProfileComplete(residentId: string) {
    const resident = await this.prisma.user.findUnique({
      where: { id: residentId },
      select: {
        apartment: true,
        block: true,
        phone: true,
      },
    });

    if (!resident) {
      throw new NotFoundException('Morador não encontrado');
    }

    const missing: string[] = [];
    if (!resident.apartment?.trim()) missing.push('apartamento');
    if (!resident.block?.trim()) missing.push('bloco');
    if (!resident.phone?.trim()) missing.push('telefone');

    if (missing.length > 0) {
      throw new BadRequestException(
        `Seu cadastro está incompleto (${missing.join(', ')}). Atualize em /profile para continuar.`,
      );
    }
  }

  private async assertDeliveryPersonProfileComplete(deliveryPersonId: string) {
    const deliveryPerson = await this.prisma.user.findUnique({
      where: { id: deliveryPersonId },
      select: {
        personalDocument: true,
        phone: true,
        vehicleInfo: true,
      },
    });

    if (!deliveryPerson) {
      throw new NotFoundException('Entregador não encontrado');
    }

    const missing: string[] = [];
    if (!deliveryPerson.personalDocument?.trim())
      missing.push('documento pessoal');
    if (!deliveryPerson.phone?.trim()) missing.push('telefone');
    if (!deliveryPerson.vehicleInfo?.trim()) missing.push('dados do veículo');

    if (missing.length > 0) {
      throw new BadRequestException(
        `Seu cadastro está incompleto (${missing.join(', ')}). Atualize em /profile para aceitar entregas.`,
      );
    }
  }

  private async logEvent(
    deliveryId: string,
    event: string,
    userId?: string,
    metadata?: Record<string, any>,
  ) {
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
    options?: {
      type?: DeliveryType;
      orderId?: string;
      pickupOrigin?: string;
    },
    externalPlatform?: string,
    externalCode?: string,
  ): Promise<Delivery> {
    await this.assertResidentProfileComplete(residentId);

    // Get resident to inherit condominiumId
    const resident = await this.prisma.user.findUnique({
      where: { id: residentId },
    });

    const delivery = await this.prisma.delivery.create({
      data: {
        residentId,
        apartment,
        block,
        type: options?.type ?? DeliveryType.PORTARIA,
        orderId: options?.orderId,
        pickupOrigin: options?.pickupOrigin ?? 'Portaria',
        description,
        notes,
        externalPlatform,
        externalCode,
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
        condominium: {
          select: { id: true, name: true },
        },
        order: {
          select: {
            id: true,
            source: true,
            paymentStatus: true,
            status: true,
            pickupCode: true,
          },
        },
      },
    });

    await this.logEvent(delivery.id, 'delivery_created', residentId, {
      apartment,
      block,
      type: delivery.type,
      orderId: delivery.orderId,
    });

    const canBroadcastToDeliveryPool =
      delivery.type === DeliveryType.PORTARIA ||
      (delivery.type === DeliveryType.MARKETPLACE &&
        (delivery.order?.status === OrderStatus.READY ||
          delivery.order?.status === OrderStatus.SENT));

    if (canBroadcastToDeliveryPool) {
      this.gateway.deliveryCreated(delivery);
    }

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
          select: {
            id: true,
            name: true,
            email: true,
            apartment: true,
            block: true,
          },
        },
        deliveryPerson: {
          select: { id: true, name: true, email: true, phone: true },
        },
        condominium: {
          select: { id: true, name: true },
        },
        order: {
          select: {
            id: true,
            source: true,
            paymentStatus: true,
            status: true,
            pickupCode: true,
          },
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
        condominium: {
          select: { id: true, name: true },
        },
        order: {
          select: {
            id: true,
            source: true,
            paymentStatus: true,
            status: true,
            pickupCode: true,
          },
        },
      },
    });
  }

  async acceptDelivery(
    deliveryId: string,
    deliveryPersonId: string,
    condominiumId?: string,
  ): Promise<Delivery> {
    await this.assertDeliveryPersonProfileComplete(deliveryPersonId);

    const delivery = await this.findById(deliveryId, condominiumId);

    if (!delivery) {
      throw new NotFoundException('Entrega não encontrada');
    }

    if (delivery.status !== DeliveryStatus.REQUESTED) {
      throw new BadRequestException(
        'Este pedido não está mais disponível para aceite',
      );
    }

    let generatedPickupCode: string | null = null;

    if (delivery.type === DeliveryType.MARKETPLACE && delivery.orderId) {
      const order = await this.prisma.order.findUnique({
        where: { id: delivery.orderId },
        select: { id: true, status: true },
      });

      if (!order) {
        throw new NotFoundException('Pedido associado não encontrado');
      }

      if (order.status !== OrderStatus.READY) {
        throw new BadRequestException(
          'Este pedido ainda não está pronto para coleta',
        );
      }

      generatedPickupCode = this.generatePickupCode();
      await this.prisma.order.update({
        where: { id: order.id },
        data: {
          pickupCode: generatedPickupCode,
          pickupCodeGeneratedAt: new Date(),
        },
      });
    }

    const deliveryCode = this.generateDeliveryCode();

    const updated = await this.prisma.delivery.update({
      where: { id: deliveryId },
      data: {
        deliveryPersonId,
        status: DeliveryStatus.ACCEPTED,
        acceptedAt: new Date(),
        deliveryCode,
        deliveryCodeGeneratedAt: new Date(),
      },
      include: {
        resident: {
          select: { id: true, name: true, email: true },
        },
        deliveryPerson: {
          select: { id: true, name: true, email: true, phone: true },
        },
        condominium: {
          select: { id: true, name: true },
        },
        order: {
          select: {
            id: true,
            source: true,
            paymentStatus: true,
            status: true,
            pickupCode: true,
          },
        },
      },
    });

    await this.logEvent(deliveryId, 'delivery_accepted', deliveryPersonId, {
      codeGenerated: true,
    });

    const sanitizedForBroadcast: any = { ...updated };
    delete sanitizedForBroadcast.deliveryCode;
    this.gateway.deliveryAccepted(sanitizedForBroadcast);
    // Notify the resident that their delivery was accepted
    if (updated.residentId) {
      this.gateway.sendToUser(updated.residentId, 'delivery_updated', updated);
    }

    if (generatedPickupCode && updated.orderId && updated.deliveryPersonId) {
      this.gateway.sendToUser(
        updated.deliveryPersonId,
        'pickup_code_generated',
        {
          orderId: updated.orderId,
          pickupCode: generatedPickupCode,
        },
      );
    }

    return updated;
  }

  async updateStatus(
    deliveryId: string,
    newStatus: DeliveryStatus,
    userId: string,
    role: string,
    deliveryCode?: string,
    condominiumId?: string,
  ): Promise<Delivery> {
    const delivery = await this.findById(deliveryId, condominiumId);

    if (!delivery) {
      throw new NotFoundException('Entrega não encontrada');
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
        `Transição inválida de status: ${delivery.status} -> ${newStatus}`,
      );
    }

    if (role !== 'DELIVERY_PERSON') {
      throw new BadRequestException(
        'Somente entregadores podem atualizar status da entrega',
      );
    }

    if (!delivery.deliveryPersonId || delivery.deliveryPersonId !== userId) {
      throw new BadRequestException(
        'Apenas o entregador responsável pode atualizar esta entrega',
      );
    }

    if (
      delivery.type === DeliveryType.MARKETPLACE &&
      newStatus === DeliveryStatus.PICKED_UP
    ) {
      const order = delivery.orderId
        ? await this.prisma.order.findUnique({
            where: { id: delivery.orderId },
            select: { status: true },
          })
        : null;

      if (order?.status !== OrderStatus.SENT) {
        throw new BadRequestException(
          'Aguardando o comerciante validar seu código de coleta e marcar como enviado.',
        );
      }
    }

    const updateData: any = {
      status: newStatus,
    };

    if (newStatus === DeliveryStatus.PICKED_UP) {
      updateData.pickedUpAt = new Date();
    } else if (newStatus === DeliveryStatus.DELIVERED) {
      if (!delivery.deliveryCode) {
        throw new BadRequestException(
          'Código de recebimento não disponível para esta entrega',
        );
      }

      if (!deliveryCode || deliveryCode.trim() !== delivery.deliveryCode) {
        throw new BadRequestException('Código de recebimento inválido');
      }

      updateData.deliveredAt = new Date();
      updateData.deliveryCode = null;
      updateData.deliveryCodeGeneratedAt = null;
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
        condominium: {
          select: { id: true, name: true },
        },
        order: {
          select: {
            id: true,
            source: true,
            paymentStatus: true,
            status: true,
            pickupCode: true,
          },
        },
      },
    });

    const eventName =
      newStatus === DeliveryStatus.DELIVERED
        ? 'delivery_completed'
        : `delivery_${newStatus.toLowerCase()}`;
    await this.logEvent(
      deliveryId,
      eventName,
      delivery.deliveryPersonId ?? undefined,
    );

    if (updated.orderId && newStatus === DeliveryStatus.DELIVERED) {
      const order = await this.prisma.order.update({
        where: { id: updated.orderId },
        data: { status: OrderStatus.COMPLETED, completedAt: new Date() },
      });
      this.gateway.orderUpdated(order);
    }

    const sanitizedForBroadcast: any = { ...updated };
    delete sanitizedForBroadcast.deliveryCode;
    this.gateway.deliveryStatusUpdated(sanitizedForBroadcast);
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
      throw new NotFoundException('Entrega não encontrada');
    }

    if (role === 'RESIDENT') {
      if (delivery.residentId !== userId) {
        throw new BadRequestException(
          'Apenas o morador dono pode cancelar este pedido',
        );
      }

      if (
        delivery.status === DeliveryStatus.PICKED_UP ||
        delivery.status === DeliveryStatus.DELIVERED
      ) {
        throw new BadRequestException('Não é possível cancelar após a coleta');
      }

      await this.logEvent(deliveryId, 'delivery_cancelled', userId, {
        by: 'RESIDENT',
      });
      await this.prisma.delivery.delete({ where: { id: deliveryId } });
      this.gateway.sendToAll('delivery_cancelled', {
        id: deliveryId,
        by: 'RESIDENT',
      });
      return { id: deliveryId, cancelled: true };
    }

    if (role === 'DELIVERY_PERSON') {
      if (delivery.status !== DeliveryStatus.ACCEPTED) {
        throw new BadRequestException(
          'Só é possível cancelar o aceite antes da coleta',
        );
      }

      if (!delivery.deliveryPersonId || delivery.deliveryPersonId !== userId) {
        throw new BadRequestException(
          'Apenas o entregador responsável pode cancelar o aceite',
        );
      }

      await this.prisma.delivery.update({
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
          condominium: {
            select: { id: true, name: true },
          },
        },
      });

      await this.logEvent(deliveryId, 'delivery_reopened', userId, {
        by: 'DELIVERY_PERSON',
      });

      if (delivery.orderId) {
        await this.prisma.order.update({
          where: { id: delivery.orderId },
          data: {
            pickupCode: null,
            pickupCodeGeneratedAt: null,
          },
        });
      }

      const refreshed = await this.findById(deliveryId, condominiumId);
      if (!refreshed) {
        throw new NotFoundException(
          'Entrega não encontrada após reabrir aceite',
        );
      }

      this.gateway.deliveryStatusUpdated(refreshed);
      if (refreshed.residentId) {
        this.gateway.sendToUser(
          refreshed.residentId,
          'delivery_updated',
          refreshed,
        );
      }
      return refreshed;
    }

    throw new BadRequestException('Perfil sem permissão para cancelamento');
  }

  async getAvailableDeliveries(condominiumId?: string): Promise<Delivery[]> {
    const where: any = {
      status: DeliveryStatus.REQUESTED,
      ...tenantScope(condominiumId),
      OR: [
        { type: DeliveryType.PORTARIA },
        {
          type: DeliveryType.MARKETPLACE,
          order: {
            is: {
              status: OrderStatus.READY,
            },
          },
        },
      ],
    };

    return this.prisma.delivery.findMany({
      where,
      include: {
        resident: {
          select: {
            id: true,
            name: true,
            email: true,
            apartment: true,
            block: true,
          },
        },
        condominium: {
          select: { id: true, name: true },
        },
        order: {
          select: {
            id: true,
            source: true,
            paymentStatus: true,
            status: true,
            pickupCode: true,
          },
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
          in: [
            DeliveryStatus.ACCEPTED,
            DeliveryStatus.PICKED_UP,
            DeliveryStatus.DELIVERED,
          ],
        },
      },
      include: {
        resident: {
          select: {
            id: true,
            name: true,
            email: true,
            apartment: true,
            block: true,
          },
        },
        condominium: {
          select: { id: true, name: true },
        },
        order: {
          select: {
            id: true,
            source: true,
            paymentStatus: true,
            status: true,
            pickupCode: true,
          },
        },
      },
      orderBy: {
        updatedAt: 'desc',
      },
    });
  }

  async getHistory(
    userId: string,
    role: string,
    condominiumId?: string,
  ): Promise<Delivery[]> {
    const where: any = {
      status: DeliveryStatus.DELIVERED,
      ...tenantScope(condominiumId),
    };

    if (role === 'RESIDENT') {
      where.residentId = userId;
    } else if (role === 'DELIVERY_PERSON') {
      where.deliveryPersonId = userId;
    } else {
      throw new BadRequestException(
        'Perfil de usuário inválido para consultar histórico',
      );
    }

    return this.prisma.delivery.findMany({
      where,
      include: {
        resident: {
          select: {
            id: true,
            name: true,
            email: true,
            apartment: true,
            block: true,
          },
        },
        deliveryPerson: {
          select: { id: true, name: true, email: true, phone: true },
        },
        condominium: {
          select: { id: true, name: true },
        },
        order: {
          select: {
            id: true,
            source: true,
            paymentStatus: true,
            status: true,
            pickupCode: true,
          },
        },
      },
      orderBy: {
        deliveredAt: 'desc',
      },
    });
  }

  async getStats(userId: string, role: string, condominiumId?: string) {
    const condominiumWhere = tenantScope(condominiumId);
    const roleScopedWhere: any = {
      ...condominiumWhere,
    };

    if (role === 'DELIVERY_PERSON') {
      roleScopedWhere.deliveryPersonId = userId;
    } else if (role === 'RESIDENT') {
      roleScopedWhere.residentId = userId;
    }

    const pendingWhere =
      role === 'DELIVERY_PERSON'
        ? { ...roleScopedWhere, status: DeliveryStatus.ACCEPTED }
        : { ...roleScopedWhere, status: DeliveryStatus.REQUESTED };

    const inProgressWhere =
      role === 'DELIVERY_PERSON'
        ? { ...roleScopedWhere, status: DeliveryStatus.PICKED_UP }
        : {
            ...roleScopedWhere,
            status: { in: [DeliveryStatus.ACCEPTED, DeliveryStatus.PICKED_UP] },
          };

    const [total, delivered, pending, inProgress] = await Promise.all([
      this.prisma.delivery.count({ where: roleScopedWhere }),
      this.prisma.delivery.count({
        where: { ...roleScopedWhere, status: DeliveryStatus.DELIVERED },
      }),
      this.prisma.delivery.count({ where: pendingWhere }),
      this.prisma.delivery.count({ where: inProgressWhere }),
    ]);

    // Calculate average delivery time for completed deliveries
    const completedDeliveries = await this.prisma.delivery.findMany({
      where: {
        ...roleScopedWhere,
        status: DeliveryStatus.DELIVERED,
        deliveredAt: { not: null },
      },
      select: { createdAt: true, deliveredAt: true },
    });

    let avgDeliveryTimeMinutes = 0;
    if (completedDeliveries.length > 0) {
      const totalMinutes = completedDeliveries.reduce((sum, d) => {
        const diff =
          new Date(d.deliveredAt!).getTime() - new Date(d.createdAt).getTime();
        return sum + diff / 60000;
      }, 0);
      avgDeliveryTimeMinutes = Math.round(
        totalMinutes / completedDeliveries.length,
      );
    }

    // Today's deliveries
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayDelivered = await this.prisma.delivery.count({
      where: {
        ...roleScopedWhere,
        status: DeliveryStatus.DELIVERED,
        deliveredAt: { gte: today },
      },
    });

    const condominium = condominiumId
      ? await this.prisma.condominium.findUnique({
          where: { id: condominiumId },
          select: { name: true },
        })
      : null;

    return {
      total,
      delivered,
      pending,
      inProgress,
      todayDelivered,
      avgDeliveryTimeMinutes,
      onlineDeliveryPeople: this.gateway.getOnlineDeliveryPeopleCount(),
      condominiumName: condominium?.name ?? null,
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
      throw new NotFoundException('Entrega não encontrada');
    }

    if (delivery.residentId !== residentId) {
      throw new BadRequestException(
        'Apenas o morador pode avaliar esta entrega',
      );
    }

    if (delivery.status !== DeliveryStatus.DELIVERED) {
      throw new BadRequestException(
        'Só é possível avaliar entregas concluídas',
      );
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
        condominium: {
          select: { id: true, name: true },
        },
        order: {
          select: {
            id: true,
            source: true,
            paymentStatus: true,
            status: true,
            pickupCode: true,
          },
        },
      },
    });

    await this.logEvent(deliveryId, 'RATED', residentId, { rating, comment });
    return updated;
  }

  async getAdminOverview(condominiumId?: string) {
    if (!condominiumId) {
      throw new BadRequestException('Administrador sem condomínio vinculado');
    }

    const scope = tenantScope(condominiumId);

    const [total, requested, accepted, pickedUp, delivered, deliveries] =
      await Promise.all([
        this.prisma.delivery.count({ where: scope }),
        this.prisma.delivery.count({
          where: { ...scope, status: DeliveryStatus.REQUESTED },
        }),
        this.prisma.delivery.count({
          where: { ...scope, status: DeliveryStatus.ACCEPTED },
        }),
        this.prisma.delivery.count({
          where: { ...scope, status: DeliveryStatus.PICKED_UP },
        }),
        this.prisma.delivery.count({
          where: { ...scope, status: DeliveryStatus.DELIVERED },
        }),
        this.prisma.delivery.findMany({
          where: scope,
          select: {
            id: true,
            block: true,
            createdAt: true,
            deliveredAt: true,
            status: true,
            deliveryPersonId: true,
            deliveryPerson: {
              select: { id: true, name: true },
            },
          },
        }),
      ]);

    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);

    const todayDemand = deliveries.filter(
      (d) => new Date(d.createdAt) >= startOfDay,
    ).length;

    const avgMinutes = (() => {
      const completed = deliveries.filter(
        (d) => d.status === DeliveryStatus.DELIVERED && d.deliveredAt,
      );
      if (completed.length === 0) return 0;
      const totalMs = completed.reduce(
        (sum, d) =>
          sum +
          (new Date(d.deliveredAt!).getTime() -
            new Date(d.createdAt).getTime()),
        0,
      );
      return Math.round(totalMs / completed.length / 60000);
    })();

    const demandByHourMap = new Map<string, number>();
    for (const delivery of deliveries) {
      const hour = new Date(delivery.createdAt)
        .getHours()
        .toString()
        .padStart(2, '0');
      const key = `${hour}:00`;
      demandByHourMap.set(key, (demandByHourMap.get(key) ?? 0) + 1);
    }
    const demandByHour = Array.from(demandByHourMap.entries())
      .map(([hour, count]) => ({ hour, count }))
      .sort((a, b) => a.hour.localeCompare(b.hour));

    const demandByBlockMap = new Map<string, number>();
    for (const delivery of deliveries) {
      const key = delivery.block || 'Sem bloco';
      demandByBlockMap.set(key, (demandByBlockMap.get(key) ?? 0) + 1);
    }
    const demandByBlock = Array.from(demandByBlockMap.entries())
      .map(([block, count]) => ({ block, count }))
      .sort((a, b) => b.count - a.count);

    const deliveredByCourierMap = new Map<
      string,
      { id: string; name: string; delivered: number }
    >();
    for (const delivery of deliveries) {
      if (
        delivery.status !== DeliveryStatus.DELIVERED ||
        !delivery.deliveryPersonId ||
        !delivery.deliveryPerson
      ) {
        continue;
      }

      const current = deliveredByCourierMap.get(delivery.deliveryPersonId);
      if (!current) {
        deliveredByCourierMap.set(delivery.deliveryPersonId, {
          id: delivery.deliveryPerson.id,
          name: delivery.deliveryPerson.name,
          delivered: 1,
        });
      } else {
        current.delivered += 1;
      }
    }

    const topCouriers = Array.from(deliveredByCourierMap.values())
      .sort((a, b) => b.delivered - a.delivered)
      .slice(0, 5);

    const condominium = await this.prisma.condominium.findUnique({
      where: { id: condominiumId },
      select: { id: true, name: true },
    });

    return {
      condominium,
      overview: {
        total,
        requested,
        accepted,
        pickedUp,
        delivered,
        todayDemand,
        avgDeliveryTimeMinutes: avgMinutes,
        onlineDeliveryPeople: this.gateway.getOnlineDeliveryPeopleCount(),
      },
      demandByHour,
      demandByBlock,
      topCouriers,
    };
  }

  async exportCsv(condominiumId: string): Promise<string> {
    const deliveries = await this.prisma.delivery.findMany({
      where: { ...tenantScope(condominiumId) },
      include: {
        resident: { select: { name: true, email: true } },
        deliveryPerson: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const escape = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;

    const header =
      'ID,Status,Morador,Email do Morador,Apartamento,Bloco,Entregador,Criado em,Entregue em,Avaliação,Comentário';

    const rows = deliveries.map((d) =>
      [
        d.id,
        d.status,
        d.resident?.name ?? '',
        d.resident?.email ?? '',
        d.apartment,
        d.block,
        d.deliveryPerson?.name ?? '',
        d.createdAt.toISOString(),
        d.deliveredAt?.toISOString() ?? '',
        d.rating ?? '',
        d.ratingComment ?? '',
      ]
        .map(escape)
        .join(','),
    );

    return [header, ...rows].join('\r\n');
  }
}
