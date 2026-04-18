import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaModule } from '../prisma/prisma.module';
import { DeliveriesController } from './deliveries.controller';
import { DeliveriesService } from './deliveries.service';
import { DeliveriesGateway } from './deliveries.gateway';

@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [DeliveriesController],
  providers: [DeliveriesService, DeliveriesGateway],
  exports: [DeliveriesService, DeliveriesGateway],
})
export class DeliveriesModule {}
