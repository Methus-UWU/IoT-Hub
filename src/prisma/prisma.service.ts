import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { readReplicas } from '@prisma/extension-read-replicas';
import { PrismaClient } from '../generated/prisma/client';

/**
 * Builds a PrismaClient bound to a single Postgres node via the `pg` driver adapter
 * (required by Prisma 7's query compiler).
 */
function createClient(connectionString: string): PrismaClient {
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

/**
 * Extends the primary client with the read-replicas extension.
 *
 *   - Reads  (findMany/findFirst/count/aggregate/...) -> replica
 *   - Writes (create/update/delete/$executeRaw/...)   -> primary
 *   - Any $transaction(...)                            -> primary
 *
 * Force a node explicitly when needed:
 *   prisma.$primary().device.findMany()  // read from primary (e.g. read-after-write)
 *   prisma.$replica().device.findMany()  // pin to a replica
 */
function createExtendedClient() {
  const primaryUrl = process.env.DATABASE_URL;
  if (!primaryUrl) {
    throw new Error('DATABASE_URL is not set');
  }

  const client = createClient(primaryUrl);

  // No replica configured (e.g. local single-node dev) -> just use the primary.
  const replicaUrl = process.env.DATABASE_REPLICA_URL;
  if (!replicaUrl) {
    return client;
  }

  return client.$extends(
    readReplicas({
      replicas: [createClient(replicaUrl)],
    }),
  );
}

type ExtendedPrismaClient = ReturnType<typeof createExtendedClient>;

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private readonly client: ExtendedPrismaClient = createExtendedClient();

  /** Access the Prisma Client. Reads route to the replica, writes to the primary. */
  get db(): ExtendedPrismaClient {
    return this.client;
  }

  async onModuleInit(): Promise<void> {
    await this.connectWithRetry();
    this.logger.log('Prisma connected (primary + read replica)');
  }

  /**
   * Retries $connect() with backoff instead of crashing the app on the first
   * attempt. Covers the case where nestjs comes up before postgres-primary /
   * postgres-replica (separate compose stack, no cross-stack health-check gating).
   */
  private async connectWithRetry(
    maxAttempts = 10,
    delayMs = 2000,
  ): Promise<void> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.client.$connect();
        return;
      } catch (error) {
        if (attempt === maxAttempts) {
          throw error;
        }
        this.logger.warn(
          `Database not reachable yet (attempt ${attempt}/${maxAttempts}), retrying in ${delayMs}ms...`,
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }
}
