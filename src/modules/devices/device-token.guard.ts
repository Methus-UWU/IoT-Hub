import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';

import type { DeviceRecord } from './device.repository';
import { DevicesService } from './devices.service';

export type DeviceRequest = Request & { device: DeviceRecord };

const TOKEN = /^iot_[A-Za-z0-9_-]{32}$/;

/**
 * Authenticates a board by its device token: `Authorization: Device <token>`, or the
 * `X-Device-Token` header for HTTP clients that cannot set Authorization.
 *
 * A device token grants exactly one device's report and control routes. It is not a
 * user session and reaches no other API.
 */
@Injectable()
export class DeviceTokenGuard implements CanActivate {
  constructor(private readonly devices: DevicesService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<DeviceRequest>();
    const token = readToken(request);
    const device =
      token && TOKEN.test(token)
        ? await this.devices.authenticate(token)
        : null;
    if (!device) {
      throw new UnauthorizedException({
        code: 'DEVICE_TOKEN_INVALID',
        message: 'Missing or unknown device token',
      });
    }
    request.device = device;
    return true;
  }
}

function readToken(request: Request): string | null {
  const authorization = request.headers.authorization;
  if (authorization?.startsWith('Device '))
    return authorization.slice(7).trim();
  const header = request.headers['x-device-token'];
  return typeof header === 'string' ? header.trim() : null;
}
