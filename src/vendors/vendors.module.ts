import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { DeliveriesModule } from 'src/deliveries/deliveries.module';
import { VendorsController } from './vendors.controller';
import { VendorsService } from './vendors.service';

@Module({
  imports: [PrismaModule, DeliveriesModule],
  controllers: [VendorsController],
  providers: [VendorsService],
})
export class VendorsModule {}
