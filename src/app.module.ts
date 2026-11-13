import { Module, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { LoggerModule } from 'nestjs-pino';
import { AuthModule } from './auth/index.js';
import {
  AllExceptionsFilter,
  buildPinoHttpOptions,
  JwtAuthGuard,
} from './common/index.js';
import { AppConfigModule, type Env } from './config/index.js';
import { HealthModule } from './health/index.js';
import { OrdersModule } from './orders/index.js';
import { PrismaModule } from './prisma/index.js';
import { VendorsModule } from './vendors/index.js';
import { WhatsappModule } from './whatsapp/index.js';

@Module({
  imports: [
    AppConfigModule,
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        pinoHttp: buildPinoHttpOptions(config.get('NODE_ENV', { infer: true })),
      }),
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    HealthModule,
    AuthModule,
    VendorsModule,
    OrdersModule,
    WhatsappModule,
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
