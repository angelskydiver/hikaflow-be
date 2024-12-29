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

  app.enableCors();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document); // Setup Swagger UI at /api-docs

  await app.listen(3000);
}

bootstrap();
