import { Module, type CanActivate } from '@nestjs/common'
import { APP_GUARD, Reflector } from '@nestjs/core'

import { AccountsController } from '../../adapters/inbound/http/accounts.controller'
import { RecoveryController } from '../../adapters/inbound/http/recovery.controller'
import { MfaController } from '../../adapters/inbound/http/mfa.controller'
import { PasswordController } from '../../adapters/inbound/http/password.controller'
import { AccountDeletionController } from '../../adapters/inbound/http/account-deletion.controller'
import { SessionsController } from '../../adapters/inbound/http/sessions.controller'
import { InternalMfaEvidenceController } from '../../adapters/inbound/http/internal-mfa-evidence.controller'
import { InternalServiceGuard } from '../../adapters/inbound/http/auth/internal-service.guard'
import { VerifyMfaEvidence } from '../../application/use-cases/VerifyMfaEvidence'
import { MFA_EVIDENCE_REPOSITORY } from '../../application/ports/MfaEvidenceRepositoryPort'
import type { MfaEvidenceRepositoryPort } from '../../application/ports/MfaEvidenceRepositoryPort'
import { InMemoryMfaEvidenceRepository } from '../../adapters/outbound/persistence/InMemoryMfaEvidenceRepository'
import { PostgresMfaEvidenceRepository } from '../../adapters/outbound/persistence/PostgresMfaEvidenceRepository'
import { VERIFY_MFA_EVIDENCE } from '../../adapters/inbound/http/tokens'
import { HealthController } from '../../adapters/inbound/http/health.controller'
import {
  CHOOSE_SECOND_FACTOR,
  COMPLETE_SECOND_FACTOR,
  GET_ACCOUNT,
  GET_OWN_ACCOUNT,
  UPDATE_OWN_ACCOUNT,
  CHANGE_OWN_PASSWORD,
  LOGIN_ACCOUNT,
  REGISTER_ACCOUNT,
  VERIFY_ACCOUNT,
  CONFIRM_REGISTRATION,
  ENROLL_TOTP,
  CONFIRM_TOTP_ENROLLMENT,
  FIND_ACCOUNT_BY_EMAIL,
  ASSIGN_ROLE,
  REVOKE_ROLE,
  LOGOUT_ACCOUNT,
  RESET_RECOVERY_PASSWORD,
  START_PASSWORD_RECOVERY,
  VERIFY_RECOVERY_ANSWERS,
  VERIFY_RECOVERY_CODE,
  LIST_ADMIN_ACCOUNTS,
  EXPORT_ADMIN_ACCOUNTS,
  REQUEST_ACCOUNT_DELETION,
  PROCESS_ACCOUNT_DELETION,
} from '../../adapters/inbound/http/tokens'
import { READINESS_CHECKS, VERSION_REPORT } from '../../adapters/inbound/http/tokens.health'

