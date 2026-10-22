import { Pipe, PipeTransform } from '@angular/core';

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

@Pipe({ name: 'fileSize' })
export class FileSizePipe implements PipeTransform {
  transform(bytes: number | null | undefined, perSecond = false): string {
    if (!bytes || bytes <= 0) {
      return perSecond ? '0 B/s' : '0 B';
    }

    const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), UNITS.length - 1);
    const value = bytes / Math.pow(1024, exponent);
    const formatted = value >= 10 ? value.toFixed(0) : value.toFixed(1);

    return `${formatted} ${UNITS[exponent]}${perSecond ? '/s' : ''}`;
  }
}
