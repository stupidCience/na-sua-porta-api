import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Injectable } from '@nestjs/common';
import { getCorsOrigins, normalizeOrigin } from '../common/cors-origins.util';

@Injectable()
@WebSocketGateway({
  path: '/socket.io',
  transports: ['polling', 'websocket'],
  cors: {
    origin: (origin, callback) => {
      const corsOrigins = getCorsOrigins();
      if (!origin || corsOrigins.includes(normalizeOrigin(origin))) {
        return callback(null, true);
      }

      return callback(
        new Error(
          `Not allowed by CORS. Origin '${origin}' is not in the allowed list: ${corsOrigins.join(', ')}`,
        ),
      );
    },
    credentials: true,
  },
})
export class DeliveriesGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private userSocketMap = new Map<string, Set<string>>();
  private socketUserMap = new Map<string, string>();
  private userRoleMap = new Map<string, string>();
  private userCondominiumMap = new Map<string, string>();
  private unavailableUsers = new Set<string>(); // DELIVERY_PERSONs who set themselves offline

  private getCondominiumRoom(condominiumId: string): string {
    return `condominium:${condominiumId}`;
  }

  handleConnection(client: Socket) {
    console.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    console.log(`Client disconnected: ${client.id}`);
    const userId = this.socketUserMap.get(client.id);

    if (userId) {
      const condominiumId = this.userCondominiumMap.get(userId);
      this.socketUserMap.delete(client.id);
      const sockets = this.userSocketMap.get(userId);
      if (sockets) {
        sockets.delete(client.id);
        if (sockets.size === 0) {
          this.userSocketMap.delete(userId);
          this.userRoleMap.delete(userId);
          this.unavailableUsers.delete(userId);
          this.userCondominiumMap.delete(userId);
        }
        this.broadcastOnlineDeliveryPeople(condominiumId);
      }
    }
  }

  @SubscribeMessage('register-user')
  handleRegisterUser(
    client: Socket,
    payload:
      | string
      | { userId: string; role?: string; condominiumId?: string | null },
  ) {
    let userId: string | undefined;
    let role: string | undefined;
    let condominiumId: string | null | undefined;

    if (typeof payload === 'string') {
      userId = payload;
    } else {
      userId = payload?.userId;
      role = payload?.role;
      condominiumId = payload?.condominiumId;
    }

    if (!userId) {
      return;
    }
    const resolvedCondominiumId =
      condominiumId === null
        ? undefined
        : (condominiumId ?? this.userCondominiumMap.get(userId));

    const sockets = this.userSocketMap.get(userId) ?? new Set<string>();
    sockets.add(client.id);
    this.userSocketMap.set(userId, sockets);
    this.socketUserMap.set(client.id, userId);

    if (resolvedCondominiumId) {
      this.userCondominiumMap.set(userId, resolvedCondominiumId);
      client.join(this.getCondominiumRoom(resolvedCondominiumId));
    }

    if (role) {
      this.userRoleMap.set(userId, role);
    }
    this.broadcastOnlineDeliveryPeople(resolvedCondominiumId);
    console.log(`User ${userId} registered with socket ${client.id}`);
  }

  @SubscribeMessage('set-availability')
  handleSetAvailability(
    client: Socket,
    payload: { userId: string; available: boolean },
  ) {
    if (!payload?.userId) return;
    if (payload.available) {
      this.unavailableUsers.delete(payload.userId);
    } else {
      this.unavailableUsers.add(payload.userId);
    }
    this.broadcastOnlineDeliveryPeople(
      this.userCondominiumMap.get(payload.userId),
    );
  }

  getOnlineDeliveryPeopleCount(condominiumId?: string): number {
    let count = 0;
    for (const [userId, role] of this.userRoleMap.entries()) {
      if (
        role === 'DELIVERY_PERSON' &&
        this.userSocketMap.has(userId) &&
        !this.unavailableUsers.has(userId) &&
        (!condominiumId ||
          this.userCondominiumMap.get(userId) === condominiumId)
      ) {
        count += 1;
      }
    }
    return count;
  }

  private broadcastOnlineDeliveryPeople(condominiumId?: string) {
    if (condominiumId) {
      this.server
        .to(this.getCondominiumRoom(condominiumId))
        .emit('delivery_people_online', {
          count: this.getOnlineDeliveryPeopleCount(condominiumId),
        });
      return;
    }

    this.server.emit('delivery_people_online', {
      count: this.getOnlineDeliveryPeopleCount(),
    });
  }

  private emitToCondominium(
    condominiumId: string | undefined,
    event: string,
    data: any,
  ) {
    if (condominiumId) {
      this.server.to(this.getCondominiumRoom(condominiumId)).emit(event, data);
      return;
    }

    this.server.emit(event, data);
  }

  // Event: Delivery created
  deliveryCreated(delivery: any) {
    const condominiumId = delivery?.condominiumId ?? delivery?.condominium?.id;
    this.emitToCondominium(condominiumId, 'delivery_created', delivery);
  }

  // Event: Delivery accepted
  deliveryAccepted(delivery: any) {
    const condominiumId = delivery?.condominiumId ?? delivery?.condominium?.id;
    this.emitToCondominium(condominiumId, 'delivery_accepted', delivery);
  }

  // Event: Delivery status updated
  deliveryStatusUpdated(delivery: any) {
    const condominiumId = delivery?.condominiumId ?? delivery?.condominium?.id;
    this.emitToCondominium(condominiumId, 'delivery_updated', delivery);
  }

  // Event: Order created
  orderCreated(order: any) {
    const condominiumId = order?.condominiumId ?? order?.condominium?.id;
    this.emitToCondominium(condominiumId, 'order_created', order);
  }

  // Event: Order updated
  orderUpdated(order: any) {
    const condominiumId = order?.condominiumId ?? order?.condominium?.id;
    this.emitToCondominium(condominiumId, 'order_updated', order);
  }

  // Send notification to specific user
  sendToUser(userId: string, event: string, data: any) {
    const socketIds = this.userSocketMap.get(userId);
    if (socketIds && socketIds.size > 0) {
      for (const socketId of socketIds) {
        this.server.to(socketId).emit(event, data);
      }
    }
  }

  // Send to all users
  sendToAll(event: string, data: any, condominiumId?: string) {
    this.emitToCondominium(condominiumId, event, data);
  }
}
