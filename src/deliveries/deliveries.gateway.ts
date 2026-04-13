import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Injectable } from '@nestjs/common';

@Injectable()
@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class DeliveriesGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private userSocketMap = new Map<string, string>();

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
    }
  }

  @SubscribeMessage('register-user')
  handleRegisterUser(client: Socket, userId: string) {
    this.userSocketMap.set(userId, client.id);
    console.log(`User ${userId} registered with socket ${client.id}`);
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
