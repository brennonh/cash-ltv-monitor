import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SafeRegistry } from './safe-registry.entity';
import { SafeSnapshot } from './safe-snapshot.entity';
import { AlertLog } from './alert-log.entity';
import * as path from 'path';
import * as fs from 'fs';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const rawPath = config.get<string>('db.path');

        // Resolve relative to project root (process.cwd()) so the path is
        // correct regardless of where the compiled output runs from.
        const dbPath = path.isAbsolute(rawPath)
          ? rawPath
          : path.resolve(process.cwd(), rawPath);

        const dir = path.dirname(dbPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        return {
          // 'better-sqlite3' requires native compilation which can fail in some
          // environments. Plain 'sqlite' (sqlite3 npm package) is pure-JS and
          // more portable. Both work with the same schema and queries.
          type: 'sqlite' as const,
          database: dbPath,
          entities: [SafeRegistry, SafeSnapshot, AlertLog],
          synchronize: true,
          logging: false,
        };
      },
    }),
  ],
})
export class DatabaseModule {}
