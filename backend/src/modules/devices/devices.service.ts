import { createHash, randomBytes } from 'node:crypto';

import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { DeviceRecord, DeviceRepository } from './device.repository';

export const MAX_DEVICES_PER_PROJECT = 20;
/** A device heard from within this window is online. */
export const ONLINE_WINDOW_MS = 60_000;

export interface DeviceView {
  id: string;
  name: string;
  /** Last four characters of the token, to tell tokens apart. */
  tokenHint: string;
  lastSeenAt: Date | null;
  online: boolean;
  createdAt: Date;
}

export interface DeviceWithToken {
  device: DeviceView;
  /** Shown once. Only its SHA-256 is stored. */
  token: string;
}

export function hashDeviceToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Devices: the boards that report to a project.
 *
 * Each device authenticates with its own token. The token is random, shown to the
 * user once at creation or rotation, and stored only as a SHA-256 hash, so neither a
 * database read nor a leaked backup can impersonate a device. Rotating the token cuts
 * off the old one immediately.
 *
 * Authorization is the controller's; every method takes a project the caller may use,
 * and a device id from another project is a 404.
 */
@Injectable()
export class DevicesService {
  constructor(private readonly devices: DeviceRepository) {}

  async list(projectId: string, now = new Date()): Promise<DeviceView[]> {
    return (await this.devices.list(projectId)).map((device) =>
      view(device, now),
    );
  }

  async create(
    projectId: string,
    name: string,
    userId: string,
  ): Promise<DeviceWithToken> {
    if ((await this.devices.count(projectId)) >= MAX_DEVICES_PER_PROJECT) {
      throw new ConflictException({
        code: 'DEVICE_LIMIT_REACHED',
        message: `A project can have up to ${MAX_DEVICES_PER_PROJECT} devices`,
      });
    }
    const token = newToken();
    const device = await this.devices.create({
      projectId,
      name,
      tokenHash: hashDeviceToken(token),
      tokenHint: token.slice(-4),
      createdBy: userId,
    });
    return { device: view(device, new Date()), token };
  }

  async rename(
    projectId: string,
    id: string,
    name: string,
  ): Promise<DeviceView> {
    await this.require(projectId, id);
    return view(await this.devices.rename(id, name), new Date());
  }

  async rotateToken(projectId: string, id: string): Promise<DeviceWithToken> {
    await this.require(projectId, id);
    const token = newToken();
    const device = await this.devices.replaceToken(
      id,
      hashDeviceToken(token),
      token.slice(-4),
    );
    return { device: view(device, new Date()), token };
  }

  async delete(projectId: string, id: string): Promise<void> {
    await this.require(projectId, id);
    await this.devices.delete(id);
  }

  async require(projectId: string, id: string): Promise<DeviceRecord> {
    const device = await this.devices.find(id);
    if (!device || device.projectId !== projectId) {
      throw new NotFoundException({
        code: 'DEVICE_NOT_FOUND',
        message: 'Device not found',
      });
    }
    return device;
  }

  /** The device a token belongs to, or null. */
  authenticate(token: string): Promise<DeviceRecord | null> {
    return this.devices.findByTokenHash(hashDeviceToken(token));
  }
}

export function isOnline(device: DeviceRecord, now: Date): boolean {
  return (
    device.lastSeenAt !== null &&
    now.getTime() - device.lastSeenAt.getTime() < ONLINE_WINDOW_MS
  );
}

function view(device: DeviceRecord, now: Date): DeviceView {
  return {
    id: device.id,
    name: device.name,
    tokenHint: device.tokenHint,
    lastSeenAt: device.lastSeenAt,
    online: isOnline(device, now),
    createdAt: device.createdAt,
  };
}

/** 32 URL-safe characters from 24 random bytes, prefixed so it is easy to recognise. */
function newToken(): string {
  return `iot_${randomBytes(24).toString('base64url')}`;
}
