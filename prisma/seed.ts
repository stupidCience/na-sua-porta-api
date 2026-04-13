import { PrismaClient } from '../src/generated/client.js';
import * as bcrypt from 'bcrypt';

const prisma = new (PrismaClient as any)({} as any);

async function main() {
  // Delete existing data (for fresh seeding)
  await prisma.delivery.deleteMany();
  await prisma.user.deleteMany();

  // Create test resident
  const residentPassword = await bcrypt.hash('resident123', 10);
  const resident = await prisma.user.create({
    data: {
      email: 'morador@test.com',
      password: residentPassword,
      name: 'João Morador',
      role: 'RESIDENT',
      apartment: '101',
      block: 'A',
      phone: '11999999999',
    },
  });

  // Create test delivery person
  const deliveryPassword = await bcrypt.hash('delivery123', 10);
  const deliveryPerson = await prisma.user.create({
    data: {
      email: 'entregador@test.com',
      password: deliveryPassword,
      name: 'Maria Entregadora',
      role: 'DELIVERY_PERSON',
      phone: '11988888888',
    },
  });

  console.log('✓ Seed completed successfully!');
  console.log('\nTest Credentials:');
  console.log('Resident:');
  console.log('  Email: morador@test.com');
  console.log('  Password: resident123');
  console.log('\nDelivery Person:');
  console.log('  Email: entregador@test.com');
  console.log('  Password: delivery123');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
