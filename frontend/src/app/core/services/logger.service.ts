import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class LoggerService {
  info(message: string, context?: unknown): void {
    console.info(`[INFO] ${message}`, context ?? '');
  }

  warn(message: string, context?: unknown): void {
    console.warn(`[WARN] ${message}`, context ?? '');
  }

  error(message: string, context?: unknown): void {
    console.error(`[ERROR] ${message}`, context ?? '');
  }
}
