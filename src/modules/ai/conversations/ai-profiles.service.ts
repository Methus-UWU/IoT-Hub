import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { AuthorizationService } from '../../authorization/authorization.service';
import {
  AiProfileInput,
  AiProfileRecord,
  AiProfileRepository,
} from './ai-conversation.repository';

/** Personal profiles per user; system profiles are not counted. */
export const MAX_PERSONAL_PROFILES = 20;

export type AiProfileScope = 'personal' | 'system';

export interface AiProfileView {
  id: string;
  name: string;
  description: string;
  model: string | null;
  tier: AiProfileRecord['tier'];
  instructions: string;
  scope: AiProfileScope;
  /** Whether this caller may change or delete it; the server checks again. */
  editable: boolean;
  updatedAt: Date;
}

/**
 * AI profiles: how the assistant answers, kept apart from what was said.
 *
 * A personal profile belongs to its owner. A system profile is offered to everyone
 * and only platform admins create, change, or delete it — checked here against the
 * database role on every write, never inferred from what the browser shows.
 */
@Injectable()
export class AiProfilesService {
  constructor(
    private readonly profiles: AiProfileRepository,
    private readonly authorization: AuthorizationService,
  ) {}

  async list(userId: string): Promise<AiProfileView[]> {
    const [rows, admin] = await Promise.all([
      this.profiles.listVisible(userId),
      this.authorization.isPlatformAdmin(userId),
    ]);
    return rows.map((row) => this.view(row, userId, admin));
  }

  async create(
    userId: string,
    input: AiProfileInput,
    scope: AiProfileScope,
  ): Promise<AiProfileView> {
    if (scope === 'system') {
      await this.authorization.requirePlatformAdmin(userId);
      return this.view(await this.profiles.create(null, input), userId, true);
    }
    if ((await this.profiles.countOwned(userId)) >= MAX_PERSONAL_PROFILES) {
      throw new ConflictException({
        code: 'AI_PROFILE_LIMIT_REACHED',
        message: `You can keep up to ${MAX_PERSONAL_PROFILES} AI profiles`,
      });
    }
    return this.view(await this.profiles.create(userId, input), userId, false);
  }

  async update(
    userId: string,
    id: string,
    patch: Partial<AiProfileInput>,
  ): Promise<AiProfileView> {
    const profile = await this.requireEditable(userId, id);
    const updated = await this.profiles.update(profile.id, patch);
    return this.view(updated, userId, updated.ownerId === null);
  }

  async delete(userId: string, id: string): Promise<void> {
    const profile = await this.requireEditable(userId, id);
    await this.profiles.delete(profile.id);
  }

  /** A profile the user may chat with: their own or a system one. */
  async requireUsable(userId: string, id: string): Promise<AiProfileRecord> {
    const profile = await this.profiles.findById(id);
    if (!profile || (profile.ownerId !== null && profile.ownerId !== userId)) {
      // Someone else's profile is reported as missing, not as forbidden.
      throw new NotFoundException({
        code: 'AI_PROFILE_NOT_FOUND',
        message: 'AI profile not found',
      });
    }
    return profile;
  }

  private async requireEditable(
    userId: string,
    id: string,
  ): Promise<AiProfileRecord> {
    const profile = await this.requireUsable(userId, id);
    if (
      profile.ownerId === null &&
      !(await this.authorization.isPlatformAdmin(userId))
    ) {
      throw new ForbiddenException({
        code: 'AI_PROFILE_FORBIDDEN',
        message: 'Only an administrator can change a system profile',
      });
    }
    return profile;
  }

  private view(
    row: AiProfileRecord,
    userId: string,
    admin: boolean,
  ): AiProfileView {
    const scope: AiProfileScope = row.ownerId === null ? 'system' : 'personal';
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      model: row.model,
      tier: row.tier,
      instructions: row.instructions,
      scope,
      editable: scope === 'system' ? admin : row.ownerId === userId,
      updatedAt: row.updatedAt,
    };
  }
}
