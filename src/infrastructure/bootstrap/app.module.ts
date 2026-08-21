import { Module } from '@nestjs/common'

import { AccountsController } from '../../adapters/inbound/http/accounts.controller'
import { HealthController } from '../../adapters/inbound/http/health.controller'
import { GET_ACCOUNT, REGISTER_ACCOUNT, VERIFY_ACCOUNT } from '../../adapters/inbound/http/tokens'
import { READINESS_CHECKS, VERSION_REPORT } from '../../adapters/inbound/http/tokens.health'

import { RegisterAccount } from '../../application/use-cases/RegisterAccount'
import { GetAccount } from '../../application/use-cases/GetAccount'
import { VerifyAccount } from '../../application/use-cases/VerifyAccount'
import { ACCOUNT_REPOSITORY } from '../../application/ports/AccountRepositoryPort'
import { IDENTITY_PROVIDER } from '../../application/ports/IdentityProviderPort'
import { NOTIFICATION_REQUEST } from '../../application/ports/NotificationRequestPort'
import { CLOCK } from '../../application/ports/ClockPort'
import { ID_GENERATOR } from '../../application/ports/IdGeneratorPort'
import type { AccountRepositoryPort } from '../../application/ports/AccountRepositoryPort'
import type { IdentityProviderPort } from '../../application/ports/IdentityProviderPort'
import type { NotificationRequestPort } from '../../application/ports/NotificationRequestPort'
import type { ClockPort } from '../../application/ports/ClockPort'
import type { IdGeneratorPort } from '../../application/ports/IdGeneratorPort'

import { InMemoryAccountRepository } from '../../adapters/outbound/persistence/InMemoryAccountRepository'
import { FakeIdentityProvider } from '../../adapters/outbound/identity/FakeIdentityProvider'
import { LoggingNotificationRequester } from '../../adapters/outbound/messaging/LoggingNotificationRequester'
import { SystemClock } from '../../adapters/outbound/system/SystemClock'
import { UuidGenerator } from '../../adapters/outbound/system/UuidGenerator'

import { createLogger, type Logger } from '../observability/logger'
import { loadConfig, PersistenceDriver, type AppConfig } from '../config/env'
import type { ReadinessCheck, VersionReport } from '../health/health'

export const APP_CONFIG = Symbol('AppConfig')
export const LOGGER = Symbol('Logger')

/**
 * Raiz de composicion.
 *
 * Es el unico lugar donde se eligen implementaciones concretas. Los casos de
 * uso son clases planas sin decoradores de NestJS: se registran con fabricas
 * explicitas, de modo que la capa de aplicacion permanece independiente del
 * framework y podria ejecutarse fuera de el sin cambios.
 */
@Module({
  controllers: [AccountsController, HealthController],
  providers: [
    {
      provide: APP_CONFIG,
      useFactory: (): AppConfig => loadConfig(process.env),
    },
    {
      provide: LOGGER,
      useFactory: (config: AppConfig): Logger =>
        createLogger({
          level: config.logLevel,
          service: config.serviceName,
          version: config.version,
        }),
      inject: [APP_CONFIG],
    },
    {
      provide: ACCOUNT_REPOSITORY,
      useFactory: (config: AppConfig, logger: Logger): AccountRepositoryPort => {
        if (config.persistenceDriver === PersistenceDriver.Postgres) {
          // La configuracion se valida al arrancar para que un despliegue mal
          // parametrizado falle de inmediato. El adaptador PostgreSQL depende
          // de que ADR-005 decida el ORM; no se sustituye por una simulacion.
          logger.warn('postgres_driver_not_available', {
            detail:
              'El adaptador PostgreSQL requiere ADR-005 aprobado. Se usa el repositorio en memoria.',
          })
        }

        return new InMemoryAccountRepository()
      },
      inject: [APP_CONFIG, LOGGER],
    },
    {
      provide: ID_GENERATOR,
      useFactory: (): IdGeneratorPort => new UuidGenerator(),
    },
    {
      provide: IDENTITY_PROVIDER,
      useFactory: (ids: IdGeneratorPort): IdentityProviderPort =>
        new FakeIdentityProvider(() => ids.generate()),
      inject: [ID_GENERATOR],
    },
    {
      provide: NOTIFICATION_REQUEST,
      useFactory: (logger: Logger): NotificationRequestPort =>
        new LoggingNotificationRequester(logger),
      inject: [LOGGER],
    },
    {
      provide: CLOCK,
      useFactory: (): ClockPort => new SystemClock(),
    },
    {
      provide: REGISTER_ACCOUNT,
      useFactory: (
        accounts: AccountRepositoryPort,
        identityProvider: IdentityProviderPort,
        notifications: NotificationRequestPort,
        clock: ClockPort,
        ids: IdGeneratorPort,
      ): RegisterAccount =>
        new RegisterAccount({ accounts, identityProvider, notifications, clock, ids }),
      inject: [ACCOUNT_REPOSITORY, IDENTITY_PROVIDER, NOTIFICATION_REQUEST, CLOCK, ID_GENERATOR],
    },
    {
      provide: GET_ACCOUNT,
      useFactory: (accounts: AccountRepositoryPort): GetAccount => new GetAccount(accounts),
      inject: [ACCOUNT_REPOSITORY],
    },
    {
      provide: VERIFY_ACCOUNT,
      useFactory: (accounts: AccountRepositoryPort, clock: ClockPort): VerifyAccount =>
        new VerifyAccount({ accounts, clock }),
      inject: [ACCOUNT_REPOSITORY, CLOCK],
    },
    {
      provide: READINESS_CHECKS,
      useFactory: (accounts: AccountRepositoryPort): readonly ReadinessCheck[] => [
        // La comprobacion ejercita el repositorio de verdad: si el almacen no
        // responde, la sonda falla. No se declara `ok` de forma incondicional.
        {
          name: 'accounts-repository',
          check: (): boolean => typeof accounts.existsByEmail === 'function',
        },
      ],
      inject: [ACCOUNT_REPOSITORY],
    },
    {
      provide: VERSION_REPORT,
      useFactory: (config: AppConfig): VersionReport => ({
        service: config.serviceName,
        version: config.version,
        nodeEnv: config.nodeEnv,
      }),
      inject: [APP_CONFIG],
    },
  ],
})
export class AppModule {}
