import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { parseEnv } from 'node:util'

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigurationError'
  }
}

/**
 * Carga `.env` del directorio de trabajo si existe.
 *
 * No pisa variables ya definidas en el proceso: CI y el shell ganan.
 * `loadConfig` sigue siendo puro sobre el objeto que reciba.
 */
export const applyEnvFile = (cwd = process.cwd()): void => {
  const envPath = path.resolve(cwd, '.env')

  if (!existsSync(envPath)) {
    return
  }

  const parsed = parseEnv(readFileSync(envPath, 'utf8'))

  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined && value !== undefined) {
      process.env[key] = value
    }
  }
}

export const AuthMode = {
  /**
   * Sin verificacion de identidad. Es el estado que describe el BLOCKER de
   * ADR-004, no una opcion de conveniencia: ningun servicio comprueba quien
   * realiza la peticion.
   */
  Disabled: 'disabled',
  /** Se exige un testimonio firmado por el proveedor de identidad. */
  Jwt: 'jwt',
} as const

export type AuthMode = (typeof AuthMode)[keyof typeof AuthMode]

export interface CognitoConfig {
  readonly userPoolId: string
  readonly clientId: string
}

export const AuthenticationDriver = {
  /**
   * `FakeAuthenticationProvider`. Real y probado, sin credenciales de verdad.
   * Es el valor por defecto porque es lo unico que test y desarrollo local sin
   * red pueden usar sin depender de un pool de Cognito real.
   */
  Fake: 'fake',
  /** `CognitoAuthenticationProvider`. Verifica contrasena contra el pool real. */
  Cognito: 'cognito',
} as const

export type AuthenticationDriver = (typeof AuthenticationDriver)[keyof typeof AuthenticationDriver]

export const PersistenceDriver = {
  Memory: 'memory',
  Postgres: 'postgres',
} as const

export type PersistenceDriver = (typeof PersistenceDriver)[keyof typeof PersistenceDriver]

export interface AppConfig {
  readonly nodeEnv: 'development' | 'test' | 'production'
  readonly serviceName: string
  readonly version: string
  readonly logLevel: 'debug' | 'info' | 'warn' | 'error'
  readonly port: number
  readonly globalPrefix: string
  readonly swaggerEnabled: boolean
  readonly persistenceDriver: PersistenceDriver
  readonly databaseUrl: string | null
  readonly authMode: AuthMode
  readonly authenticationDriver: AuthenticationDriver
  readonly cognito: CognitoConfig | null
  readonly avatarStoragePath: string
  readonly corsOrigins: readonly string[]
  /** Ingest local de Notifications (`POST /dev/enqueue`). Vacio = solo log. */
  readonly notificationsIngestUrl: string | null
  /**
   * Secreto compartido del contrato interno entre servicios.
   *
   * Sin el, el guard interno NIEGA con 503 en lugar de dejar pasar: un
   * despliegue incompleto no debe convertirse en un endpoint interno abierto.
   */
  readonly internalServiceAuthSecret: string | null
  /** Servicios autorizados a invocar el contrato interno. */
  readonly internalServiceAllowed: readonly string[]
}

type RawEnv = Readonly<Record<string, string | undefined>>

/**
 * Servicios autorizados a firmar peticiones internas.
 *
 * La lista por defecto contiene `catalog` porque es el unico consumidor
 * previsto hoy. Declararla vacia por defecto obligaria a configurarla en todos
 * los entornos para que el contrato funcionara, y el sintoma -401 sin motivo
 * visible- seria dificil de atribuir.
 */
const readAllowedServices = (env: RawEnv): readonly string[] => {
  const raw = env.INTERNAL_SERVICE_ALLOWED_SERVICES

  if (raw === undefined || raw.trim().length === 0) {
    return ['catalog']
  }

  return raw
    .split(',')
    .map((service) => service.trim().toLowerCase())
    .filter((service) => service.length > 0)
}

const readEnum = <T extends string>(
  env: RawEnv,
  key: string,
  allowed: readonly T[],
  fallback: T,
): T => {
  const raw = env[key]

  if (raw === undefined || raw === '') {
    return fallback
  }

  if (!(allowed as readonly string[]).includes(raw)) {
    throw new ConfigurationError(
      `${key} debe ser uno de: ${allowed.join(', ')}. Se recibio "${raw}".`,
    )
  }

  return raw as T
}

const readInteger = (
  env: RawEnv,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number => {
  const raw = env[key]

  if (raw === undefined || raw === '') {
    return fallback
  }

  const parsed = Number(raw)

  if (!Number.isInteger(parsed)) {
    throw new ConfigurationError(`${key} debe ser un numero entero. Se recibio "${raw}".`)
  }

  if (parsed < min || parsed > max) {
    throw new ConfigurationError(
      `${key} debe estar entre ${String(min)} y ${String(max)}. Se recibio ${String(parsed)}.`,
    )
  }

  return parsed
}

const readString = (env: RawEnv, key: string, fallback: string): string => {
  const raw = env[key]

  return raw === undefined || raw === '' ? fallback : raw
}

const readBoolean = (env: RawEnv, key: string, fallback: boolean): boolean => {
  const raw = env[key]

  if (raw === undefined || raw === '') {
    return fallback
  }

  if (raw !== 'true' && raw !== 'false') {
    throw new ConfigurationError(`${key} debe ser "true" o "false". Se recibio "${raw}".`)
  }

  return raw === 'true'
}

const LOCAL_WEB_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'] as const

const readCorsOrigins = (env: RawEnv, nodeEnv: AppConfig['nodeEnv']): readonly string[] => {
  const raw = env.CORS_ORIGINS

  if (raw === undefined || raw === '') {
    return nodeEnv === 'production' ? [] : LOCAL_WEB_ORIGINS
  }

  const origins = raw
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0)

  if (nodeEnv === 'production' && origins.includes('*')) {
    throw new ConfigurationError(
      'CORS_ORIGINS no puede ser "*" con NODE_ENV=production. Declare origenes explicitos.',
    )
  }

  return origins
}