import { RegisterAccount } from '../../application/use-cases/RegisterAccount'
import { ConfirmRegistration } from '../../application/use-cases/ConfirmRegistration'
import { EnrollTotp } from '../../application/use-cases/EnrollTotp'
import { ConfirmTotpEnrollment } from '../../application/use-cases/ConfirmTotpEnrollment'
import { GetAccount } from '../../application/use-cases/GetAccount'
import { GetOwnAccount } from '../../application/use-cases/GetOwnAccount'
import { UpdateOwnAccount } from '../../application/use-cases/UpdateOwnAccount'
import { ChangeOwnPassword } from '../../application/use-cases/ChangeOwnPassword'
import { VerifyAccount } from '../../application/use-cases/VerifyAccount'
import { LoginAccount } from '../../application/use-cases/LoginAccount'
import { LogoutAccount } from '../../application/use-cases/LogoutAccount'
import { StartPasswordRecovery } from '../../application/use-cases/StartPasswordRecovery'
import { VerifyRecoveryAnswers } from '../../application/use-cases/VerifyRecoveryAnswers'
import { VerifyRecoveryCode } from '../../application/use-cases/VerifyRecoveryCode'
import { ResetRecoveryPassword } from '../../application/use-cases/ResetRecoveryPassword'
import { ChooseSecondFactor } from '../../application/use-cases/ChooseSecondFactor'
import { CompleteSecondFactor } from '../../application/use-cases/CompleteSecondFactor'
import { AssignRole } from '../../application/use-cases/AssignRole'
import { FindAccountByEmail } from '../../application/use-cases/FindAccountByEmail'
import { ListAdminAccounts } from '../../application/use-cases/ListAdminAccounts'
import { ExportAdminAccounts } from '../../application/use-cases/ExportAdminAccounts'
import { RequestAccountDeletion } from '../../application/use-cases/RequestAccountDeletion'
import { ProcessAccountDeletion } from '../../application/use-cases/ProcessAccountDeletion'
import { RevokeRole } from '../../application/use-cases/RevokeRole'
import { ACCOUNT_REPOSITORY } from '../../application/ports/AccountRepositoryPort'
import {
  ADMIN_ACCOUNT_QUERY,
  type AdminAccountQueryPort,
} from '../../application/ports/AdminAccountQueryPort'
import {
  ADMIN_ACCOUNT_EXPORT,
  type AdminAccountExportPort,
} from '../../application/ports/AdminAccountExportPort'
import { AUTHENTICATION_PROVIDER } from '../../application/ports/AuthenticationProviderPort'
import { ROLE_DIRECTORY, type RoleDirectoryPort } from '../../application/ports/RoleDirectoryPort'
import {
  IDENTITY_SIGN_UP,
  type IdentitySignUpPort,
} from '../../application/ports/IdentitySignUpPort'
import {
  TOTP_ENROLLMENT,
  type TotpEnrollmentPort,
} from '../../application/ports/TotpEnrollmentPort'
import { MFA_STATUS, type MfaStatusPort } from '../../application/ports/MfaStatusPort'
import {
  SESSION_REVOCATION,
  type SessionRevocationPort,
} from '../../application/ports/SessionRevocationPort'
import {
  PASSWORD_CHANGE,
  type PasswordChangePort,
} from '../../application/ports/PasswordChangePort'
import { NOTIFICATION_REQUEST } from '../../application/ports/NotificationRequestPort'
import {
  IDENTITY_PASSWORD_RESET,
  type IdentityPasswordResetPort,
} from '../../application/ports/IdentityPasswordResetPort'
import { RECOVERY_CHALLENGE_REPOSITORY } from '../../application/ports/RecoveryChallengeRepositoryPort'
import type { RecoveryChallengeRepositoryPort } from '../../application/ports/RecoveryChallengeRepositoryPort'
import { ACCOUNT_DELETION_REQUEST_REPOSITORY } from '../../application/ports/AccountDeletionRequestRepositoryPort'
import type { AccountDeletionRequestRepositoryPort } from '../../application/ports/AccountDeletionRequestRepositoryPort'
import { RECOVERY_OTP } from '../../application/ports/RecoveryOtpPort'
import type { RecoveryOtpPort } from '../../application/ports/RecoveryOtpPort'
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
import { JsonAdminAccountExportAdapter } from '../../adapters/outbound/export/JsonAdminAccountExportAdapter'
import { createDatabase } from '../persistence/database'
import type { Database } from '../../adapters/outbound/persistence/schema'
import type { Kysely } from 'kysely'
import { FakeAuthenticationProvider } from '../../adapters/outbound/identity/FakeAuthenticationProvider'
import { CognitoAuthenticationProvider } from '../../adapters/outbound/identity/CognitoAuthenticationProvider'
import { CognitoRoleDirectory } from '../../adapters/outbound/identity/CognitoRoleDirectory'
import { InMemoryRoleDirectory } from '../../adapters/outbound/identity/InMemoryRoleDirectory'
import { CognitoIdentitySignUp } from '../../adapters/outbound/identity/CognitoIdentitySignUp'
import { InMemoryIdentitySignUp } from '../../adapters/outbound/identity/InMemoryIdentitySignUp'
import { CognitoTotpEnrollment } from '../../adapters/outbound/identity/CognitoTotpEnrollment'
import { InMemoryTotpEnrollment } from '../../adapters/outbound/identity/InMemoryTotpEnrollment'
import { CognitoMfaStatus } from '../../adapters/outbound/identity/CognitoMfaStatus'
import { InMemoryMfaStatus } from '../../adapters/outbound/identity/InMemoryMfaStatus'
import { CognitoSessionRevocation } from '../../adapters/outbound/identity/CognitoSessionRevocation'
import { InMemorySessionRevocation } from '../../adapters/outbound/identity/InMemorySessionRevocation'
import { CognitoPasswordChange } from '../../adapters/outbound/identity/CognitoPasswordChange'
import { InMemoryPasswordChange } from '../../adapters/outbound/identity/InMemoryPasswordChange'
import { LoggingNotificationRequester } from '../../adapters/outbound/messaging/LoggingNotificationRequester'
import { HttpNotificationRequester } from '../../adapters/outbound/messaging/HttpNotificationRequester'
import { InMemoryRecoveryChallengeRepository } from '../../adapters/outbound/persistence/InMemoryRecoveryChallengeRepository'
import { PostgresRecoveryChallengeRepository } from '../../adapters/outbound/persistence/PostgresRecoveryChallengeRepository'
import { InMemoryAccountDeletionRequestRepository } from '../../adapters/outbound/persistence/InMemoryAccountDeletionRequestRepository'
import { PostgresAccountDeletionRequestRepository } from '../../adapters/outbound/persistence/PostgresAccountDeletionRequestRepository'
import { FixedRecoveryOtp } from '../../adapters/outbound/identity/FixedRecoveryOtp'
import { RandomRecoveryOtp } from '../../adapters/outbound/identity/RandomRecoveryOtp'
import { CognitoIdentityPasswordReset } from '../../adapters/outbound/identity/CognitoIdentityPasswordReset'
import { SystemClock } from '../../adapters/outbound/system/SystemClock'
import { UuidGenerator } from '../../adapters/outbound/system/UuidGenerator'

