import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';

import configuration from './config/config';
import { DatabaseModule } from './db/database.module';
import { SafeRegistry } from './db/safe-registry.entity';
import { SafeSnapshot } from './db/safe-snapshot.entity';
import { AlertLog } from './db/alert-log.entity';

import { SafeIndexerService } from './indexer/safe-indexer.service';
import { LensClientService } from './health/lens-client.service';
import { HealthCalculatorService } from './health/health-calculator.service';
import { MonitorService } from './health/monitor.service';
import { AlertService } from './alerts/alert.service';
import { ApiController } from './api/api.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: '.env',
    }),
    ScheduleModule.forRoot(),
    DatabaseModule,
    TypeOrmModule.forFeature([SafeRegistry, SafeSnapshot, AlertLog]),
  ],
  controllers: [ApiController],
  providers: [
    SafeIndexerService,
    LensClientService,
    HealthCalculatorService,
    MonitorService,
    AlertService,
  ],
})
export class AppModule {}
