import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { DeliveriesModule } from '../deliveries/deliveries.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { VendorsController } from './vendors.controller';
import { VendorsService } from './vendors.service';

@Module({
  imports: [PrismaModule, DeliveriesModule, NotificationsModule],
  controllers: [VendorsController],
  providers: [VendorsService],
})
export class VendorsModule {}
