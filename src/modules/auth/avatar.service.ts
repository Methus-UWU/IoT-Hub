import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserRepository } from '../users/user.repository';
import { SupabaseAdminService } from './supabase-admin.service';
import { AVATAR_MAX_DIMENSION } from './avatar.constants';

@Injectable()
export class AvatarService {
  constructor(
    private readonly users: UserRepository,
    private readonly storage: SupabaseAdminService,
  ) {}

  async read(userId: string): Promise<Buffer> {
    await this.requireActiveProfile(userId);
    const image = await this.storage.readAvatar(userId);
    if (!image)
      throw new NotFoundException({
        code: 'AVATAR_NOT_FOUND',
        message: 'No profile image',
      });
    return image;
  }

  async save(userId: string, image: Buffer): Promise<void> {
    await this.requireActiveProfile(userId);
    // The upload pipe validates PNG magic bytes before these header dimensions are read.
    const width = image.length >= 24 ? image.readUInt32BE(16) : 0;
    const height = image.length >= 24 ? image.readUInt32BE(20) : 0;
    if (
      !width ||
      !height ||
      width > AVATAR_MAX_DIMENSION ||
      height > AVATAR_MAX_DIMENSION
    ) {
      throw new BadRequestException({
        code: 'AVATAR_DIMENSIONS_INVALID',
        message: 'Profile image must be at most 512 by 512 pixels',
      });
    }
    await this.storage.saveAvatar(userId, image);
  }

  async remove(userId: string): Promise<void> {
    await this.requireActiveProfile(userId);
    await this.storage.removeAvatar(userId);
  }

  private async requireActiveProfile(userId: string): Promise<void> {
    const user = await this.users.findProfileById(userId);
    if (!user?.isActive)
      throw new ForbiddenException('An active account is required');
  }
}
