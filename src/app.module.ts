import { Module, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { AuthModule } from './auth/index.js';
import {
  AllExceptionsFilter,
  buildPinoHttpOptions,
  JwtAuthGuard,
} from './common/index.js';
import { AppConfigModule, type Env } from './config/index.js';
import { HealthModule } from './health/index.js';
import { PrismaModule } from './prisma/index.js';
import { VendorsModule } from './vendors/index.js';

@Module({
  imports: [
    AppConfigModule,
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        pinoHttp: buildPinoHttpOptions(config.get('NODE_ENV', { infer: true })),
      }),
    }),
    PrismaModule,
    HealthModule,
    AuthModule,
    VendorsModule,
  ],
  providers: [
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