import { AccountDeletionProcessingScheduler } from '../scheduling/AccountDeletionProcessingScheduler'
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
  controllers: [
    AccountsController,
    RecoveryController,
    MfaController,
    PasswordController,
    AccountDeletionController,
    SessionsController,
    InternalMfaEvidenceController,
    HealthController,
  ],
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
      provide: ADMIN_ACCOUNT_QUERY,
      useExisting: ACCOUNT_REPOSITORY,
    },
    {
      provide: ADMIN_ACCOUNT_EXPORT,
      useFactory: (): AdminAccountExportPort => new JsonAdminAccountExportAdapter(),
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
    // El contrato interno se comprueba ANTES que la identidad de usuario: sus
    // rutas no llevan testimonio y no tienen nada que hacer en los guards
    // siguientes. Solo actua sobre las marcadas con `@InternalOnly()`.
    //
    // A diferencia de los otros dos, este se registra HAYA O NO proveedor de
    // identidad: la proteccion del contrato interno no depende de como se
    // autentiquen las personas.
    {
      provide: APP_GUARD,
      useFactory: (
        config: AppConfig,
        reflector: Reflector,
        clock: ClockPort,
        logger: Logger,
      ): CanActivate =>
        new InternalServiceGuard({
          reflector,
          secret: config.internalServiceAuthSecret,
          allowedServices: config.internalServiceAllowed,
          clock,
          logger,
        }),
      inject: [APP_CONFIG, Reflector, CLOCK, LOGGER],
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
      useFactory: (config: AppConfig, logger: Logger): NotificationRequestPort =>
        config.notificationsIngestUrl === null
          ? new LoggingNotificationRequester(logger)
          : new HttpNotificationRequester({
              ingestUrl: config.notificationsIngestUrl,
              logger,
            }),
      inject: [APP_CONFIG, LOGGER],
    },
    {
      provide: CLOCK,
      useFactory: (): ClockPort => new SystemClock(),
    },
    {
      // El pool refleja lo que Account decide, nunca al reves. Sin proveedor
      // configurado no hay donde reflejar -ni testimonios que puedan divergir-
      // asi que el doble en memoria es la respuesta correcta, no un parche.
      provide: ROLE_DIRECTORY,
      useFactory: (config: AppConfig, logger: Logger): RoleDirectoryPort => {
        if (config.cognito === null) {
          logger.warn('role_directory', {
            driver: 'memoria',
            detail:
              'Sin proveedor de identidad: el rol no viaja en ningun testimonio porque no hay testimonios.',
          })

          return new InMemoryRoleDirectory()
        }

        logger.info('role_directory', { driver: 'cognito' })

        return new CognitoRoleDirectory({ userPoolId: config.cognito.userPoolId })
      },
      inject: [APP_CONFIG, LOGGER],
    },
    {
      // El alta de identidad ocurre detras de la UI de Web (ADR-004, "Alta
      // server-side"): este puerto crea la identidad en Cognito y confirma su
      // correo. Sin proveedor configurado, el doble en memoria reproduce el
      // contrato completo -incluida la confirmacion por codigo- para desarrollo.
      provide: IDENTITY_SIGN_UP,
      useFactory: (config: AppConfig, logger: Logger): IdentitySignUpPort => {
        if (config.cognito === null) {
          logger.warn('identity_sign_up', {
            driver: 'memoria',
            detail: 'Sin proveedor de identidad: el alta no llega a Cognito.',
          })

          return new InMemoryIdentitySignUp()
        }

        logger.info('identity_sign_up', { driver: 'cognito' })

        return new CognitoIdentitySignUp(config.cognito)
      },
      inject: [APP_CONFIG, LOGGER],
    },
    {
      // Inscripcion TOTP self-service. Actua sobre el testimonio del usuario, no
      // sobre credenciales de AWS; sin proveedor configurado, el doble en memoria
      // reproduce el contrato (asociar -> confirmar con codigo fijo).
      provide: TOTP_ENROLLMENT,
      useFactory: (config: AppConfig, logger: Logger): TotpEnrollmentPort => {
        if (config.cognito === null) {
          logger.warn('totp_enrollment', {
            driver: 'memoria',
            detail: 'Sin proveedor de identidad: la inscripcion TOTP no llega a Cognito.',
          })

          return new InMemoryTotpEnrollment()
        }

        logger.info('totp_enrollment', { driver: 'cognito' })

        return new CognitoTotpEnrollment({ userPoolId: config.cognito.userPoolId })
      },
      inject: [APP_CONFIG, LOGGER],
    },
    {
      provide: MFA_STATUS,
      useFactory: (config: AppConfig, logger: Logger): MfaStatusPort => {
        if (config.cognito === null) {
          logger.warn('mfa_status', {
            driver: 'memoria',
            detail: 'Sin proveedor de identidad: el estado TOTP vive solo en memoria.',
          })

          return new InMemoryMfaStatus()
        }

        return new CognitoMfaStatus({ userPoolId: config.cognito.userPoolId })
      },
      inject: [APP_CONFIG, LOGGER],
    },
    {
      provide: SESSION_REVOCATION,
      useFactory: (config: AppConfig, logger: Logger): SessionRevocationPort => {
        if (config.cognito === null) {
          logger.warn('session_revocation', {
            driver: 'memoria',
            detail: 'Sin proveedor de identidad: el cierre global vive solo en memoria.',
          })

          return new InMemorySessionRevocation()
        }

        return new CognitoSessionRevocation({ userPoolId: config.cognito.userPoolId })
      },
      inject: [APP_CONFIG, LOGGER],
    },
    {
      // Cambio de contrasena self-service (HU-05). Actua sobre el testimonio del
      // usuario, no sobre credenciales de AWS; sin proveedor configurado, el
      // doble en memoria reproduce el contrato (actual correcta -> cambiada).
      provide: PASSWORD_CHANGE,
      useFactory: (config: AppConfig, logger: Logger): PasswordChangePort => {
        if (config.cognito === null) {
          logger.warn('password_change', {
            driver: 'memoria',
            detail: 'Sin proveedor de identidad: el cambio de contrasena no llega a Cognito.',
          })

          return new InMemoryPasswordChange()
        }

        logger.info('password_change', { driver: 'cognito' })

        return new CognitoPasswordChange({ userPoolId: config.cognito.userPoolId })
      },
      inject: [APP_CONFIG, LOGGER],
    },
    {
      provide: ENROLL_TOTP,
      useFactory: (
        totpEnrollment: TotpEnrollmentPort,
        accounts: AccountRepositoryPort,
      ): EnrollTotp => new EnrollTotp({ totpEnrollment, accounts }),
      inject: [TOTP_ENROLLMENT, ACCOUNT_REPOSITORY],
    },
    {
      provide: CONFIRM_TOTP_ENROLLMENT,
      useFactory: (totpEnrollment: TotpEnrollmentPort): ConfirmTotpEnrollment =>
        new ConfirmTotpEnrollment({ totpEnrollment }),
      inject: [TOTP_ENROLLMENT],
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
        roleDirectory: RoleDirectoryPort,
        identitySignUp: IdentitySignUpPort,
      ): RegisterAccount =>
        new RegisterAccount({
          accounts,
          notifications,
          clock,
          ids,
          avatars,
          blacklist,
          questions,
          roleDirectory,
          identitySignUp,
        }),
      inject: [
        ACCOUNT_REPOSITORY,
        NOTIFICATION_REQUEST,
        CLOCK,
        ID_GENERATOR,
        AVATAR_STORAGE,
        NICKNAME_BLACKLIST,
        SECURITY_QUESTION_CATALOG,
        ROLE_DIRECTORY,
        IDENTITY_SIGN_UP,
      ],
    },
    {
      provide: CONFIRM_REGISTRATION,
      useFactory: (
        accounts: AccountRepositoryPort,
        identitySignUp: IdentitySignUpPort,
        clock: ClockPort,
      ): ConfirmRegistration => new ConfirmRegistration({ accounts, identitySignUp, clock }),
      inject: [ACCOUNT_REPOSITORY, IDENTITY_SIGN_UP, CLOCK],
    },
    {
      provide: GET_ACCOUNT,
      useFactory: (accounts: AccountRepositoryPort): GetAccount => new GetAccount(accounts),
      inject: [ACCOUNT_REPOSITORY],
    },
    {
      provide: FIND_ACCOUNT_BY_EMAIL,
      useFactory: (accounts: AccountRepositoryPort, mfaStatus: MfaStatusPort): FindAccountByEmail =>
        new FindAccountByEmail(accounts, mfaStatus),
      inject: [ACCOUNT_REPOSITORY, MFA_STATUS],
    },
    {
      provide: LIST_ADMIN_ACCOUNTS,
      useFactory: (accounts: AdminAccountQueryPort): ListAdminAccounts =>
        new ListAdminAccounts(accounts),
      inject: [ADMIN_ACCOUNT_QUERY],
    },
    {
      provide: EXPORT_ADMIN_ACCOUNTS,
      useFactory: (
        listAdminAccounts: ListAdminAccounts,
        exporter: AdminAccountExportPort,
      ): ExportAdminAccounts => new ExportAdminAccounts(listAdminAccounts, exporter),
      inject: [LIST_ADMIN_ACCOUNTS, ADMIN_ACCOUNT_EXPORT],
    },
    {
      provide: ASSIGN_ROLE,
      useFactory: (
        accounts: AccountRepositoryPort,
        roleDirectory: RoleDirectoryPort,
        mfaStatus: MfaStatusPort,
      ): AssignRole => new AssignRole(accounts, roleDirectory, mfaStatus),
      inject: [ACCOUNT_REPOSITORY, ROLE_DIRECTORY, MFA_STATUS],
    },
    {
      provide: REVOKE_ROLE,
      useFactory: (
        accounts: AccountRepositoryPort,
        roleDirectory: RoleDirectoryPort,
        sessionRevocation: SessionRevocationPort,
      ): RevokeRole => new RevokeRole(accounts, roleDirectory, sessionRevocation),
      inject: [ACCOUNT_REPOSITORY, ROLE_DIRECTORY, SESSION_REVOCATION],
    },
    {
      provide: GET_OWN_ACCOUNT,
      useFactory: (accounts: AccountRepositoryPort): GetOwnAccount => new GetOwnAccount(accounts),
      inject: [ACCOUNT_REPOSITORY],
    },
    {
      provide: UPDATE_OWN_ACCOUNT,
      useFactory: (
        accounts: AccountRepositoryPort,
        blacklist: NicknameBlacklistPort,
      ): UpdateOwnAccount => new UpdateOwnAccount(accounts, blacklist),
      inject: [ACCOUNT_REPOSITORY, NICKNAME_BLACKLIST],
    },
    {
      provide: CHANGE_OWN_PASSWORD,
      useFactory: (passwords: PasswordChangePort): ChangeOwnPassword =>
        new ChangeOwnPassword({ passwords }),
      inject: [PASSWORD_CHANGE],
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
        tokenVerifier: TokenVerifierPort,
        mfaEvidence: MfaEvidenceRepositoryPort,
        clock: ClockPort,
        logger: Logger,
      ): CompleteSecondFactor =>
        new CompleteSecondFactor({
          accounts,
          authenticationProvider,
          tokenVerifier,
          mfaEvidence,
          clock,
          logger,
        }),
      inject: [
        ACCOUNT_REPOSITORY,
        AUTHENTICATION_PROVIDER,
        TOKEN_VERIFIER,
        MFA_EVIDENCE_REPOSITORY,
        CLOCK,
        LOGGER,
      ],
    },
    {
      // La evidencia acompana a la cuenta: mismo motor, misma transaccionalidad.
      provide: MFA_EVIDENCE_REPOSITORY,
      useFactory: (db: Kysely<Database> | null): MfaEvidenceRepositoryPort =>
        db === null ? new InMemoryMfaEvidenceRepository() : new PostgresMfaEvidenceRepository(db),
      inject: [DATABASE],
    },
    {
      provide: VERIFY_MFA_EVIDENCE,
      useFactory: (mfaEvidence: MfaEvidenceRepositoryPort, clock: ClockPort): VerifyMfaEvidence =>
        new VerifyMfaEvidence({ mfaEvidence, clock }),
      inject: [MFA_EVIDENCE_REPOSITORY, CLOCK],
    },
    {
      provide: CHOOSE_SECOND_FACTOR,
      useFactory: (
        accounts: AccountRepositoryPort,
        authenticationProvider: AuthenticationProviderPort,
      ): ChooseSecondFactor => new ChooseSecondFactor({ accounts, authenticationProvider }),
      inject: [ACCOUNT_REPOSITORY, AUTHENTICATION_PROVIDER],
    },
    {
      provide: RECOVERY_CHALLENGE_REPOSITORY,
      useFactory: (db: Kysely<Database> | null): RecoveryChallengeRepositoryPort =>
        db === null
          ? new InMemoryRecoveryChallengeRepository()
          : new PostgresRecoveryChallengeRepository(db),
      inject: [DATABASE],
    },
    {
      // HU-43.1 (Management #303): persistencia de la solicitud durable,
      // con el mismo `PERSISTENCE_DRIVER` que el resto de repositorios. Ver
      // ADR-014 Decision 5 y EN-011 (Management #197).
      provide: ACCOUNT_DELETION_REQUEST_REPOSITORY,
      useFactory: (db: Kysely<Database> | null): AccountDeletionRequestRepositoryPort =>
        db === null
          ? new InMemoryAccountDeletionRequestRepository()
          : new PostgresAccountDeletionRequestRepository(db),
      inject: [DATABASE],
    },
    {
      // HU-43.2 (Management #304): solicitud segura + confirmacion de
      // recepcion, sobre la persistencia de HU-43.1. Sigue sin ejecutar el
      // tratamiento de datos personales ni cerrar la solicitud.
      provide: REQUEST_ACCOUNT_DELETION,
      useFactory: (
        accounts: AccountRepositoryPort,
        deletionRequests: AccountDeletionRequestRepositoryPort,
        clock: ClockPort,
        ids: IdGeneratorPort,
      ): RequestAccountDeletion =>
        new RequestAccountDeletion({ accounts, deletionRequests, clock, ids }),
      inject: [ACCOUNT_REPOSITORY, ACCOUNT_DELETION_REQUEST_REPOSITORY, CLOCK, ID_GENERATOR],
    },
    {
      // HU-43.3 (Management #305): tratamiento durable de datos personales y
      // cierre. Sin ruta HTTP: lo invoca unicamente
      // `AccountDeletionProcessingScheduler`.
      provide: PROCESS_ACCOUNT_DELETION,
      useFactory: (
        accounts: AccountRepositoryPort,
        deletionRequests: AccountDeletionRequestRepositoryPort,
        avatars: AvatarStoragePort,
        notifications: NotificationRequestPort,
        clock: ClockPort,
        logger: Logger,
      ): ProcessAccountDeletion =>
        new ProcessAccountDeletion({
          accounts,
          deletionRequests,
          avatars,
          notifications,
          clock,
          logger,
        }),
      inject: [
        ACCOUNT_REPOSITORY,
        ACCOUNT_DELETION_REQUEST_REPOSITORY,
        AVATAR_STORAGE,
        NOTIFICATION_REQUEST,
        CLOCK,
        LOGGER,
      ],
    },
    {
      // Arranca (o no) segun `ACCOUNT_DELETION_PROCESSING_ENABLED`. Es un
      // provider mas de la raiz de composicion: Nest invoca sus ganchos de
      // ciclo de vida (`onModuleInit`/`onModuleDestroy`) sobre CUALQUIER
      // instancia de provider que los implemente, sin exigir `@Injectable()`
      // ni una clase registrada de otra forma -mismo patron de clase plana
      // que el resto de casos de uso de este modulo.
      provide: AccountDeletionProcessingScheduler,
      useFactory: (
        config: AppConfig,
        deletionRequests: AccountDeletionRequestRepositoryPort,
        processAccountDeletion: ProcessAccountDeletion,
        logger: Logger,
      ): AccountDeletionProcessingScheduler =>
        new AccountDeletionProcessingScheduler({
          enabled: config.accountDeletionProcessingEnabled,
          intervalMs: config.accountDeletionProcessingIntervalMs,
          deletionRequests,
          processAccountDeletion,
          logger,
        }),
      inject: [APP_CONFIG, ACCOUNT_DELETION_REQUEST_REPOSITORY, PROCESS_ACCOUNT_DELETION, LOGGER],
    },
    {
      // Con proveedor de identidad real, el codigo debe ser impredecible
      // (`RandomRecoveryOtp`): uno fijo en produccion seria adivinable por
      // construccion. Sin proveedor configurado se mantiene el fijo `000000`,
      // igual que la confirmacion de HU-01.
      provide: RECOVERY_OTP,
      useFactory: (config: AppConfig, logger: Logger): RecoveryOtpPort => {
        if (config.cognito === null) {
          logger.warn('recovery_otp', {
            driver: 'fijo',
            detail: 'Sin proveedor de identidad: el codigo de recuperacion es fijo (000000).',
          })

          return new FixedRecoveryOtp()
        }

        logger.info('recovery_otp', { driver: 'aleatorio' })

        return new RandomRecoveryOtp()
      },
      inject: [APP_CONFIG, LOGGER],
    },
    {
      provide: IDENTITY_PASSWORD_RESET,
      useFactory: (
        authentication: AuthenticationProviderPort,
        config: AppConfig,
        logger: Logger,
      ): IdentityPasswordResetPort => {
        if (authentication instanceof FakeAuthenticationProvider) {
          return authentication
        }

        if (config.cognito === null) {
          logger.warn('identity_password_reset', {
            driver: 'ninguno',
            detail: 'Sin proveedor de identidad configurado: el restablecimiento siempre falla.',
          })

          return {
            setPassword: (): Promise<{ kind: 'failed' }> => Promise.resolve({ kind: 'failed' }),
          }
        }

        logger.info('identity_password_reset', { driver: 'cognito' })

        return new CognitoIdentityPasswordReset({
          userPoolId: config.cognito.userPoolId,
          logger,
        })
      },
      inject: [AUTHENTICATION_PROVIDER, APP_CONFIG, LOGGER],
    },
    {
      provide: START_PASSWORD_RECOVERY,
      useFactory: (
        accounts: AccountRepositoryPort,
        challenges: RecoveryChallengeRepositoryPort,
        questions: SecurityQuestionCatalogPort,
        ids: IdGeneratorPort,
        clock: ClockPort,
      ): StartPasswordRecovery =>
        new StartPasswordRecovery({ accounts, challenges, questions, ids, clock }),
      inject: [
        ACCOUNT_REPOSITORY,
        RECOVERY_CHALLENGE_REPOSITORY,
        SECURITY_QUESTION_CATALOG,
        ID_GENERATOR,
        CLOCK,
      ],
    },
    {
      provide: VERIFY_RECOVERY_ANSWERS,
      useFactory: (
        accounts: AccountRepositoryPort,
        challenges: RecoveryChallengeRepositoryPort,
        otp: RecoveryOtpPort,
        notifications: NotificationRequestPort,
        logger: Logger,
      ): VerifyRecoveryAnswers =>
        new VerifyRecoveryAnswers({ accounts, challenges, otp, notifications, logger }),
      inject: [
        ACCOUNT_REPOSITORY,
        RECOVERY_CHALLENGE_REPOSITORY,
        RECOVERY_OTP,
        NOTIFICATION_REQUEST,
        LOGGER,
      ],
    },
    {
      provide: VERIFY_RECOVERY_CODE,
      useFactory: (challenges: RecoveryChallengeRepositoryPort): VerifyRecoveryCode =>
        new VerifyRecoveryCode(challenges),
      inject: [RECOVERY_CHALLENGE_REPOSITORY],
    },
    {
      provide: RESET_RECOVERY_PASSWORD,
      useFactory: (
        challenges: RecoveryChallengeRepositoryPort,
        passwords: IdentityPasswordResetPort,
        notifications: NotificationRequestPort,
      ): ResetRecoveryPassword =>
        new ResetRecoveryPassword({ challenges, passwords, notifications }),
      inject: [RECOVERY_CHALLENGE_REPOSITORY, IDENTITY_PASSWORD_RESET, NOTIFICATION_REQUEST],
    },
    {
      provide: LOGOUT_ACCOUNT,
      useFactory: (sessionRevocation: SessionRevocationPort): LogoutAccount =>
        new LogoutAccount(sessionRevocation),
      inject: [SESSION_REVOCATION],
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
