import { Module } from '@nestjs/common';
import { HealthModule } from './health/health.module';

/**
 * Root application module.
 * Feature modules are registered here as they are built.
 */
@Module({
  imports: [
    HealthModule,
    // Feature modules will be added here:
    // UsersModule,
    // OffersModule,
    // PaymentsModule,
    // ChatModule,
    // NotificationsModule,
  ],
})
export class AppModule {}
