import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { SkipThrottle } from '@nestjs/throttler';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  /** Process liveness only; startup already waits for the database connection. */
  @Get('health')
  @SkipThrottle()
  getHealth(): { data: { status: string } } {
    return { data: { status: 'ok' } };
  }
}
