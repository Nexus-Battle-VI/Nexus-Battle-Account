import 'reflect-metadata'

import { NestFactory } from '@nestjs/core'
import { ValidationPipe } from '@nestjs/common'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'

import { AppModule } from './infrastructure/bootstrap/app.module'
import { applyEnvFile, loadConfig } from './infrastructure/config/env'
import { createLogger } from './infrastructure/observability/logger'

const bootstrap = async (): Promise<void> => {
  applyEnvFile()
  const config = loadConfig(process.env)
  const logger = createLogger({
    level: config.logLevel,
    service: config.serviceName,
    version: config.version,
  })

  const app = await NestFactory.create(AppModule, { logger: false })

  if (config.corsOrigins.length > 0) {
    app.enableCors({
      origin: [...config.corsOrigins],
      credentials: true,
    })
  }

  app.setGlobalPrefix(config.globalPrefix)

  app.useGlobalPipes(
    new ValidationPipe({
      // Se descartan las propiedades no declaradas y se rechaza la peticion si
      // llegan campos desconocidos: evita que un cliente inyecte datos que el
      // contrato no contempla.
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  )

  app.enableShutdownHooks()

  if (config.swaggerEnabled) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Nexus Battles VI — Account')
        .setDescription('API del bounded context Account/Identity.')
        .setVersion(config.version)
        .build(),
    )

    SwaggerModule.setup(`${config.globalPrefix}/docs`, app, document)
  }

  await app.listen(config.port)

  logger.info('service_started', {
    port: config.port,
    globalPrefix: config.globalPrefix,
    persistenceDriver: config.persistenceDriver,
    swagger: config.swaggerEnabled,
  })
}

void bootstrap()
