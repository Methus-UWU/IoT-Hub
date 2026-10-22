import {
  Controller,
  Delete,
  FileTypeValidator,
  Get,
  Header,
  HttpCode,
  MaxFileSizeValidator,
  ParseFilePipe,
  Put,
  Req,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { THROTTLE_OVERRIDES } from '../../common/config/security.config';
import {
  SupabaseAuthGuard,
  type AuthenticatedRequest,
} from './supabase-auth.guard';
import { AvatarService } from './avatar.service';
import { AVATAR_MAX_BYTES, type AvatarUpload } from './avatar.constants';

@Controller('auth/me/avatar')
@UseGuards(SupabaseAuthGuard)
export class AvatarController {
  constructor(private readonly avatars: AvatarService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async read(@Req() request: AuthenticatedRequest): Promise<StreamableFile> {
    return new StreamableFile(await this.avatars.read(request.user.id), {
      type: 'image/png',
    });
  }

  @Put()
  @HttpCode(204)
  @Throttle(THROTTLE_OVERRIDES.communityWrite)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: AVATAR_MAX_BYTES, files: 1, fields: 0, parts: 1 },
    }),
  )
  save(
    @Req() request: AuthenticatedRequest,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: AVATAR_MAX_BYTES }),
          new FileTypeValidator({ fileType: /^image\/png$/ }),
        ],
      }),
    )
    file: AvatarUpload,
  ): Promise<void> {
    return this.avatars.save(request.user.id, file.buffer);
  }

  @Delete()
  @HttpCode(204)
  @Throttle(THROTTLE_OVERRIDES.communityWrite)
  remove(@Req() request: AuthenticatedRequest): Promise<void> {
    return this.avatars.remove(request.user.id);
  }
}
