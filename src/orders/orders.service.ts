import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { DeliveriesGateway } from 'src/deliveries/deliveries.gateway';
import { DeliveriesService } from 'src/deliveries/deliveries.service';
import {
  DeliveryStatus,
  DeliveryType,
  OrderStatus,
  PaymentStatus,
  UserRole,
  VendorType,
} from '../generated/client';
import * as bcrypt from 'bcrypt';

type ChatKind = 'ORDER' | 'DELIVERY';

type ChatMessagePayload = {
  id: string;
  content: string;
  createdAt: Date;
  orderId?: string;
  deliveryId?: string;
  kind: ChatKind;
  sender?: {
    id: string;
    name: string;
    role: string;
  };
};

interface CreateOrderInput {
  customerName?: string;
  apartment: string;
  block?: string;
  description: string;
  vendorId?: string;
  vendorName?: string;
  paymentStatus?: PaymentStatus;
  source?: string;
}

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);
  private readonly deliveryChatRetentionMs = 7 * 24 * 60 * 60 * 1000;

  constructor(
    private prisma: PrismaService,
    private deliveriesService: DeliveriesService,
    private deliveriesGateway: DeliveriesGateway,
  ) {}

  private async cleanupExpiredMessages() {
    await this.prisma.orderMessage.deleteMany({
      where: {
        expiresAt: {
          lt: new Date(),
        },
      },
    });
  }

  private getDeliveryChatCutoff() {
    return new Date(Date.now() - this.deliveryChatRetentionMs);
  }

  private async cleanupExpiredDeliveryMessages() {
    await this.prisma.deliveryEvent.deleteMany({
      where: {
        event: 'chat_message',
        createdAt: {
          lt: this.getDeliveryChatCutoff(),
        },
      },
    });
  }

  private isOrderChatEnabled(status: OrderStatus, chatEnabledAt?: Date | null): boolean {
    if (!chatEnabledAt) {
      return false;
    }

    switch (status) {
      case OrderStatus.ACCEPTED:
      case OrderStatus.READY:
      case OrderStatus.SENT:
      case OrderStatus.COMPLETED:
      case OrderStatus.CANCELLED:
        return true;
      default:
        return false;
    }
  }

  private canSendOrderMessage(status: OrderStatus): boolean {
    switch (status) {
      case OrderStatus.ACCEPTED:
      case OrderStatus.READY:
      case OrderStatus.SENT:
        return true;
      default:
        return false;
    }
  }

  private isDeliveryChatEnabled(status: DeliveryStatus): boolean {
    switch (status) {
      case DeliveryStatus.ACCEPTED:
      case DeliveryStatus.PICKED_UP:
      case DeliveryStatus.DELIVERED:
        return true;
      default:
        return false;
    }
  }

  private canSendDeliveryMessage(status: DeliveryStatus): boolean {
    switch (status) {
      case DeliveryStatus.ACCEPTED:
      case DeliveryStatus.PICKED_UP:
        return true;
      default:
        return false;
    }
  }

  private resolveChatKind(kind?: string): ChatKind {
    return String(kind || 'ORDER').toUpperCase() === 'DELIVERY' ? 'DELIVERY' : 'ORDER';
  }

  private extractDeliveryMessageContent(metadata?: string | null): string {
    if (!metadata) {
      return '';
    }

    try {
      const parsed = JSON.parse(metadata);
      if (typeof parsed === 'string') {
        return parsed.trim();
      }

      if (parsed && typeof parsed.content === 'string') {
        return parsed.content.trim();
      }
    } catch {
      // Ignore malformed metadata and skip invalid chat messages.
    }

    return '';
  }

  private async loadSendersById(senderIds: string[]) {
    if (senderIds.length === 0) {
      return new Map<string, { id: string; name: string; role: string }>();
    }

    const senders = await this.prisma.user.findMany({
      where: { id: { in: senderIds } },
      select: { id: true, name: true, role: true },
    });

    return new Map(
      senders.map((sender) => [
        sender.id,
        {
          id: sender.id,
          name: sender.name,
          role: sender.role,
        },
      ]),
    );
  }

  private mapDeliveryEventToMessage(
    event: { id: string; deliveryId: string; userId: string | null; metadata: string | null; createdAt: Date },
    sendersById: Map<string, { id: string; name: string; role: string }>,
  ): ChatMessagePayload | null {
    const content = this.extractDeliveryMessageContent(event.metadata);
    if (!content) {
      return null;
    }

    return {
      id: event.id,
      content,
      createdAt: event.createdAt,
      deliveryId: event.deliveryId,
      kind: 'DELIVERY',
      sender: event.userId ? sendersById.get(event.userId) : undefined,
    };
  }

  private async resolveVendor(condominiumId: string, vendorId?: string, vendorName?: string) {
    if (vendorId) {
      const vendor = await this.prisma.vendor.findFirst({
        where: { id: vendorId, condominiumId, active: true },
      });
      if (!vendor) {
        throw new BadRequestException('Fornecedor não encontrado para este condomínio');
      }
      return vendor;
    }

    if (!vendorName?.trim()) {
      return null;
    }

    const normalized = vendorName.trim();
    const existing = await this.prisma.vendor.findFirst({
      where: {
        condominiumId,
        active: true,
        name: { equals: normalized, mode: 'insensitive' },
      },
    });

    if (existing) {
      return existing;
    }

    return this.prisma.vendor.create({
      data: {
        name: normalized,
        type: VendorType.EXTERNAL,
        condominiumId,
      },
    });
  }

  private async getOrCreateExternalResident(
    condominiumId: string,
    customerName: string,
    apartment: string,
    block?: string,
  ) {
    const externalEmail = `externo.${condominiumId}@nasuaporta.local`;

    const existing = await this.prisma.user.findUnique({ where: { email: externalEmail } });
    if (existing) {
      return this.prisma.user.update({
        where: { id: existing.id },
        data: {
          name: customerName,
          apartment,
          block: block?.trim() || existing.block || 'Portaria',
          phone: existing.phone || 'pedido-externo',
        },
      });
    }

    const password = await bcrypt.hash(`ext-${condominiumId}-${Date.now()}`, 10);
    return this.prisma.user.create({
      data: {
        email: externalEmail,
        password,
        name: customerName,
        role: UserRole.RESIDENT,
        apartment,
        block: block?.trim() || 'Portaria',
        phone: 'pedido-externo',
        active: true,
        condominiumId,
      },
    });
  }

  private async resolveCondominiumForExternalOrder() {
    const condominium = await this.prisma.condominium.findFirst({
      where: { active: true },
      select: { id: true, name: true },
    });

    if (!condominium) {
      throw new BadRequestException('Nenhum condomínio ativo disponível para pedidos externos');
    }

    return condominium;
  }

  async createOrderByUser(user: any, input: CreateOrderInput): Promise<any> {
    if (!user?.condominiumId) {
      throw new BadRequestException('Conta sem condomínio vinculado');
    }

    if (user.role !== UserRole.RESIDENT) {
      throw new ForbiddenException('Somente moradores podem criar pedidos');
    }

    const customerName = input.customerName?.trim() || user.name;
    if (!customerName) {
      throw new BadRequestException('Nome do cliente é obrigatório');
    }

    if (!input.apartment?.trim() || !input.description?.trim()) {
      throw new BadRequestException('Apartamento e descrição são obrigatórios');
    }

    const vendor = await this.resolveVendor(user.condominiumId, input.vendorId, input.vendorName);

    const order = await this.prisma.order.create({
      data: {
        customerName,
        apartment: input.apartment.trim(),
        block: input.block?.trim() || user.block || null,
        description: input.description.trim(),
        source: input.source || 'app',
        paymentStatus: input.paymentStatus || PaymentStatus.PENDING,
        vendorId: vendor?.id,
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
      undefined,
      {
        type: DeliveryType.MARKETPLACE,
        orderId: order.id,
        pickupOrigin: vendor?.name || 'Comércio parceiro',
      },
    );

    this.deliveriesGateway.orderCreated({
      id: order.id,
      source: order.source,
      paymentStatus: order.paymentStatus,
      customerName: order.customerName,
      vendorName: vendor?.name || null,
    });

    return this.findById(order.id, user.id, user.role, user.condominiumId);
  }

  async createExternalOrder(input: { name: string; apartment: string; description: string; block?: string }) {
    if (!input?.name?.trim() || !input?.apartment?.trim() || !input?.description?.trim()) {
      throw new BadRequestException('nome, apartamento e descrição são obrigatórios');
    }

    this.logger.log(
      `[external-order] Recebido pedido externo para apartamento ${input.apartment.trim()} (${input.name.trim()})`,
    );

    try {
      const condominium = await this.resolveCondominiumForExternalOrder();
      const externalResident = await this.getOrCreateExternalResident(
        condominium.id,
        input.name.trim(),
        input.apartment.trim(),
        input.block,
      );

      const order = await this.prisma.order.create({
        data: {
          customerName: input.name.trim(),
          apartment: input.apartment.trim(),
          block: input.block?.trim() || externalResident.block || 'Portaria',
          description: input.description.trim(),
          source: 'whatsapp-prep',
          paymentStatus: PaymentStatus.PENDING,
          condominiumId: condominium.id,
          createdByUserId: externalResident.id,
        },
      });

      await this.deliveriesService.create(
        externalResident.id,
        order.apartment,
        order.block || 'Portaria',
        order.description,
        undefined,
        {
          type: DeliveryType.MARKETPLACE,
          orderId: order.id,
          pickupOrigin: 'Pedido externo',
        },
      );

      this.deliveriesGateway.orderCreated({
        id: order.id,
        source: order.source,
        paymentStatus: order.paymentStatus,
        customerName: order.customerName,
        external: true,
      });

      const created = await this.prisma.order.findUnique({
        where: { id: order.id },
        include: {
          vendor: true,
          delivery: true,
        },
      });

      this.logger.log(
        `[external-order] Pedido criado com sucesso. orderId=${order.id} deliveryId=${created?.delivery?.id ?? 'n/a'} condominiumId=${condominium.id}`,
      );

      return {
        success: true,
        message: 'Pedido externo criado e entrega gerada com sucesso.',
        data: created,
      };
    } catch (error: any) {
      this.logger.error(
        `[external-order] Falha ao criar pedido externo: ${error?.message || 'erro desconhecido'}`,
      );
      throw error;
    }
  }

  async findAll(userId: string, role: string, condominiumId?: string) {
    if (!condominiumId) {
      throw new BadRequestException('Usuário sem condomínio vinculado');
    }

    const where: any = { condominiumId };
    if (role === 'RESIDENT') {
      where.createdByUserId = userId;
    } else if (role === 'VENDOR') {
      const vendor = await this.prisma.vendor.findFirst({
        where: {
          userId,
          condominiumId,
          active: true,
        },
        select: { id: true },
      });

      if (!vendor) {
        throw new ForbiddenException('Comerciante sem comércio ativo vinculado');
      }

      where.vendorId = vendor.id;
    } else if (role === 'DELIVERY_PERSON') {
      where.delivery = {
        is: {
          deliveryPersonId: userId,
        },
      };
    }

    return this.prisma.order.findMany({
      where,
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
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string, userId: string, role: string, condominiumId?: string): Promise<any> {
    if (!condominiumId) {
      throw new BadRequestException('Usuário sem condomínio vinculado');
    }

    const order = await this.prisma.order.findFirst({
      where: { id, condominiumId },
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

    if (!order) {
      throw new NotFoundException('Pedido não encontrado');
    }

    if (role === 'RESIDENT' && order.createdByUserId !== userId) {
      throw new ForbiddenException('Acesso negado para este pedido');
    }

    if (role === 'VENDOR') {
      const vendor = await this.prisma.vendor.findFirst({
        where: {
          userId,
          condominiumId,
          active: true,
        },
        select: { id: true },
      });

      if (!vendor || order.vendorId !== vendor.id) {
        throw new ForbiddenException('Acesso negado para este pedido');
      }
    } else if (role === 'DELIVERY_PERSON') {
      if (!order.delivery || order.delivery.deliveryPersonId !== userId) {
        throw new ForbiddenException('Acesso negado para este pedido');
      }
    }

    return order;
  }

  async getChats(userId: string, role: string, condominiumId?: string) {
    if (!condominiumId) {
      throw new BadRequestException('Usuário sem condomínio vinculado');
    }

    await Promise.all([this.cleanupExpiredMessages(), this.cleanupExpiredDeliveryMessages()]);

    const orderChats = await this.getOrderChats(userId, role, condominiumId);
    const deliveryChats = await this.getDeliveryChats(userId, role, condominiumId);

    return [...orderChats, ...deliveryChats].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  }

  private async getOrderChats(userId: string, role: string, condominiumId: string) {
    const where: any = {
      condominiumId,
      chatEnabledAt: {
        not: null,
      },
    };

    if (role === 'RESIDENT') {
      where.createdByUserId = userId;
    } else if (role === 'VENDOR') {
      const vendor = await this.prisma.vendor.findFirst({
        where: {
          userId,
          condominiumId,
          active: true,
        },
        select: { id: true },
      });

      if (!vendor) {
        throw new ForbiddenException('Comerciante sem comércio ativo vinculado');
      }

      where.vendorId = vendor.id;
    } else if (role === 'DELIVERY_PERSON') {
      where.delivery = {
        is: {
          deliveryPersonId: userId,
        },
      };
    }

    const orders = await this.prisma.order.findMany({
      where,
      include: {
        vendor: {
          select: {
            id: true,
            name: true,
          },
        },
        delivery: {
          select: {
            id: true,
            deliveryPersonId: true,
            deliveryPerson: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
        messages: {
          where: {
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
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        _count: {
          select: {
            messages: {
              where: {
                expiresAt: {
                  gt: new Date(),
                },
              },
            },
          },
        },
      },
      orderBy: {
        updatedAt: 'desc',
      },
    });

    return orders.map((order) => ({
      id: order.id,
      kind: 'ORDER' as const,
      status: order.status,
      customerName: order.customerName,
      apartment: order.apartment,
      block: order.block,
      vendor: order.vendor,
      delivery: order.delivery,
      updatedAt: order.updatedAt,
      createdAt: order.createdAt,
      canSend: this.canSendOrderMessage(order.status),
      lastMessage: order.messages[0] || null,
      messageCount: order._count.messages,
    }));
  }

  private async findDeliveryForChat(
    deliveryId: string,
    userId: string,
    role: string,
    condominiumId: string | undefined,
  ) {
    if (!condominiumId) {
      throw new BadRequestException('Usuário sem condomínio vinculado');
    }

    if (!['RESIDENT', 'DELIVERY_PERSON'].includes(role)) {
      throw new ForbiddenException('Somente morador e entregador podem acessar chat de portaria');
    }

    const delivery = await this.prisma.delivery.findFirst({
      where: {
        id: deliveryId,
        condominiumId,
      },
      select: {
        id: true,
        status: true,
        residentId: true,
        deliveryPersonId: true,
        apartment: true,
        block: true,
        createdAt: true,
        updatedAt: true,
        resident: {
          select: {
            id: true,
            name: true,
          },
        },
        deliveryPerson: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!delivery) {
      throw new NotFoundException('Entrega não encontrada');
    }

    if (role === 'RESIDENT' && delivery.residentId !== userId) {
      throw new ForbiddenException('Acesso negado para este chat');
    }

    if (role === 'DELIVERY_PERSON' && delivery.deliveryPersonId !== userId) {
      throw new ForbiddenException('Acesso negado para este chat');
    }

    return delivery;
  }

  private async getDeliveryChats(userId: string, role: string, condominiumId: string) {
    if (role === 'VENDOR' || role === 'CONDOMINIUM_ADMIN') {
      return [];
    }

    const where: any = {
      condominiumId,
      status: {
        in: [DeliveryStatus.ACCEPTED, DeliveryStatus.PICKED_UP, DeliveryStatus.DELIVERED],
      },
    };

    if (role === 'RESIDENT') {
      where.residentId = userId;
    } else if (role === 'DELIVERY_PERSON') {
      where.deliveryPersonId = userId;
    } else {
      return [];
    }

    const deliveries = await this.prisma.delivery.findMany({
      where,
      select: {
        id: true,
        status: true,
        apartment: true,
        block: true,
        createdAt: true,
        updatedAt: true,
        residentId: true,
        deliveryPersonId: true,
        resident: {
          select: {
            id: true,
            name: true,
          },
        },
        deliveryPerson: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: {
        updatedAt: 'desc',
      },
    });

    if (deliveries.length === 0) {
      return [];
    }

    const deliveryIds = deliveries.map((delivery) => delivery.id);
    const chatEvents = await this.prisma.deliveryEvent.findMany({
      where: {
        event: 'chat_message',
        deliveryId: {
          in: deliveryIds,
        },
        createdAt: {
          gt: this.getDeliveryChatCutoff(),
        },
      },
      select: {
        id: true,
        deliveryId: true,
        userId: true,
        metadata: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    const senderIds = Array.from(
      new Set(chatEvents.map((event) => event.userId).filter((id): id is string => !!id)),
    );
    const sendersById = await this.loadSendersById(senderIds);

    const groupedMessages = new Map<string, ChatMessagePayload[]>();
    for (const event of chatEvents) {
      const mapped = this.mapDeliveryEventToMessage(event, sendersById);
      if (!mapped) {
        continue;
      }

      const current = groupedMessages.get(event.deliveryId) || [];
      current.push(mapped);
      groupedMessages.set(event.deliveryId, current);
    }

    return deliveries.map((delivery) => {
      const messages = groupedMessages.get(delivery.id) || [];
      const lastMessage = messages[messages.length - 1] || null;

      return {
        id: delivery.id,
        kind: 'DELIVERY' as const,
        status: delivery.status,
        customerName: delivery.resident?.name || 'Morador',
        apartment: delivery.apartment,
        block: delivery.block,
        vendor: null,
        delivery: {
          id: delivery.id,
          deliveryPersonId: delivery.deliveryPersonId,
          deliveryPerson: delivery.deliveryPerson,
        },
        updatedAt: lastMessage?.createdAt || delivery.updatedAt,
        createdAt: delivery.createdAt,
        canSend: this.canSendDeliveryMessage(delivery.status),
        lastMessage,
        messageCount: messages.length,
      };
    });
  }

  private async getOrderMessages(orderId: string, userId: string, role: string, condominiumId?: string) {
    await this.cleanupExpiredMessages();

    const order = await this.findById(orderId, userId, role, condominiumId);

    if (!this.isOrderChatEnabled(order.status, order.chatEnabledAt)) {
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

  private async getDeliveryMessages(
    deliveryId: string,
    userId: string,
    role: string,
    condominiumId?: string,
  ) {
    await this.cleanupExpiredDeliveryMessages();

    const delivery = await this.findDeliveryForChat(deliveryId, userId, role, condominiumId);
    if (!this.isDeliveryChatEnabled(delivery.status)) {
      return [];
    }

    const events = await this.prisma.deliveryEvent.findMany({
      where: {
        event: 'chat_message',
        deliveryId,
        createdAt: {
          gt: this.getDeliveryChatCutoff(),
        },
      },
      select: {
        id: true,
        deliveryId: true,
        userId: true,
        metadata: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    const senderIds = Array.from(
      new Set(events.map((event) => event.userId).filter((id): id is string => !!id)),
    );
    const sendersById = await this.loadSendersById(senderIds);

    return events
      .map((event) => this.mapDeliveryEventToMessage(event, sendersById))
      .filter((event): event is ChatMessagePayload => !!event);
  }

  async getMessages(
    id: string,
    userId: string,
    role: string,
    condominiumId?: string,
    kind?: string,
  ) {
    const chatKind = this.resolveChatKind(kind);
    if (chatKind === 'DELIVERY') {
      return this.getDeliveryMessages(id, userId, role, condominiumId);
    }

    return this.getOrderMessages(id, userId, role, condominiumId);
  }

  private async sendOrderMessage(
    orderId: string,
    userId: string,
    role: string,
    condominiumId: string | undefined,
    content: string,
  ) {
    await this.cleanupExpiredMessages();

    const order = await this.findById(orderId, userId, role, condominiumId);

    if (!this.isOrderChatEnabled(order.status, order.chatEnabledAt)) {
      throw new BadRequestException('Chat disponível apenas após o pedido ser aceito');
    }

    if (!this.canSendOrderMessage(order.status)) {
      throw new BadRequestException('Este pedido foi finalizado e não aceita novas mensagens');
    }

    const message = await this.prisma.orderMessage.create({
      data: {
        orderId,
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

    if (order?.vendor?.userId && order.vendor.userId !== userId) {
      this.deliveriesGateway.sendToUser(order.vendor.userId, 'order_message', message);
    }

    if (order?.createdByUserId && order.createdByUserId !== userId) {
      this.deliveriesGateway.sendToUser(order.createdByUserId, 'order_message', message);
    }

    if (order?.delivery?.deliveryPersonId && order.delivery.deliveryPersonId !== userId) {
      this.deliveriesGateway.sendToUser(order.delivery.deliveryPersonId, 'order_message', message);
    }

    return message;
  }

  private async sendDeliveryMessage(
    deliveryId: string,
    userId: string,
    role: string,
    condominiumId: string | undefined,
    content: string,
  ) {
    await this.cleanupExpiredDeliveryMessages();

    const delivery = await this.findDeliveryForChat(deliveryId, userId, role, condominiumId);

    if (!this.isDeliveryChatEnabled(delivery.status)) {
      throw new BadRequestException('Chat disponível apenas após aceite da entrega');
    }

    if (!this.canSendDeliveryMessage(delivery.status)) {
      throw new BadRequestException('Esta entrega foi finalizada e não aceita novas mensagens');
    }

    const event = await this.prisma.deliveryEvent.create({
      data: {
        deliveryId,
        event: 'chat_message',
        userId,
        metadata: JSON.stringify({
          content: content.trim(),
        }),
      },
    });

    const sender = await this.prisma.user.findUnique({
      where: {
        id: userId,
      },
      select: {
        id: true,
        name: true,
        role: true,
      },
    });

    const message: ChatMessagePayload = {
      id: event.id,
      deliveryId,
      kind: 'DELIVERY',
      content: content.trim(),
      createdAt: event.createdAt,
      sender: sender
        ? {
            id: sender.id,
            name: sender.name,
            role: sender.role,
          }
        : undefined,
    };

    if (delivery.residentId && delivery.residentId !== userId) {
      this.deliveriesGateway.sendToUser(delivery.residentId, 'delivery_message', message);
    }

    if (delivery.deliveryPersonId && delivery.deliveryPersonId !== userId) {
      this.deliveriesGateway.sendToUser(delivery.deliveryPersonId, 'delivery_message', message);
    }

    return message;
  }

  async sendMessage(
    id: string,
    userId: string,
    role: string,
    condominiumId: string | undefined,
    content: string,
    kind?: string,
  ) {
    if (!content?.trim()) {
      throw new BadRequestException('Mensagem não pode ficar vazia');
    }

    const chatKind = this.resolveChatKind(kind);
    if (chatKind === 'DELIVERY') {
      return this.sendDeliveryMessage(id, userId, role, condominiumId, content);
    }

    return this.sendOrderMessage(id, userId, role, condominiumId, content);
  }
}
