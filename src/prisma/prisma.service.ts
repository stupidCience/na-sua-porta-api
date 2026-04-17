import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '../generated/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  private pgPool: Pool;

  constructor() {
    const connectionString = process.env.DATABASE_URL;
    
    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable is not set');
    }

    const pgPool = new Pool({ connectionString });
    const adapter = new PrismaPg(pgPool);

    super({
      adapter,
      log: ['error', 'warn'],
    });

    this.pgPool = pgPool;
  }

  async onModuleInit() {
    try {
      await this.$connect();
      console.log('✓ Database connected successfully');
    } catch (error) {
      console.error('✗ Database connection failed:', error);
      throw error;
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
    await this.pgPool.end();
  }
}
