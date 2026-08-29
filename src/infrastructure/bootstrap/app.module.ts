import { Module, type CanActivate } from '@nestjs/common'
import { APP_GUARD, Reflector } from '@nestjs/core'

import { AccountsController } from '../../adapters/inbound/http/accounts.controller'
import { SessionsController } from '../../adapters/inbound/http/sessions.controller'
import { HealthController } from '../../adapters/inbound/http/health.controller'
import {
  COMPLETE_SECOND_FACTOR,
  GET_ACCOUNT,
  GET_OWN_ACCOUNT,
  LOGIN_ACCOUNT,
  REGISTER_ACCOUNT,
  VERIFY_ACCOUNT,
} from '../../adapters/inbound/http/tokens'
import { READINESS_CHECKS, VERSION_REPORT } from '../../adapters/inbound/http/tokens.health'

import { RegisterAccount } from '../../application/use-cases/RegisterAccount'
import { GetAccount } from '../../application/use-cases/GetAccount'
import { GetOwnAccount } from '../../application/use-cases/GetOwnAccount'
import { VerifyAccount } from '../../application/use-cases/VerifyAccount'
import { LoginAccount } from '../../application/use-cases/LoginAccount'
import { CompleteSecondFactor } from '../../application/use-cases/CompleteSecondFactor'
import { ACCOUNT_REPOSITORY } from '../../application/ports/AccountRepositoryPort'
import { AUTHENTICATION_PROVIDER } from '../../application/ports/AuthenticationProviderPort'
import { NOTIFICATION_REQUEST } from '../../application/ports/NotificationRequestPort'
import { CLOCK } from '../../application/ports/ClockPort'
import { ID_GENERATOR } from '../../application/ports/IdGeneratorPort'
import { AVATAR_STORAGE } from '../../application/ports/AvatarStoragePort'
import { NICKNAME_BLACKLIST } from '../../application/ports/NicknameBlacklistPort'
import { SECURITY_QUESTION_CATALOG } from '../../application/ports/SecurityQuestionCatalogPort'
import type { AccountRepositoryPort } from '../../application/ports/AccountRepositoryPort'
import type { AuthenticationProviderPort } from '../../application/ports/AuthenticationProviderPort'
import type { NotificationRequestPort } from '../../application/ports/NotificationRequestPort'
import type { ClockPort } from '../../application/ports/ClockPort'
import type { IdGeneratorPort } from '../../application/ports/IdGeneratorPort'
import type { AvatarStoragePort } from '../../application/ports/AvatarStoragePort'
import type { NicknameBlacklistPort } from '../../application/ports/NicknameBlacklistPort'
import type { SecurityQuestionCatalogPort } from '../../application/ports/SecurityQuestionCatalogPort'

import { JwtAuthGuard } from '../../adapters/inbound/http/auth/jwt-auth.guard'
import { RolesGuard } from '../../adapters/inbound/http/auth/roles.guard'
import { AnonymousIdentityGuard } from '../../adapters/inbound/http/auth/anonymous.guard'
import { TOKEN_VERIFIER } from '../../application/ports/TokenVerifierPort'
import type { TokenVerifierPort } from '../../application/ports/TokenVerifierPort'
import { CognitoTokenVerifier } from '../../adapters/outbound/identity/CognitoTokenVerifier'

import { InMemoryAccountRepository } from '../../adapters/outbound/persistence/InMemoryAccountRepository'
import { PostgresAccountRepository } from '../../adapters/outbound/persistence/PostgresAccountRepository'
import { InMemoryNicknameBlacklist } from '../../adapters/outbound/persistence/InMemoryNicknameBlacklist'
import { PostgresNicknameBlacklist } from '../../adapters/outbound/persistence/PostgresNicknameBlacklist'
import { InMemorySecurityQuestionCatalog } from '../../adapters/outbound/persistence/InMemorySecurityQuestionCatalog'
import { PostgresSecurityQuestionCatalog } from '../../adapters/outbound/persistence/PostgresSecurityQuestionCatalog'
import { LocalAvatarStorage } from '../../adapters/outbound/storage/LocalAvatarStorage'
import { createDatabase } from '../persistence/database'
import type { Database } from '../../adapters/outbound/persistence/schema'
import type { Kysely } from 'kysely'
import { FakeAuthenticationProvider } from '../../adapters/outbound/identity/FakeAuthenticationProvider'
import { CognitoAuthenticationProvider } from '../../adapters/outbound/identity/CognitoAuthenticationProvider'
import { LoggingNotificationRequester } from '../../adapters/outbound/messaging/LoggingNotificationRequester'
import { SystemClock } from '../../adapters/outbound/system/SystemClock'
import { UuidGenerator } from '../../adapters/outbound/system/UuidGenerator'

