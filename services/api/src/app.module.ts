import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { RolesModule } from './roles/roles.module';
import { KycModule } from './kyc/kyc.module';
import { ProfileModule } from './profile/profile.module';

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
    HealthModule,
    AuthModule,
    RolesModule,
    KycModule,
    ProfileModule,
  ],
})
export class AppModule {}
