import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Swagger setup
  const config = new DocumentBuilder()
    //
    .addBearerAuth({
      // I was also testing it without prefix 'Bearer ' before the JWT
      description: `Please enter token in following format: <JWT>`,
      name: 'Authorization',
      scheme: 'Bearer',
      type: 'http', // I`ve attempted type: 'apiKey' too
      in: 'Header',
    })
    .setTitle('My API')
    .setDescription('The API description')
    .setVersion('1.0')
    .build();

  // Enhanced CORS configuration for production SSE streaming
  app.enableCors({
    origin:
      process.env.NODE_ENV === 'production'
        ? (origin, callback) => {
            // Allow any hikaflow.com subdomain and specific origins
            const allowedOrigins = [
              'https://hikaflow.com',
              'https://app.hikaflow.com',
              'https://api.hikaflow.com',
              'http://localhost:3000',
            ];

            if (
              !origin ||
              allowedOrigins.includes(origin) ||
              origin.endsWith('.hikaflow.com')
            ) {
              callback(null, true);
            } else {
              callback(null, false);
            }
          }
        : true, // Allow all origins in development
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Accept',
      'Cache-Control',
      'Connection',
      'X-Requested-With',
      'Accept-Encoding',
      'Accept-Language',
      'Origin',
      'Referer',
      'User-Agent',
    ],
    exposedHeaders: [
      'Content-Type',
      'Cache-Control',
      'Connection',
      'Transfer-Encoding',
    ],
  });

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document); // Setup Swagger UI at /api-docs

  await app.listen(3000);
}

bootstrap();
