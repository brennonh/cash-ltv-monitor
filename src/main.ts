import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger, ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'warn', 'error', 'debug'],
  });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
  app.enableCors();

  // ── Swagger ────────────────────────────────────────────────────
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Cash Safe LTV Monitor')
    .setDescription(
      'Monitors the LTV health of all ether.fi Cash user safes on Scroll mainnet. ' +
      'Polls the CashLens contract, stores health snapshots, and fires Slack alerts ' +
      'when safes approach their liquidation threshold.\n\n' +
      '**Health Factor** = `maxBorrowCapacity / totalBorrowed`\n\n' +
      '| Tier | Health Factor |\n' +
      '|---|---|\n' +
      '| `HEALTHY` | HF > 1.3 |\n' +
      '| `WARNING` | 1.1 < HF ≤ 1.3 |\n' +
      '| `CRITICAL` | 1.0 < HF ≤ 1.1 |\n' +
      '| `LIQUIDATABLE` | HF ≤ 1.0 |\n' +
      '| `NO_DEBT` | No outstanding borrow |',
    )
    .setVersion('1.0.0')
    .setContact('ether.fi Engineering', 'https://ether.fi', '')
    .setLicense('MIT', '')
    .addServer('http://localhost:3000', 'Local development')
    .addServer('https://your-deployment-url', 'Production')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document, {
    customSiteTitle: 'Cash LTV Monitor — API Docs',
    swaggerOptions: {
      // Persist auth/params between page reloads
      persistAuthorization: true,
      // Expand the first tag group by default
      docExpansion: 'list',
      // Show request duration
      displayRequestDuration: true,
      // Show example values from decorators
      defaultModelsExpandDepth: 2,
      defaultModelExpandDepth: 2,
    },
  });

  const port = process.env.PORT || 3000;
  await app.listen(port);

  const logger = new Logger('Bootstrap');
  logger.log(`Cash Safe LTV Monitor running on http://localhost:${port}`);
  logger.log(`Swagger docs available at http://localhost:${port}/docs`);
  logger.log(`OpenAPI JSON at http://localhost:${port}/docs-json`);
}

bootstrap();
