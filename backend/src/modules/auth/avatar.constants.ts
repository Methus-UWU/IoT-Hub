export const AVATAR_BUCKET = 'account-avatars';
export const AVATAR_MAX_BYTES = 512 * 1024;
export const AVATAR_MAX_DIMENSION = 512;

export interface AvatarUpload {
  buffer: Buffer;
  mimetype: string;
  size: number;
}
