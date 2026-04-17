import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CondominiumsController } from './condominiums.controller';
import { CondominiumsService } from './condominiums.service';

@Module({
  imports: [PrismaModule],
  controllers: [CondominiumsController],
  providers: [CondominiumsService],
})
export class CondominiumsModule {}
