import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { DeliveriesController } from './deliveries.controller';
import { DeliveriesService } from './deliveries.service';
import { DeliveriesGateway } from './deliveries.gateway';

@Module({
  imports: [PrismaModule],
  controllers: [DeliveriesController],
  providers: [DeliveriesService, DeliveriesGateway],
  exports: [DeliveriesService, DeliveriesGateway],
})
export class DeliveriesModule {}


