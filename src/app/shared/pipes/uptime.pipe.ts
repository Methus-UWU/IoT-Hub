import { Pipe, PipeTransform } from '@angular/core';

@Pipe({ name: 'uptime' })
export class UptimePipe implements PipeTransform {
  transform(totalSeconds: number | null | undefined): string {
    if (!totalSeconds || totalSeconds <= 0) {
      return '0m';
    }

    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);

    const parts: string[] = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0 || parts.length === 0) parts.push(`${minutes}m`);

    return parts.join(' ');
  }
}
