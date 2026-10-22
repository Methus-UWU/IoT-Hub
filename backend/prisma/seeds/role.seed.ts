import { PrismaClient } from '../../src/generated/prisma/client';

export async function seedRoles(prisma: PrismaClient) {
  const roles = [{ name: 'admin' }, { name: 'user' }];

  for (const role of roles) {
    await prisma.role.upsert({
      where: { name: role.name },
      update: {},
      create: role,
    });
  }

  console.log('✅ Roles seeded');
}