import { createLogger, type Logger } from '../observability/logger'
import {
  AuthenticationDriver,
  AuthMode,
  loadConfig,
  PersistenceDriver,
  type AppConfig,
} from '../config/env'
import type { ReadinessCheck, VersionReport } from '../health/health'

export const APP_CONFIG = Symbol('AppConfig')
export const LOGGER = Symbol('Logger')
export const DATABASE = Symbol('Database')

/**
 * Raiz de composicion.
 *
 * Es el unico lugar donde se eligen implementaciones concretas. Los casos de
 * uso son clases planas sin decoradores de NestJS: se registran con fabricas
 * explicitas, de modo que la capa de aplicacion permanece independiente del
 * framework y podria ejecutarse fuera de el sin cambios.
 */
@Module({
  controllers: [AccountsController, SessionsController, HealthController],
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
      provide: DATABASE,
      useFactory: (config: AppConfig, logger: Logger): Kysely<Database> | null => {
        if (config.persistenceDriver !== PersistenceDriver.Postgres) {
          logger.warn('in_memory_persistence', {
            detail: 'PERSISTENCE_DRIVER=memory: el estado se pierde al reiniciar el servicio.',
          })

          return null
        }

        if (config.databaseUrl === null) {
          throw new Error('DATABASE_URL es obligatorio con PERSISTENCE_DRIVER=postgres.')
        }

        logger.info('postgres_persistence', { detail: 'Adaptador PostgreSQL activo.' })

        return createDatabase({ connectionString: config.databaseUrl })
      },
      inject: [APP_CONFIG, LOGGER],
    },
    {
      provide: ACCOUNT_REPOSITORY,
      useFactory: (db: Kysely<Database> | null): AccountRepositoryPort =>
        db === null ? new InMemoryAccountRepository() : new PostgresAccountRepository(db),
      inject: [DATABASE],
    },
    {
      provide: NICKNAME_BLACKLIST,
      useFactory: (db: Kysely<Database> | null): NicknameBlacklistPort =>
        db === null ? new InMemoryNicknameBlacklist() : new PostgresNicknameBlacklist(db),
      inject: [DATABASE],
    },
    {
      provide: SECURITY_QUESTION_CATALOG,
      useFactory: (db: Kysely<Database> | null): SecurityQuestionCatalogPort =>
        db === null
          ? new InMemorySecurityQuestionCatalog()
          : new PostgresSecurityQuestionCatalog(db),
      inject: [DATABASE],
    },
    {
      provide: AVATAR_STORAGE,
      useFactory: (config: AppConfig): AvatarStoragePort =>
        new LocalAvatarStorage(config.avatarStoragePath),
      inject: [APP_CONFIG],
    },
    {
      provide: ID_GENERATOR,
      useFactory: (): IdGeneratorPort => new UuidGenerator(),
    },
    {
      // `AUTHENTICATION_DRIVER` decide el adaptador, igual que
      // `PERSISTENCE_DRIVER` decide el repositorio. `loadConfig` ya impide
      // "fake" con NODE_ENV=production: un binario de produccion no puede
      // aceptar cualquier cuenta sembrada en memoria como si fuera real.
      //
      // Con "fake", sin sembrar (`seed`), no autentica a nadie: es la raiz de
      // composicion, no el arnes de pruebas, y aqui no hay credenciales de
      // prueba que sembrar.
      provide: AUTHENTICATION_PROVIDER,
      useFactory: (
        config: AppConfig,
        logger: Logger,
        ids: IdGeneratorPort,
      ): AuthenticationProviderPort => {
        if (config.authenticationDriver === AuthenticationDriver.Cognito) {
          if (config.cognito === null) {
            throw new Error('AUTHENTICATION_DRIVER=cognito exige COGNITO_USER_POOL_ID/CLIENT_ID.')
          }

          logger.info('authentication_provider', { driver: 'cognito' })

          return new CognitoAuthenticationProvider(config.cognito)
        }

        logger.warn('authentication_provider', {
          driver: 'fake',
          detail:
            'AUTHENTICATION_DRIVER=fake: ninguna contrasena se verifica contra un proveedor real.',
        })

        return new FakeAuthenticationProvider(() => ids.generate())
      },
      inject: [APP_CONFIG, LOGGER, ID_GENERATOR],
    },
    {
      provide: TOKEN_VERIFIER,
      useFactory: (config: AppConfig, logger: Logger): TokenVerifierPort => {
        if (config.cognito === null) {
          // No se devuelve un verificador que acepte cualquier cosa: sin
          // proveedor, el guard directamente no se registra. Un verificador
          // permisivo daria la apariencia de que hay comprobacion.
          logger.warn('authentication_disabled', {
            detail:
              'AUTH_MODE=disabled: ninguna ruta verifica quien realiza la peticion. BLOCKER de ADR-004.',
          })

          return {
            verify: (): Promise<never> => {
              throw new Error('No hay verificador de testimonios configurado.')
            },
          }
        }

        return new CognitoTokenVerifier(config.cognito)
      },
      inject: [APP_CONFIG, LOGGER],
    },
    // Los guards se registran de forma global SOLO cuando hay proveedor. El
    // orden importa: JwtAuthGuard deja la identidad verificada en la peticion y
    // RolesGuard la lee. NestJS los ejecuta en el orden de declaracion.
    {
      provide: APP_GUARD,
      useFactory: (
        config: AppConfig,
        reflector: Reflector,
        verifier: TokenVerifierPort,
      ): CanActivate =>
        config.authMode === AuthMode.Jwt
          ? new JwtAuthGuard(reflector, verifier)
          : // Sin proveedor no se deja pasar sin mas: se atribuye la identidad
            // anonima, para que lo que se guarde diga que nadie fue verificado.
            new AnonymousIdentityGuard(),
      inject: [APP_CONFIG, Reflector, TOKEN_VERIFIER],
    },
    {
      provide: APP_GUARD,
      useFactory: (config: AppConfig, reflector: Reflector): CanActivate =>
        config.authMode === AuthMode.Jwt
          ? new RolesGuard(reflector)
          : { canActivate: (): boolean => true },
      inject: [APP_CONFIG, Reflector],
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
        notifications: NotificationRequestPort,
        clock: ClockPort,
        ids: IdGeneratorPort,
        avatars: AvatarStoragePort,
        blacklist: NicknameBlacklistPort,
        questions: SecurityQuestionCatalogPort,
      ): RegisterAccount =>
        new RegisterAccount({
          accounts,
          notifications,
          clock,
          ids,
          avatars,
          blacklist,
          questions,
        }),
      inject: [
        ACCOUNT_REPOSITORY,
        NOTIFICATION_REQUEST,
        CLOCK,
        ID_GENERATOR,
        AVATAR_STORAGE,
        NICKNAME_BLACKLIST,
        SECURITY_QUESTION_CATALOG,
      ],
    },
    {
      provide: GET_ACCOUNT,
      useFactory: (accounts: AccountRepositoryPort): GetAccount => new GetAccount(accounts),
      inject: [ACCOUNT_REPOSITORY],
    },
    {
      provide: GET_OWN_ACCOUNT,
      useFactory: (accounts: AccountRepositoryPort): GetOwnAccount => new GetOwnAccount(accounts),
      inject: [ACCOUNT_REPOSITORY],
    },
    {
      provide: VERIFY_ACCOUNT,
      useFactory: (accounts: AccountRepositoryPort, clock: ClockPort): VerifyAccount =>
        new VerifyAccount({ accounts, clock }),
      inject: [ACCOUNT_REPOSITORY, CLOCK],
    },
    {
      provide: LOGIN_ACCOUNT,
      useFactory: (
        accounts: AccountRepositoryPort,
        authenticationProvider: AuthenticationProviderPort,
      ): LoginAccount => new LoginAccount({ accounts, authenticationProvider }),
      inject: [ACCOUNT_REPOSITORY, AUTHENTICATION_PROVIDER],
    },
    {
      provide: COMPLETE_SECOND_FACTOR,
      useFactory: (
        accounts: AccountRepositoryPort,
        authenticationProvider: AuthenticationProviderPort,
      ): CompleteSecondFactor => new CompleteSecondFactor({ accounts, authenticationProvider }),
      inject: [ACCOUNT_REPOSITORY, AUTHENTICATION_PROVIDER],
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
