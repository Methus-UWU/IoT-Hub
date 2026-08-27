import { randomBytes } from 'node:crypto';
import * as bcrypt from 'bcrypt';

import { PrismaClient } from '../../src/generated/prisma/client';

const PASSWORD_HASH_ROUNDS = 12;

interface SeedUserSpec {
  key: 'ADMIN' | 'USER';
  username: string;
  email: string;
  roleName: 'admin' | 'user';
}

const SEED_USERS: SeedUserSpec[] = [
  { key: 'ADMIN', username: 'admin', email: 'admin@localhost', roleName: 'admin' },
  { key: 'USER', username: 'user', email: 'user@localhost', roleName: 'user' },
];

/**
 * Seed credentials must never be literals in tracked source. Each account reads
 * SEED_<KEY>_EMAIL / SEED_<KEY>_PASSWORD from the environment; when a password is
 * absent outside production a random one is generated and printed exactly once so
 * the developer can copy it. Production refuses to invent credentials.
 */
function resolveCredentials(spec: SeedUserSpec): {
  email: string;
  password: string;
  generated: boolean;
} {
  const email = process.env[`SEED_${spec.key}_EMAIL`]?.trim() || spec.email;
  const configuredPassword = process.env[`SEED_${spec.key}_PASSWORD`];

  if (configuredPassword) {
    if (configuredPassword.length < 12) {
      throw new Error(
        `SEED_${spec.key}_PASSWORD must be at least 12 characters long`,
      );
    }
    return { email, password: configuredPassword, generated: false };
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      `SEED_${spec.key}_PASSWORD must be set explicitly when NODE_ENV=production`,
    );
  }

  // url-safe, 24 bytes of entropy — never persisted anywhere except as a bcrypt hash.
  return { email, password: randomBytes(24).toString('base64url'), generated: true };
}

export async function seedUsers(prisma: PrismaClient) {
  const roles = await prisma.role.findMany();

  for (const spec of SEED_USERS) {
    const role = roles.find((candidate) => candidate.name === spec.roleName);
    if (!role) {
      throw new Error(
        `Role "${spec.roleName}" not found. Please seed roles first.`,
      );
    }

    const { email, password, generated } = resolveCredentials(spec);
    const username = process.env[`SEED_${spec.key}_USERNAME`]?.trim() || spec.username;
    const existing = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    if (existing) {
      // An existing account keeps its password. Seeding must never reset a
      // credential that a real person may already be using.
      await prisma.user.update({
        where: { id: existing.id },
        data: { username, roleId: role.id },
      });
      console.log(`↺ Seed user ${email} already exists — password left unchanged`);
      continue;
    }

    await prisma.user.create({
      data: {
        username,
        email,
        password: await bcrypt.hash(password, PASSWORD_HASH_ROUNDS),
        roleId: role.id,
      },
    });

    if (generated) {
      console.log(
        `✅ Created ${email} with a generated development password: ${password}`,
      );
      console.log('   Store it now — it is not recoverable and is not written to disk.');
    } else {
      console.log(`✅ Created ${email} using the configured seed password`);
    }
  }

  console.log('✅ Users seeded');
}
