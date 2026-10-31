import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { RolesModule } from './roles/roles.module';
import { KycModule } from './kyc/kyc.module';
import { ProfileModule } from './profile/profile.module';
import { PropertiesModule } from './properties/properties.module';
import { OffersModule } from './offers/offers.module';
import { NegotiationModule } from './negotiation/negotiation.module';
import { PaymentsModule } from './payments/payments.module';
import { CommissionModule } from './commission/commission.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { ChatModule } from './chat/chat.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ServiceTrackingModule } from './service-tracking/service-tracking.module';
import { VideoVerificationModule } from './video-verification/video-verification.module';
import { ChecklistPhotosModule } from './checklist-photos/checklist-photos.module';
import { ServiceCompletionModule } from './service-completion/service-completion.module';
import { DisputeSystemModule } from './dispute-system/dispute-system.module';
import { FavoritesModule } from './favorites/favorites.module';

/**
 * Root application module.
 * Feature modules are registered here as they are built.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '../../.env',
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        url: configService.get<string>('DATABASE_URL'),
        entities: [__dirname + '/**/*.entity{.ts,.js}'],
        migrations: [__dirname + '/migrations/*{.ts,.js}'],
        synchronize: false,
        logging: configService.get<string>('NODE_ENV') === 'development',
      }),
    }),
    // Global BullMQ connection (shared by every module's registerQueue + its workers).
    // Without a forRoot connection, worker registration throws "Worker requires a connection".
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const url = new URL(configService.get<string>('REDIS_URL') ?? 'redis://localhost:6379');
        return {
          connection: {
            host: url.hostname,
            port: Number(url.port || 6379),
            ...(url.password ? { password: url.password } : {}),
          },
        };
      },
    }),
    HealthModule,
    AuthModule,
    RolesModule,
    KycModule,
    ProfileModule,
    PropertiesModule,
    OffersModule,
    NegotiationModule,
    PaymentsModule,
    SubscriptionsModule,
    CommissionModule,
    ChatModule,
    NotificationsModule,
    ServiceTrackingModule,
    VideoVerificationModule,
    ChecklistPhotosModule,
    ServiceCompletionModule,
    DisputeSystemModule,
    FavoritesModule,
  ],
})
export class AppModule {}
