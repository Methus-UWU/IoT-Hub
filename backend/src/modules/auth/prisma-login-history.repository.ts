import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import {
  LoginEventView,
  LoginHistoryRepository,
  RecordLoginInput,
} from './login-history.repository';

@Injectable()
export class PrismaLoginHistoryRepository extends LoginHistoryRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async record(input: RecordLoginInput): Promise<void> {
    // The unique session id decides, not a prior lookup, so two concurrent
    // reports of one session still produce a single row.
    await this.prisma.db.loginEvent.createMany({
      data: [input],
      skipDuplicates: true,
    });
  }

  listForUser(userId: string, limit: number): Promise<LoginEventView[]> {
    return this.prisma.db.loginEvent.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { id: true, ipAddress: true, userAgent: true, createdAt: true },
    });
  }
}
