import { createClient } from '@supabase/supabase-js';
import { SupabaseAdminService } from './supabase-admin.service';
import { SupabaseConfig } from '../../common/config/supabase.config';
import { AVATAR_BUCKET, AVATAR_MAX_BYTES } from './avatar.constants';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn() }));

describe('Private avatar storage', () => {
  const files = { upload: jest.fn(), download: jest.fn(), remove: jest.fn() };
  const storage = {
    from: jest.fn(() => files),
    getBucket: jest.fn(),
    createBucket: jest.fn(),
  };
  let service: SupabaseAdminService;
  beforeEach(() => {
    jest.clearAllMocks();
    jest
      .mocked(createClient)
      .mockReturnValue({ storage } as unknown as ReturnType<
        typeof createClient
      >);
    storage.getBucket.mockResolvedValue({
      data: { public: false },
      error: null,
    });
    storage.createBucket.mockResolvedValue({ error: null });
    files.upload.mockResolvedValue({ error: null });
    files.remove.mockResolvedValue({ error: null });
    service = new SupabaseAdminService({
      canPerformAdminOperations: true,
      url: 'https://example.supabase.co',
      secretKey: 'test-only',
    } as SupabaseConfig);
  });
  it('provisions a private restricted bucket and saves under the server-selected owner key', async () => {
    storage.getBucket.mockResolvedValueOnce({
      data: null,
      error: { message: 'Bucket not found' },
    });
    const png = Buffer.from('png');
    await service.saveAvatar('owner-id', png);
    expect(storage.createBucket).toHaveBeenCalledWith(AVATAR_BUCKET, {
      public: false,
      fileSizeLimit: AVATAR_MAX_BYTES,
      allowedMimeTypes: ['image/png'],
    });
    expect(storage.from).toHaveBeenCalledWith(AVATAR_BUCKET);
    expect(files.upload).toHaveBeenCalledWith('owner-id/avatar.png', png, {
      contentType: 'image/png',
      cacheControl: '0',
      upsert: true,
    });
  });
  it('refuses to upload into a public bucket or hide a provisioning failure', async () => {
    storage.getBucket.mockResolvedValue({
      data: { public: true },
      error: null,
    });
    await expect(
      service.saveAvatar('owner', Buffer.from('png')),
    ).rejects.toMatchObject({ status: 503 });
    storage.getBucket.mockResolvedValue({
      data: null,
      error: { message: 'Bucket not found' },
    });
    await expect(
      service.saveAvatar('owner', Buffer.from('png')),
    ).rejects.toMatchObject({ status: 503 });
    expect(files.upload).not.toHaveBeenCalled();
  });
  it('distinguishes an absent image from storage failure without exposing provider errors', async () => {
    files.download.mockResolvedValue({
      data: null,
      error: { message: 'Object not found' },
    });
    await expect(service.readAvatar('owner')).resolves.toBeNull();
    files.download.mockResolvedValue({
      data: null,
      error: { message: 'Internal provider detail' },
    });
    await expect(service.readAvatar('owner')).rejects.toThrow(
      'Profile image storage is temporarily unavailable',
    );
    files.download.mockResolvedValue({ data: new Blob(['png']), error: null });
    await expect(service.readAvatar('owner')).resolves.toEqual(
      Buffer.from('png'),
    );
  });
  it('removes only the owner object and handles absent images idempotently', async () => {
    files.remove.mockResolvedValue({ error: { message: 'Bucket not found' } });
    await expect(service.removeAvatar('owner')).resolves.toBeUndefined();
    expect(files.remove).toHaveBeenCalledWith(['owner/avatar.png']);
  });
});
