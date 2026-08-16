import { Controller, Get } from '@nestjs/common';

/**
 * Health check endpoint for monitoring and container orchestration.
 * Returns service status for uptime monitoring and Docker health checks.
 */
@Controller('health')
export class HealthController {
  @Get()
  check(): { status: string; timestamp: string; service: string } {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'bidclean-api',
    };
  }
}
