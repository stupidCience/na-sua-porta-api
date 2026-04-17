import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  DeliveryStatus,
  DeliveryType,
  OrderStatus,
  PaymentStatus,
  UserRole,
} from '../generated/client';
import { DeliveriesService } from '../deliveries/deliveries.service';
import { DeliveriesGateway } from '../deliveries/deliveries.gateway';

@Injectable()
export class VendorsService {
  constructor(
    private prisma: PrismaService,
    private deliveriesService: DeliveriesService,
    private gateway: DeliveriesGateway,
  ) {}

  private async getVendorByUser(userId: string, condominiumId?: string) {
    const vendor = await this.prisma.vendor.findFirst({
      where: {
        userId,
        ...(condominiumId ? { condominiumId } : {}),
      },
    });

    if (!vendor) {
      throw new ForbiddenException(
        'Comércio vinculado não encontrado para esta conta',
      );
    }

    return vendor;
  }

  async findAll(condominiumId?: string) {
    return this.prisma.vendor.findMany({
      where: {
        active: true,
        ...(condominiumId ? { condominiumId } : {}),
      },
      include: {
        menuItems: {
          where: { available: true },
          orderBy: { category: 'asc' },
        },
        _count: {
          select: { orders: true },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  async findById(id: string) {
    const vendor = await this.prisma.vendor.findUnique({
      where: { id },
      include: {
        menuItems: {
          where: { available: true },
          orderBy: [{ category: 'asc' }, { name: 'asc' }],
        },
        _count: {
          select: { orders: true },
        },
      },
    });

    if (!vendor) {
      throw new NotFoundException('Comércio não encontrado.');
    }

    return vendor;
  }

  async createOrderFromMenu(
    vendorId: string,
    user: any,
    data: {
      items: Array<{ menuItemId: string; quantity: number }>;
      notes?: string;
      apartment: string;
      block?: string;
    },
  ) {
    if (user.role !== 'RESIDENT') {
      throw new ForbiddenException(
        'Somente moradores podem fazer pedidos no comércio',
      );
    }

    const resident = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: {
        apartment: true,
        block: true,
        phone: true,
      },
    });

    const missing: string[] = [];
    if (!resident?.apartment?.trim()) missing.push('apartamento');
    if (!resident?.block?.trim()) missing.push('bloco');
    if (!resident?.phone?.trim()) missing.push('telefone');
    if (missing.length > 0) {
      throw new BadRequestException(
        `Seu cadastro está incompleto (${missing.join(', ')}). Atualize em /profile para continuar.`,
      );
    }

    if (!user.condominiumId) {
      throw new BadRequestException('Conta sem condomínio vinculado');
    }

    if (!Array.isArray(data.items) || data.items.length === 0) {
      throw new BadRequestException(
        'Selecione ao menos um item para concluir o pedido',
      );
    }

    const vendor = await this.prisma.vendor.findFirst({
      where: {
        id: vendorId,
        active: true,
        condominiumId: user.condominiumId,
      },
    });

    if (!vendor) {
      throw new NotFoundException(
        'Comércio não encontrado para este condomínio',
      );
    }

    const itemIds = Array.from(new Set(data.items.map((i) => i.menuItemId)));
    const menuItems = await this.prisma.menuItem.findMany({
      where: {
        id: { in: itemIds },
        vendorId,
        available: true,
      },
    });

    if (menuItems.length !== itemIds.length) {
      throw new BadRequestException(
        'Alguns itens do cardápio não estão mais disponíveis',
      );
    }

    const menuMap = new Map(menuItems.map((m) => [m.id, m]));

    let totalAmount = 0;
    const descriptionLines: string[] = [];

    for (const item of data.items) {
      const menu = menuMap.get(item.menuItemId);
      if (!menu) {
        throw new BadRequestException('Item inválido no pedido');
      }
      const qty = Number(item.quantity) > 0 ? Number(item.quantity) : 1;
      const subtotal = menu.price * qty;
      totalAmount += subtotal;
      descriptionLines.push(`${menu.name} x${qty} (R$ ${subtotal.toFixed(2)})`);
    }

    const notes = data.notes?.trim();
    const description = notes
      ? `${descriptionLines.join(' | ')} | Obs: ${notes}`
      : descriptionLines.join(' | ');

    const apartment = data.apartment?.trim() || user.apartment;
    if (!apartment) {
      throw new BadRequestException('Apartamento é obrigatório');
    }

    const order = await this.prisma.order.create({
      data: {
        status: OrderStatus.PENDING,
        paymentStatus: PaymentStatus.PENDING,
        customerName: user.name,
        apartment,
        block: data.block?.trim() || user.block || null,
        description,
        totalAmount,
        source: 'app',
        vendorId: vendor.id,
        condominiumId: user.condominiumId,
        createdByUserId: user.id,
      },
      include: {
        vendor: true,
      },
    });

    await this.deliveriesService.create(
      user.id,
      order.apartment,
      order.block || user.block || 'Portaria',
      order.description,
      notes,
      {
        type: DeliveryType.MARKETPLACE,
        orderId: order.id,
        pickupOrigin: vendor.name,
      },
    );

    this.gateway.orderCreated({
      id: order.id,
      source: order.source,
      paymentStatus: order.paymentStatus,
      customerName: order.customerName,
      vendorName: vendor.name,
      status: order.status,
      totalAmount: order.totalAmount,
    });

    if (vendor.userId) {
      this.gateway.sendToUser(vendor.userId, 'order_created', {
        id: order.id,
        customerName: order.customerName,
        apartment: order.apartment,
        block: order.block,
        totalAmount: order.totalAmount,
        status: order.status,
      });
    }

    return this.prisma.order.findUnique({
      where: { id: order.id },
      include: {
        vendor: true,
        delivery: true,
      },
    });
  }

  async getMyVendor(userId: string, condominiumId?: string) {
    const vendor = await this.getVendorByUser(userId, condominiumId);
    return this.prisma.vendor.findUnique({
      where: { id: vendor.id },
      include: {
        menuItems: {
          orderBy: [{ category: 'asc' }, { name: 'asc' }],
        },
        _count: {
          select: {
            orders: true,
            menuItems: true,
          },
        },
      },
    });
  }

  async updateMyVendor(
    userId: string,
    condominiumId: string | undefined,
    data: {
      name?: string;
      description?: string;
      category?: string;
      imageUrl?: string;
      bannerUrl?: string;
      aboutText?: string;
      contactPhone?: string;
      estimatedTimeMinutes?: number;
      minOrderValue?: number;
    },
  ) {
    const vendor = await this.getVendorByUser(userId, condominiumId);

    return this.prisma.vendor.update({
      where: { id: vendor.id },
      data: {
        ...(data.name !== undefined && { name: data.name.trim() }),
        ...(data.description !== undefined && {
          description: data.description.trim() || null,
        }),
        ...(data.category !== undefined && {
          category: data.category.trim() || null,
        }),
        ...(data.imageUrl !== undefined && {
          imageUrl: data.imageUrl.trim() || null,
        }),
        ...(data.bannerUrl !== undefined && {
          bannerUrl: data.bannerUrl.trim() || null,
        }),
        ...(data.aboutText !== undefined && {
          aboutText: data.aboutText.trim() || null,
        }),
        ...(data.contactPhone !== undefined && {
          contactPhone: data.contactPhone.trim() || null,
        }),
        ...(data.estimatedTimeMinutes !== undefined && {
          estimatedTimeMinutes:
            data.estimatedTimeMinutes && data.estimatedTimeMinutes > 0
              ? Number(data.estimatedTimeMinutes)
              : null,
        }),
        ...(data.minOrderValue !== undefined && {
          minOrderValue:
            data.minOrderValue && data.minOrderValue > 0
              ? Number(data.minOrderValue)
              : 0,
        }),
      },
    });
  }

  async addMenuItem(
    userId: string,
    condominiumId: string | undefined,
    data: {
      name: string;
      description?: string;
      price: number;
      category?: string;
      imageUrl?: string;
      available?: boolean;
    },
  ) {
    const vendor = await this.getVendorByUser(userId, condominiumId);

    if (!data.name?.trim()) {
      throw new BadRequestException('Nome do item é obrigatório');
    }
    if (!data.price || Number(data.price) <= 0) {
      throw new BadRequestException('Preço do item deve ser maior que zero');
    }

    return this.prisma.menuItem.create({
      data: {
        vendorId: vendor.id,
        name: data.name.trim(),
        description: data.description?.trim() || null,
        price: Number(data.price),
        category: data.category?.trim() || null,
        imageUrl: data.imageUrl?.trim() || null,
        available: data.available ?? true,
      },
    });
  }

  async updateMenuItem(
    userId: string,
    condominiumId: string | undefined,
    itemId: string,
    data: {
      name?: string;
      description?: string;
      price?: number;
      category?: string;
      imageUrl?: string;
      available?: boolean;
    },
  ) {
    const vendor = await this.getVendorByUser(userId, condominiumId);
    const item = await this.prisma.menuItem.findFirst({
      where: {
        id: itemId,
        vendorId: vendor.id,
      },
    });

    if (!item) {
      throw new NotFoundException('Item de cardápio não encontrado');
    }

    if (data.price !== undefined && Number(data.price) <= 0) {
      throw new BadRequestException('Preço do item deve ser maior que zero');
    }

    return this.prisma.menuItem.update({
      where: { id: itemId },
      data: {
        ...(data.name !== undefined && { name: data.name.trim() }),
        ...(data.description !== undefined && {
          description: data.description.trim() || null,
        }),
        ...(data.price !== undefined && { price: Number(data.price) }),
        ...(data.category !== undefined && {
          category: data.category.trim() || null,
        }),
        ...(data.imageUrl !== undefined && {
          imageUrl: data.imageUrl.trim() || null,
        }),
        ...(data.available !== undefined && { available: !!data.available }),
      },
    });
  }

  async deleteMenuItem(
    userId: string,
    condominiumId: string | undefined,
    itemId: string,
  ) {
    const vendor = await this.getVendorByUser(userId, condominiumId);
    const item = await this.prisma.menuItem.findFirst({
      where: {
        id: itemId,
        vendorId: vendor.id,
      },
    });

    if (!item) {
      throw new NotFoundException('Item de cardápio não encontrado');
    }

    await this.prisma.menuItem.delete({ where: { id: itemId } });
    return { deleted: true };
  }

  async getMyOrders(
    userId: string,
    condominiumId: string | undefined,
    history = false,
  ) {
    const vendor = await this.getVendorByUser(userId, condominiumId);

    return this.prisma.order.findMany({
      where: {
        vendorId: vendor.id,
        condominiumId: vendor.condominiumId,
        ...(history
          ? { status: { in: [OrderStatus.COMPLETED, OrderStatus.CANCELLED] } }
          : {
              status: { notIn: [OrderStatus.COMPLETED, OrderStatus.CANCELLED] },
            }),
      },
      include: {
        createdByUser: {
          select: {
            id: true,
            name: true,
            phone: true,
            apartment: true,
            block: true,
          },
        },
        delivery: {
          include: {
            deliveryPerson: {
              select: { id: true, name: true, phone: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateMyOrderStatus(
    userId: string,
    condominiumId: string | undefined,
    orderId: string,
    status: OrderStatus,
    pickupCode?: string,
  ) {
    const vendor = await this.getVendorByUser(userId, condominiumId);

    const order = await this.prisma.order.findFirst({
      where: {
        id: orderId,
        vendorId: vendor.id,
        condominiumId: vendor.condominiumId,
      },
      include: {
        delivery: {
          include: {
            deliveryPerson: {
              select: { id: true, name: true, phone: true },
            },
          },
        },
      },
    });

    if (!order) {
      throw new NotFoundException('Pedido não encontrado');
    }

    const allowedTargetStatuses: OrderStatus[] = [
      OrderStatus.ACCEPTED,
      OrderStatus.READY,
      OrderStatus.SENT,
    ];
    if (!allowedTargetStatuses.includes(status)) {
      throw new BadRequestException(
        'Status permitido para o comércio: ACEITO, PRONTO ou ENVIADO',
      );
    }

    const validTransitions: Record<OrderStatus, OrderStatus[]> = {
      [OrderStatus.PENDING]: [OrderStatus.ACCEPTED],
      [OrderStatus.ACCEPTED]: [OrderStatus.READY],
      [OrderStatus.READY]: [OrderStatus.SENT],
      [OrderStatus.SENT]: [],
      [OrderStatus.COMPLETED]: [],
      [OrderStatus.CANCELLED]: [],
    };

    if (!validTransitions[order.status].includes(status)) {
      throw new BadRequestException(
        `Transição inválida: ${order.status} -> ${status}`,
      );
    }

    if (status === OrderStatus.SENT) {
      if (!order.delivery || !order.delivery.deliveryPersonId) {
        throw new BadRequestException(
          'Aguardando entregador aceitar a coleta para marcar como enviado',
        );
      }

      if (order.delivery.status !== DeliveryStatus.ACCEPTED) {
        throw new BadRequestException(
          'A coleta precisa estar aceita para marcar como enviado',
        );
      }

      if (!order.pickupCode) {
        throw new BadRequestException(
          'Código de coleta não foi gerado para este pedido',
        );
      }

      if (!pickupCode?.trim() || pickupCode.trim() !== order.pickupCode) {
        throw new BadRequestException('Código de coleta inválido');
      }
    }

    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: {
        status,
        ...(status === OrderStatus.ACCEPTED
          ? { acceptedAt: new Date(), chatEnabledAt: new Date() }
          : {}),
        ...(status === OrderStatus.READY ? { readyAt: new Date() } : {}),
        ...(status === OrderStatus.SENT
          ? {
              sentAt: new Date(),
              pickupCode: null,
              pickupCodeGeneratedAt: null,
            }
          : {}),
      },
      include: {
        vendor: true,
        delivery: {
          include: {
            deliveryPerson: {
              select: { id: true, name: true, phone: true },
            },
          },
        },
      },
    });

    if (
      status === OrderStatus.READY &&
      updated.delivery &&
      updated.delivery.status === DeliveryStatus.REQUESTED
    ) {
      const deliveryForPool = await this.prisma.delivery.findUnique({
        where: { id: updated.delivery.id },
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
      });

      if (deliveryForPool) {
        this.gateway.deliveryCreated(deliveryForPool);
      }
    }

    if (status === OrderStatus.SENT && updated.delivery) {
      const updatedDelivery = await this.prisma.delivery.update({
        where: { id: updated.delivery.id },
        data: {
          status: DeliveryStatus.PICKED_UP,
          pickedUpAt: new Date(),
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

      this.gateway.deliveryStatusUpdated(updatedDelivery);
      if (updatedDelivery.residentId) {
        this.gateway.sendToUser(
          updatedDelivery.residentId,
          'delivery_updated',
          updatedDelivery,
        );
      }
      if (updatedDelivery.deliveryPersonId) {
        this.gateway.sendToUser(
          updatedDelivery.deliveryPersonId,
          'delivery_updated',
          updatedDelivery,
        );
      }
    }

    this.gateway.orderUpdated(updated);
    if (updated.createdByUserId) {
      this.gateway.sendToUser(
        updated.createdByUserId,
        'order_updated',
        updated,
      );
    }

    if (updated.delivery?.deliveryPersonId) {
      this.gateway.sendToUser(
        updated.delivery.deliveryPersonId,
        'order_updated',
        updated,
      );
    }

    return updated;
  }

  async cancelMyOrder(
    userId: string,
    condominiumId: string | undefined,
    orderId: string,
    reason?: string,
  ) {
    const vendor = await this.getVendorByUser(userId, condominiumId);
    const order = await this.prisma.order.findFirst({
      where: {
        id: orderId,
        vendorId: vendor.id,
        condominiumId: vendor.condominiumId,
      },
      include: {
        delivery: true,
      },
    });

    if (!order) {
      throw new NotFoundException('Pedido não encontrado');
    }

    if (
      !(
        [
          OrderStatus.PENDING,
          OrderStatus.ACCEPTED,
          OrderStatus.READY,
        ] as OrderStatus[]
      ).includes(order.status)
    ) {
      throw new BadRequestException(
        'Somente pedidos pendentes, aceitos ou prontos podem ser cancelados pelo comércio',
      );
    }

    const cancelWindowStartAt =
      order.status === OrderStatus.PENDING
        ? order.createdAt
        : (order.acceptedAt ?? order.createdAt);

    const elapsedMs = Date.now() - new Date(cancelWindowStartAt).getTime();
    if (elapsedMs > 2 * 60 * 1000) {
      throw new BadRequestException(
        'A janela de cancelamento do comércio expirou (2 minutos após aceite)',
      );
    }

    if (
      order.delivery?.status === DeliveryStatus.ACCEPTED ||
      order.delivery?.status === DeliveryStatus.PICKED_UP
    ) {
      throw new BadRequestException(
        'Não é possível cancelar após o entregador assumir a coleta',
      );
    }

    if (order.delivery?.status === DeliveryStatus.REQUESTED) {
      await this.prisma.delivery.delete({ where: { id: order.delivery.id } });
      this.gateway.sendToAll('delivery_cancelled', {
        id: order.delivery.id,
        by: 'VENDOR',
      });
    }

    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: {
        status: OrderStatus.CANCELLED,
        cancelledAt: new Date(),
        cancelReason: reason?.trim() || null,
        cancelledByRole: UserRole.VENDOR,
      },
      include: {
        vendor: true,
        delivery: true,
      },
    });

    this.gateway.orderUpdated(updated);
    if (updated.createdByUserId) {
      this.gateway.sendToUser(
        updated.createdByUserId,
        'order_updated',
        updated,
      );
    }

    return updated;
  }

  async getOrderMessages(
    userId: string,
    condominiumId: string | undefined,
    orderId: string,
  ) {
    await this.prisma.orderMessage.deleteMany({
      where: {
        expiresAt: {
          lt: new Date(),
        },
      },
    });

    const vendor = await this.getVendorByUser(userId, condominiumId);

    const order = await this.prisma.order.findFirst({
      where: {
        id: orderId,
        vendorId: vendor.id,
        condominiumId: vendor.condominiumId,
      },
      select: { id: true, status: true, chatEnabledAt: true },
    });

    if (!order) {
      throw new NotFoundException('Pedido não encontrado');
    }

    if (!order.chatEnabledAt) {
      return [];
    }

    return this.prisma.orderMessage.findMany({
      where: {
        orderId,
        expiresAt: {
          gt: new Date(),
        },
      },
      include: {
        sender: {
          select: {
            id: true,
            name: true,
            role: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async sendOrderMessage(
    userId: string,
    condominiumId: string | undefined,
    orderId: string,
    content: string,
  ) {
    await this.prisma.orderMessage.deleteMany({
      where: {
        expiresAt: {
          lt: new Date(),
        },
      },
    });

    const vendor = await this.getVendorByUser(userId, condominiumId);

    const order = await this.prisma.order.findFirst({
      where: {
        id: orderId,
        vendorId: vendor.id,
        condominiumId: vendor.condominiumId,
      },
      select: {
        id: true,
        status: true,
        chatEnabledAt: true,
        createdByUserId: true,
        delivery: {
          select: {
            deliveryPersonId: true,
          },
        },
      },
    });

    if (!order) {
      throw new NotFoundException('Pedido não encontrado');
    }

    if (!content?.trim()) {
      throw new BadRequestException('Mensagem não pode ficar vazia');
    }

    if (!order.chatEnabledAt) {
      throw new BadRequestException(
        'O chat só fica disponível após aceite do pedido',
      );
    }

    const canSendMessage =
      order.status === OrderStatus.ACCEPTED ||
      order.status === OrderStatus.READY ||
      order.status === OrderStatus.SENT;

    if (!canSendMessage) {
      throw new BadRequestException(
        'O chat só fica disponível após aceite do pedido e enquanto estiver em andamento',
      );
    }

    const message = await this.prisma.orderMessage.create({
      data: {
        orderId: order.id,
        senderId: userId,
        content: content.trim(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
      include: {
        sender: {
          select: {
            id: true,
            name: true,
            role: true,
          },
        },
      },
    });

    if (order.createdByUserId) {
      this.gateway.sendToUser(order.createdByUserId, 'order_message', message);
    }

    if (order.delivery?.deliveryPersonId) {
      this.gateway.sendToUser(
        order.delivery.deliveryPersonId,
        'order_message',
        message,
      );
    }

    return message;
  }

  async getDashboard(userId: string, condominiumId: string | undefined) {
    const vendor = await this.getVendorByUser(userId, condominiumId);

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);

    const [
      todayOrders,
      yesterdayOrders,
      byStatus,
      todaySalesAgg,
      yesterdaySalesAgg,
      recent,
    ] = await Promise.all([
      this.prisma.order.count({
        where: {
          vendorId: vendor.id,
          createdAt: { gte: todayStart },
        },
      }),
      this.prisma.order.count({
        where: {
          vendorId: vendor.id,
          createdAt: { gte: yesterdayStart, lt: todayStart },
        },
      }),
      this.prisma.order.groupBy({
        by: ['status'],
        where: { vendorId: vendor.id },
        _count: { _all: true },
      }),
      this.prisma.order.aggregate({
        where: {
          vendorId: vendor.id,
          status: OrderStatus.COMPLETED,
          completedAt: { gte: todayStart },
        },
        _sum: { totalAmount: true },
      }),
      this.prisma.order.aggregate({
        where: {
          vendorId: vendor.id,
          status: OrderStatus.COMPLETED,
          completedAt: { gte: yesterdayStart, lt: todayStart },
        },
        _sum: { totalAmount: true },
      }),
      this.prisma.order.findMany({
        where: { vendorId: vendor.id },
        select: { createdAt: true, status: true },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
    ]);

    const toPercent = (current: number, previous: number) => {
      if (previous === 0) return current > 0 ? 100 : 0;
      return Math.round(((current - previous) / previous) * 100);
    };

    const byStatusMap = {
      PENDING: 0,
      ACCEPTED: 0,
      READY: 0,
      SENT: 0,
      COMPLETED: 0,
      CANCELLED: 0,
    };

    for (const row of byStatus) {
      byStatusMap[row.status] = row._count._all;
    }

    const periodMap = new Map<string, number>();
    for (const order of recent) {
      const key = new Date(order.createdAt).toISOString().slice(0, 10);
      periodMap.set(key, (periodMap.get(key) ?? 0) + 1);
    }

    const period = Array.from(periodMap.entries())
      .map(([date, orders]) => ({ date, orders }))
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-7);

    const todaySales = Number(todaySalesAgg._sum.totalAmount ?? 0);
    const yesterdaySales = Number(yesterdaySalesAgg._sum.totalAmount ?? 0);

    return {
      today: {
        orders: todayOrders,
        sales: todaySales,
      },
      yesterday: {
        orders: yesterdayOrders,
        sales: yesterdaySales,
      },
      deltas: {
        ordersPercent: toPercent(todayOrders, yesterdayOrders),
        salesPercent: toPercent(todaySales, yesterdaySales),
      },
      byStatus: byStatusMap,
      period,
    };
  }
}
