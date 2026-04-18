import { PrismaClient } from '../src/generated/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcrypt';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { Pool } from 'pg';

const envLocalPath = path.join(__dirname, '..', '.env.local');
const envPath = path.join(__dirname, '..', '.env');

if (fs.existsSync(envLocalPath)) {
  dotenv.config({ path: envLocalPath });
} else if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is not set');
}

const pgPool = new Pool({ connectionString });
const adapter = new PrismaPg(pgPool);
const prisma = new (PrismaClient as any)({ adapter });

async function main() {
  await prisma.orderMessage.deleteMany();
  await prisma.deliveryEvent.deleteMany();
  await prisma.delivery.deleteMany();
  await prisma.order.deleteMany();
  await prisma.menuItem.deleteMany();
  await prisma.vendor.deleteMany();
  await prisma.user.deleteMany();
  await prisma.condominium.deleteMany();

  const condominium = await prisma.condominium.create({
    data: {
      name: 'Condomínio Solar das Flores',
      address: 'Rua das Flores, 100 - Centro',
      accessCode: 'NSP-DEMO',
      operatingHours: '08:00 - 22:00',
      maxActiveDeliveries: 20,
      active: true,
    },
  });

  const secondCondominium = await prisma.condominium.create({
    data: {
      name: 'Condomínio Parque das Águas',
      address: 'Avenida Central, 450 - Jardim Novo',
      accessCode: 'NSP-PARK',
      operatingHours: '07:00 - 23:00',
      maxActiveDeliveries: 15,
      active: true,
    },
  });

  const adminPassword = await bcrypt.hash('admin123', 10);
  await prisma.user.create({
    data: {
      email: 'admin@test.com',
      password: adminPassword,
      name: 'Ana Síndica',
      role: 'CONDOMINIUM_ADMIN',
      phone: '11977777777',
      condominiumId: condominium.id,
    },
  });

  const modularPassword = await bcrypt.hash('modular123', 10);
  const modularResident = await prisma.user.create({
    data: {
      email: 'modular@test.com',
      password: modularPassword,
      name: 'João Multiuso',
      role: 'RESIDENT',
      apartment: '101',
      block: 'A',
      phone: '11999999999',
      communicationsConsent: true,
      personalDocument: '123.456.789-00',
      residenceDocument: 'Conta de luz apto 101',
      residentVerificationStatus: 'VERIFIED',
      vehicleInfo: 'Moto Honda CG 160 - ABC1D23',
      condominiumId: condominium.id,
      registrationSource: 'CONDOMINIUM_ACCESS_CODE',
    },
  });

  await prisma.vendor.create({
    data: {
      name: 'Lanches do João',
      category: 'Lanchonete',
      description: 'Conta modular com operação de morador, entregador e comerciante.',
      contactPhone: '11999999999',
      cnpj: '12.345.678/0001-90',
      cnae: '5611-2/01',
      legalRepresentativeDocument: '123.456.789-00',
      type: 'RESIDENT',
      active: true,
      condominiumId: condominium.id,
      userId: modularResident.id,
      rating: 4.9,
      estimatedTimeMinutes: 30,
      minOrderValue: 20,
    },
  });

  await prisma.menuItem.createMany({
    data: [
      {
        vendorId: (
          await prisma.vendor.findFirstOrThrow({
            where: { userId: modularResident.id },
            select: { id: true },
          })
        ).id,
        name: 'Hambúrguer Clássico',
        description: 'Pão brioche, burger 160g, queijo e salada.',
        price: 29.9,
        category: 'Lanches',
        available: true,
      },
      {
        vendorId: (
          await prisma.vendor.findFirstOrThrow({
            where: { userId: modularResident.id },
            select: { id: true },
          })
        ).id,
        name: 'Batata da Casa',
        description: 'Porção média com molho especial.',
        price: 16.5,
        category: 'Acompanhamentos',
        available: true,
      },
    ],
  });

  const onboardingPassword = await bcrypt.hash('welcome123', 10);
  await prisma.user.create({
    data: {
      email: 'novo@test.com',
      password: onboardingPassword,
      name: 'Marina Primeira Entrada',
      role: 'RESIDENT',
      phone: '11955554444',
      communicationsConsent: false,
      condominiumId: secondCondominium.id,
      registrationSource: 'CONDOMINIUM_ACCESS_CODE',
      residentVerificationStatus: 'NOT_SUBMITTED',
    },
  });

  await prisma.user.create({
    data: {
      email: 'pendente@test.com',
      password: onboardingPassword,
      name: 'Paula Em Analise',
      role: 'RESIDENT',
      apartment: '202',
      block: 'B',
      phone: '11944443333',
      communicationsConsent: true,
      personalDocument: '987.654.321-00',
      residenceDocument: 'Conta de agua apto 202',
      residentVerificationStatus: 'PENDING_REVIEW',
      condominiumId: condominium.id,
      registrationSource: 'CONDOMINIUM_ACCESS_CODE',
    },
  });

  console.log('✓ Seed completed successfully!');
  console.log('\nTest Credentials:');
  console.log('Admin do condomínio principal:');
  console.log('  Email: admin@test.com');
  console.log('  Password: admin123');
  console.log('');
  console.log('Conta modular completa:');
  console.log('  Email: modular@test.com');
  console.log('  Password: modular123');
  console.log('  Módulos esperados: morador, entregador e comerciante');
  console.log('');
  console.log('Primeira entrada sem módulos liberados:');
  console.log('  Email: novo@test.com');
  console.log('  Password: welcome123');
  console.log('  Fluxo esperado: direcionamento para completar perfil');
  console.log('');
  console.log('Morador em análise documental:');
  console.log('  Email: pendente@test.com');
  console.log('  Password: welcome123');
  console.log('  Fluxo esperado: morador pendente de aprovação');
  console.log('');
  console.log('Condominium access codes: NSP-DEMO, NSP-PARK');
}

main()
  .then(async () => {
    await prisma.$disconnect();
    await pgPool.end();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    await pgPool.end();
    process.exit(1);
  });
