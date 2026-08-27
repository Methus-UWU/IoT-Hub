import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { seedUsers, seedRoles } from '../prisma/seeds/index';
import 'dotenv/config';



const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL!,
});

const prisma = new PrismaClient({ adapter });

async function main() {
    console.log('🌱 Seeding started...');

    await seedRoles(prisma);
    await seedUsers(prisma);

    console.log('🎉 All seeds completed!');
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });