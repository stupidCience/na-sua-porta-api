import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { DeliveriesModule } from './deliveries/deliveries.module';
import { PrismaModule } from './prisma/prisma.module';
import { CondominiumsModule } from './condominiums/condominiums.module';
import { NotificationsModule } from './notifications/notifications.module';
import { OrdersModule } from './orders/orders.module';
import { VendorsModule } from './vendors/vendors.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    PrismaModule,
    AuthModule,
    UsersModule,
    DeliveriesModule,
    CondominiumsModule,
    NotificationsModule,
    OrdersModule,
    VendorsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
