const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

async function main() {
  try {
    // Delete existing data (for fresh seeding)
    console.log('🗑️  Deleting existing data...');
    await prisma.delivery.deleteMany();
    await prisma.user.deleteMany();

    // Create test resident
    console.log('👤 Creating test resident...');
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
    console.log('✓ Resident created:', resident.email);

    // Create test delivery person
    console.log('🚚 Creating test delivery person...');
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
    console.log('✓ Delivery person created:', deliveryPerson.email);

    console.log('\n✅ Seed completed successfully!');
    console.log('\n📝 Test Credentials:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Resident:');
    console.log('  Email: morador@test.com');
    console.log('  Password: resident123');
    console.log('');
    console.log('Delivery Person:');
    console.log('  Email: entregador@test.com');
    console.log('  Password: delivery123');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  } catch (error) {
    console.error('❌ Seed failed:', error);
    process.exit(1);
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error('❌ Error:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
