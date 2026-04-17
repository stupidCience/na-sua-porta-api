import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Injectable } from '@nestjs/common';

const normalizeOrigin = (origin: string) => origin.trim().replace(/\/+$/, '');
const corsOriginsEnv =
  process.env.CORS_ORIGINS?.trim() || process.env.CORS_ORIGIN?.trim();
const defaultCorsOrigins = [
  'http://localhost:3001',
  'https://na-sua-porta-front.vercel.app',
];
const socketCorsOrigins = (
  corsOriginsEnv
    ? corsOriginsEnv.split(',').map(normalizeOrigin)
    : defaultCorsOrigins
).filter((origin) => origin.length > 0);

@Injectable()
@WebSocketGateway({
  cors: {
    origin: socketCorsOrigins,
    credentials: true,
  },
})
export class DeliveriesGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private userSocketMap = new Map<string, string>();
  private userRoleMap = new Map<string, string>();
  private unavailableUsers = new Set<string>(); // DELIVERY_PERSONs who set themselves offline

  handleConnection(client: Socket) {
    console.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    console.log(`Client disconnected: ${client.id}`);
    const userId = Array.from(this.userSocketMap.entries()).find(
      ([_, socketId]) => socketId === client.id,
    )?.[0];

    if (userId) {
      this.userSocketMap.delete(userId);
      this.userRoleMap.delete(userId);
      this.unavailableUsers.delete(userId);
      this.broadcastOnlineDeliveryPeople();
    }
  }

  @SubscribeMessage('register-user')
  handleRegisterUser(
    client: Socket,
    payload: string | { userId: string; role?: string },
  ) {
    const userId = typeof payload === 'string' ? payload : payload?.userId;
    const role = typeof payload === 'string' ? undefined : payload?.role;

    if (!userId) {
      return;
    }

    this.userSocketMap.set(userId, client.id);
    if (role) {
      this.userRoleMap.set(userId, role);
    }
    this.broadcastOnlineDeliveryPeople();
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
    this.broadcastOnlineDeliveryPeople();
  }

  getOnlineDeliveryPeopleCount(): number {
    let count = 0;
    for (const [userId, role] of this.userRoleMap.entries()) {
      if (
        role === 'DELIVERY_PERSON' &&
        this.userSocketMap.has(userId) &&
        !this.unavailableUsers.has(userId)
      ) {
        count += 1;
      }
    }
    return count;
  }

  private broadcastOnlineDeliveryPeople() {
    this.server.emit('delivery_people_online', {
      count: this.getOnlineDeliveryPeopleCount(),
    });
  }

  // Event: Delivery created
  deliveryCreated(delivery: any) {
    this.server.emit('delivery_created', delivery);
  }

  // Event: Delivery accepted
  deliveryAccepted(delivery: any) {
    this.server.emit('delivery_accepted', delivery);
  }

  // Event: Delivery status updated
  deliveryStatusUpdated(delivery: any) {
    this.server.emit('delivery_updated', delivery);
  }

  // Event: Order created
  orderCreated(order: any) {
    this.server.emit('order_created', order);
  }

  // Event: Order updated
  orderUpdated(order: any) {
    this.server.emit('order_updated', order);
  }

  // Send notification to specific user
  sendToUser(userId: string, event: string, data: any) {
    const socketId = this.userSocketMap.get(userId);
    if (socketId) {
      this.server.to(socketId).emit(event, data);
    }
  }

  // Send to all users
  sendToAll(event: string, data: any) {
    this.server.emit(event, data);
  }
}
