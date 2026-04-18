import { Injectable } from '@nestjs/common';
import { Notification, NotificationCategory } from '../generated/client';
import { PrismaService } from '../prisma/prisma.service';

type CreateNotificationInput = {
  category: NotificationCategory;
  title: string;
  body: string;
  link?: string | null;
  orderId?: string | null;
  deliveryId?: string | null;
  metadata?: Record<string, unknown> | string | null;
};

@Injectable()
export class NotificationsService {
  constructor(private prisma: PrismaService) {}

  async createForUsers(
    userIds: Array<string | null | undefined>,
    input: CreateNotificationInput,
  ): Promise<Notification[]> {
    const normalizedUserIds = Array.from(
      new Set(
        userIds.filter(
          (userId): userId is string =>
            typeof userId === 'string' && userId.trim().length > 0,
        ),
      ),
    );

    if (normalizedUserIds.length === 0) {
      return [];
    }

    const metadata =
      input.metadata == null || typeof input.metadata === 'string'
        ? input.metadata
        : JSON.stringify(input.metadata);

    return this.prisma.$transaction(
      normalizedUserIds.map((userId) =>
        this.prisma.notification.create({
          data: {
            userId,
            category: input.category,
            title: input.title,
            body: input.body,
            link: input.link ?? null,
            orderId: input.orderId ?? null,
            deliveryId: input.deliveryId ?? null,
            metadata: metadata ?? null,
          },
        }),
      ),
    );
  }
}
