import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new HttpExceptionFilter());

  const normalizeOrigin = (origin: string) => origin.trim().replace(/\/+$/, '');
  const corsOriginsEnv =
    process.env.CORS_ORIGINS?.trim() || process.env.CORS_ORIGIN?.trim();
  const defaultCorsOrigins = [
    'http://localhost:3001',
    'https://na-sua-porta-front.vercel.app',
  ];
  const corsOrigins = (
    corsOriginsEnv
      ? corsOriginsEnv.split(',').map(normalizeOrigin)
      : defaultCorsOrigins
  ).filter((origin) => origin.length > 0);

  // Enable CORS
  app.enableCors({
    origin: (origin, callback) => {
      if (!origin || corsOrigins.includes(normalizeOrigin(origin))) {
        return callback(null, true);
      }

      return callback(
        new Error(
          `Not allowed by CORS. Origin '${origin}' is not in the allowed list: ${corsOrigins.join(', ')}`,
        ),
      );
    },
    credentials: true,
  });

  // Use global prefix for API routes
  app.setGlobalPrefix('api');

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`[BOOT] Ambiente: ${process.env.NODE_ENV || 'development'}`);
  console.log(`[BOOT] API pronta em: http://localhost:${port}/api`);
}
bootstrap();