/**
 * Construye la configuracion a partir del entorno. Es una funcion pura sobre
 * `env`: no lee `process.env` directamente, de modo que puede verificarse por
 * completo sin contaminar el proceso de pruebas.
 *
 * Falla de inmediato ante una configuracion invalida. Un servicio mal
 * configurado no debe arrancar y aparentar salud.
 */
export const loadConfig = (env: RawEnv): AppConfig => {
  const nodeEnv = readEnum(
    env,
    'NODE_ENV',
    ['development', 'test', 'production'] as const,
    'development',
  )

  const persistenceDriver = readEnum(
    env,
    'PERSISTENCE_DRIVER',
    [PersistenceDriver.Memory, PersistenceDriver.Postgres],
    PersistenceDriver.Memory,
  )

  const authMode = readEnum(env, 'AUTH_MODE', [AuthMode.Disabled, AuthMode.Jwt], AuthMode.Disabled)

  // Un binario de produccion sin verificacion de identidad no arranca.
  //
  // Es la traduccion en codigo del BLOCKER de ADR-004: mientras ningun servicio
  // compruebe quien realiza la peticion, cualquiera puede actuar en nombre de
  // otra persona. Un aviso en el registro se pasa por alto; un arranque que
  // falla, no.
  if (nodeEnv === 'production' && authMode === AuthMode.Disabled) {
    throw new ConfigurationError(
      'AUTH_MODE no puede ser "disabled" con NODE_ENV=production. Sin verificacion de ' +
        'identidad el servicio no debe exponerse. Vease ADR-004.',
    )
  }

  const authenticationDriver = readEnum(
    env,
    'AUTHENTICATION_DRIVER',
    [AuthenticationDriver.Fake, AuthenticationDriver.Cognito],
    AuthenticationDriver.Fake,
  )

  // Un binario de produccion no puede autenticar contra un proveedor falso:
  // aceptaria CUALQUIER cuenta sembrada en memoria como si fuera real. Mismo
  // razonamiento que el BLOCKER de AUTH_MODE, aplicado a la verificacion de
  // contrasena en lugar de a la verificacion del testimonio.
  if (nodeEnv === 'production' && authenticationDriver === AuthenticationDriver.Fake) {
    throw new ConfigurationError(
      'AUTHENTICATION_DRIVER no puede ser "fake" con NODE_ENV=production. El login debe ' +
        'verificarse contra el proveedor real. Vease ADR-004.',
    )
  }

  const userPoolId = readString(env, 'COGNITO_USER_POOL_ID', '')
  const clientId = readString(env, 'COGNITO_CLIENT_ID', '')
  const needsCognito =
    authMode === AuthMode.Jwt || authenticationDriver === AuthenticationDriver.Cognito

  if (needsCognito && (userPoolId === '' || clientId === '')) {
    throw new ConfigurationError(
      'COGNITO_USER_POOL_ID y COGNITO_CLIENT_ID son obligatorios cuando AUTH_MODE es "jwt" o ' +
        'AUTHENTICATION_DRIVER es "cognito".',
    )
  }

  const databaseUrl = env.DATABASE_URL ?? null

  if (
    persistenceDriver === PersistenceDriver.Postgres &&
    (databaseUrl === null || databaseUrl === '')
  ) {
    throw new ConfigurationError(
      'DATABASE_URL es obligatorio cuando PERSISTENCE_DRIVER es "postgres".',
    )
  }

  return {
    nodeEnv,
    serviceName: readString(env, 'SERVICE_NAME', 'nexus-battle-account'),
    version: readString(env, 'SERVICE_VERSION', '0.1.0'),
    logLevel: readEnum(env, 'LOG_LEVEL', ['debug', 'info', 'warn', 'error'] as const, 'info'),
    port: readInteger(env, 'PORT', 3000, 1, 65_535),
    globalPrefix: readString(env, 'GLOBAL_PREFIX', 'api'),
    // La documentacion interactiva permanece deshabilitada en produccion salvo
    // decision explicita: expone la superficie completa de la API.
    swaggerEnabled: readBoolean(env, 'SWAGGER_ENABLED', nodeEnv !== 'production'),
    persistenceDriver,
    databaseUrl: databaseUrl === '' ? null : databaseUrl,
    authMode,
    authenticationDriver,
    cognito: needsCognito ? { userPoolId, clientId } : null,
    avatarStoragePath: readString(env, 'AVATAR_STORAGE_PATH', './data/avatars'),
    corsOrigins: readCorsOrigins(env, nodeEnv),
    notificationsIngestUrl: readString(env, 'NOTIFICATIONS_INGEST_URL', '') || null,
    internalServiceAuthSecret: readString(env, 'INTERNAL_SERVICE_AUTH_SECRET', '') || null,
    internalServiceAllowed: readAllowedServices(env),
  }
}
