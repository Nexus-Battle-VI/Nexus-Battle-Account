# Nexus-Battle-Account

Servicio de cuentas e identidad de Nexus Battles VI. Implementa el bounded context **Account/Identity**: registro de cuentas, verificación, ciclo de vida y control de acceso basado en roles.

Este repositorio contiene código y Pull Requests. No contiene Issues ni Product Backlog: la fuente única de verdad es [Nexus-Battle-Management](https://github.com/Nexus-Battle-VI/Nexus-Battle-Management).

- **Team propietario:** Team Alfa
- **Arquitectura interna:** Clean + Hexagonal, con puertos y adaptadores
- **Base de datos objetivo:** PostgreSQL (ver limitaciones más abajo)
- **Documentación técnica del sistema:** [Nexus-Battle-Infrastructure](https://github.com/Nexus-Battle-VI/Nexus-Battle-Infrastructure)

## Este servicio no almacena contraseñas

El agregado `Account` modela la cuenta y sus roles, no las credenciales. El registro y la verificación de credenciales pertenecen a un proveedor de identidad externo, detrás de `IdentityProviderPort`.

El proveedor está decidido: **Amazon Cognito, plan Essentials** (ADR-004, `Accepted` el 2026-08-25). El alta del sujeto sigue operando con `FakeIdentityProvider`, que implementa el contrato completo del puerto sobre almacenamiento en memoria y sin credenciales.

## Verificación de identidad en las peticiones

El servicio comprueba el testimonio que acompaña a cada petición contra el JWKS del user pool. Se verifica el **token de acceso**, no el de identidad: el de identidad describe al usuario para la interfaz, el de acceso es el que autoriza y el único cuyo `client_id` puede comprobarse.

La comprobación de firma la hace [`aws-jwt-verify`](https://github.com/awslabs/aws-jwt-verify). **No se implementa verificación criptográfica a mano**: es la clase de código donde un error sutil no falla, sino que acepta tokens falsificados en silencio.

| Ruta                                  | Protección                                              |
| ------------------------------------- | ------------------------------------------------------- |
| `POST /api/accounts`                  | Testimonio válido. La cuenta queda vinculada a su `sub` |
| `GET /api/accounts/me`                | Testimonio válido. Resuelve **la propia cuenta**        |
| `GET /api/accounts/:id`               | Rol **`ADMINISTRATOR`**                                 |
| `POST /api/accounts/:id/verification` | Rol **`ADMINISTRATOR`**                                 |
| `POST /api/sessions`                  | **Pública.** Pedirla ya exigiría la sesión que crea     |
| `POST /api/sessions/second-factor`    | **Pública.** Continúa el login administrativo (HU-02)   |
| `GET /api/health/*`                   | **Pública.** Un orquestador no lleva testimonio         |

### El registro exige testimonio, y no es arbitrario

Con un proveedor real, el alta de la identidad ocurre en **su propia pantalla de registro**. Cuando se llega a `POST /api/accounts`, la persona ya existe en el proveedor y lo que falta es su cuenta en el producto.

Por eso el caso de uso acepta un `subject` ya existente: darlo de alta otra vez produciría **dos identidades para la misma persona**. Y la compensación ante un fallo de persistencia alcanza **únicamente al sujeto que este caso de uso creó** — revocar uno ajeno dejaría sin identidad a alguien que la tenía antes de la petición.

**La protección es el comportamiento por defecto.** El guard se registra de forma global y hay que excluir explícitamente lo que deba ser público con `@Public()`. Al revés —proteger ruta por ruta— cualquier endpoint nuevo nacería desprotegido, y ese olvido no falla ninguna prueba.

### Un binario de producción sin autenticación no arranca

Con `NODE_ENV=production` y `AUTH_MODE=disabled`, `loadConfig` lanza `ConfigurationError` y el servicio **no llega a escuchar**. Es la traducción en código del blocker de ADR-004: un aviso en el registro se pasa por alto; un arranque que falla, no.

| Variable             | Efecto                                              |
| -------------------- | --------------------------------------------------- |
| `AUTH_MODE=disabled` | Ninguna ruta comprueba nada. **Estado del blocker** |
| `AUTH_MODE=jwt`      | Exige `COGNITO_USER_POOL_ID` y `COGNITO_CLIENT_ID`  |

Los roles llegan en el claim `cognito:groups`. **Los grupos que no corresponden a un rol conocido se descartan**: aceptarlos convertiría el pool en una fuente de roles arbitrarios, donde bastaría crear un grupo con cualquier nombre para inventar un permiso.

### El agregado guarda a quién pertenece

`Account` almacena el **sujeto** del proveedor de identidad, y es inmutable. El correo cambia y el nombre visible también; el sujeto es lo único estable a lo largo de la vida de la cuenta, y por eso el vínculo se hace contra él y **no contra el correo**.

Una cuenta sin sujeto **no puede existir**: `register` y `restore` la rechazan. Una cuenta que no se puede atribuir a nadie es peor que un error al crearla.

**El sujeto no se expone en la respuesta.** Es un vínculo interno; `AccountDto` se declara aparte de la instantánea del agregado precisamente para que un cambio interno no se filtre al contrato público.

Con eso, `GET /api/accounts/me` resuelve la propia cuenta sin que quien pregunta necesite conocer ningún identificador interno, y `GET /api/accounts/:id` —lectura de una cuenta arbitraria— queda restringida a administradores.

Ver `docs/adr/ADR-004-identity-directory.md` en Nexus-Battle-Infrastructure.

## Persistencia

PostgreSQL con **Kysely** ([ADR-012](https://github.com/Nexus-Battle-VI/Nexus-Battle-Infrastructure/blob/main/docs/adr/ADR-012-orm-odm.md)). Kysely es un constructor de consultas, no un ORM: **cada consulta esta escrita a la vista**, y no hay carga perezosa que dispare consultas dentro de un bucle sin que aparezcan en el codigo.

| Variable                      | Efecto                                                              |
| ----------------------------- | ------------------------------------------------------------------- |
| `PERSISTENCE_DRIVER=memory`   | Repositorio en proceso. **El estado se pierde al reiniciar**        |
| `PERSISTENCE_DRIVER=postgres` | `PostgresAccountRepository` + catalogos HU-01. Exige `DATABASE_URL` |

### Desarrollo local HU-01

La base local se llama `nexus_battle_account`. No se despliega AWS: el mismo puerto de persistencia apuntará más adelante al PostgreSQL de la EC2 de datos.

```bash
docker compose up -d
```

En `.env`:

```bash
NODE_ENV=development
PERSISTENCE_DRIVER=postgres
DATABASE_URL=postgresql://nexus:nexus@127.0.0.1:5433/nexus_battle_account
AUTH_MODE=disabled
AVATAR_STORAGE_PATH=./data/avatars
```

`AUTH_MODE=disabled` solo es válido fuera de producción: con `NODE_ENV=production` el servicio no arranca.

```bash
npm run migrate:dev
npm run dev
```

`POST /api/accounts` recibe `multipart/form-data` (el avatar es archivo, no Base64). El apodo viaja como `nickname` y se persiste en `display_name`. La contraseña no se guarda en PostgreSQL: entra por `IdentityProviderPort` (`FakeIdentityProvider` en local; Cognito sustituye el adaptador).

Tras `migrate:dev`, el registro rechaza apodos que contengan un término activo de la lista negra. La semilla y el volcado están en [docs/nickname-blacklist.md](docs/nickname-blacklist.md) y [docs/nickname-blacklist.txt](docs/nickname-blacklist.txt).

### El esquema no se migra al arrancar

```bash
npm run migrate
```

Es un paso explicito del despliegue, y el motivo es concreto: migrar desde el arranque hace que **varias replicas migren a la vez**, y que un despliegue con una migracion rota deje el servicio en **bucle de reinicio** en lugar de fallar una sola vez, de forma visible.

### La version de Kysely esta fijada en la linea 0.28 a proposito

**Kysely 0.29 es ESM puro**, y este servicio compila a CommonJS porque el CLI de NestJS 11 lo hace. TypeScript 5.9.3 **no permite importar un modulo ESM desde CommonJS** en ninguno de sus modos, ni siquiera `node20` — se comprobo uno por uno.

Node 24 si soporta `require()` de ESM, asi que la limitacion es del compilador, no del motor. Hasta que TypeScript lo admita, la linea `0.28` es la ultima que publica una compilacion CommonJS.

Se usa `0.28.17` y no una anterior porque las versiones previas arrastran **tres avisos de seguridad** de inyeccion SQL, el ultimo corregido justo en `0.28.17`.

### Las restricciones viven en el motor

El esquema valida el vocabulario de estados y de roles con restricciones `CHECK`: **un rol inventado no llega a escribirse**, aunque el codigo se equivoque.

Una migracion no puede importar el dominio —queda congelada en el tiempo y debe seguir siendo ejecutable tal y como se escribio—, asi que ese vocabulario se repite en SQL. Hay **una prueba que compara ambos** y falla si alguien anade un estado o un rol al dominio sin escribir la migracion correspondiente.

### Pruebas contra el motor real

```bash
npm run test:db
```

Levantan PostgreSQL en un contenedor con Testcontainers. **Necesitan Docker**, y por eso estan fuera de `npm test`: quien trabaja en el dominio o en los casos de uso no deberia necesitarlo. El CI ejecuta ambas suites.

Lo que comprueban no se puede comprobar de otra forma: que el SQL sea valido, que las restricciones existan de verdad y que la transaccion de guardado haga lo que dice. Un doble de prueba habria pasado con un esquema equivocado.

## Requisitos

| Herramienta | Versión                                       |
| ----------- | --------------------------------------------- |
| Node.js     | 24 LTS (`.nvmrc` fija el major 24)            |
| npm         | 11 o superior                                 |
| Docker      | opcional, para construir y ejecutar la imagen |

Este repositorio usa **npm** y `package-lock.json`. No se utilizan pnpm ni yarn.

## Puesta en marcha

```bash
nvm use
npm ci
cp .env.example .env
npm run dev
```

Con la configuración por defecto el servicio arranca con el repositorio en memoria y el proveedor de identidad simulado: no requiere base de datos ni servicios externos. Para HU-01 en local, usa PostgreSQL según la sección de persistencia.

Documentación interactiva de la API en `http://localhost:3000/api/docs`.

## Scripts

| Script                     | Descripción                                          |
| -------------------------- | ---------------------------------------------------- |
| `npm run dev`              | Ejecuta el servicio con recarga automática           |
| `npm run build`            | Compila con el Nest CLI a `dist/`                    |
| `npm start`                | Ejecuta el servicio compilado                        |
| `npm run start:prod`       | Ejecuta el servicio compilado en modo producción     |
| `npm run typecheck`        | Verificación de tipos sin emitir                     |
| `npm run lint`             | ESLint con reglas basadas en información de tipos    |
| `npm run lint:fix`         | Corrige automáticamente lo que ESLint puede corregir |
| `npm run format`           | Aplica Prettier                                      |
| `npm run format:check`     | Verifica el formato sin modificar archivos           |
| `npm test`                 | Ejecuta todas las pruebas                            |
| `npm run test:unit`        | Solo pruebas unitarias                               |
| `npm run test:integration` | Solo pruebas de integración HTTP                     |
| `npm run test:coverage`    | Pruebas con cobertura y umbral del 80 %              |

## API

| Método | Ruta                             | Descripción                                                    |
| ------ | -------------------------------- | -------------------------------------------------------------- |
| `POST` | `/api/accounts`                  | Registra una cuenta de jugador (`multipart/form-data`, HU-01)  |
| `GET`  | `/api/accounts/me`               | Recupera la cuenta del testimonio                              |
| `GET`  | `/api/accounts/:id`              | Recupera una cuenta                                            |
| `POST` | `/api/accounts/:id/verification` | Marca la cuenta como verificada                                |
| `POST` | `/api/sessions`                  | Inicia sesion con correo/apodo + contrasena (HU-02)            |
| `POST` | `/api/sessions/second-factor`    | Completa el segundo factor administrativo (HU-02)              |
| `GET`  | `/api/health/live`               | El proceso responde. No consulta dependencias                  |
| `GET`  | `/api/health/ready`              | Evalúa las dependencias reales. Responde `503` si alguna falla |
| `GET`  | `/api/version`                   | Servicio, versión y entorno                                    |

## Inicio de sesion y RBAC (HU-02)

`POST /api/sessions` recibe `identifier` (correo o apodo) y `password`. El
servicio resuelve el identificador internamente -Web nunca traduce un apodo a
un correo- y delega la verificacion de la contrasena en
`AuthenticationProviderPort`, un puerto separado de `IdentityProviderPort`
(vease la justificacion en el propio archivo de puertos). El contrato NO
acepta un campo `role`: el rol siempre se lee de la cuenta ya persistida.

Roles reconocidos: `PLAYER`, `MODERATOR`, `ADMINISTRATOR` y
`SUPER_ADMINISTRATOR`. Esta rama solo LEE el rol vigente; asignarlo es HU-39,
todavia no implementada. No existe una API publica que cree un
`SUPER_ADMINISTRATOR`: es una cuenta raiz unica, fuera del alcance de HU-01 y
HU-04.

Para `ADMINISTRATOR`/`SUPER_ADMINISTRATOR`, una contrasena correcta nunca
basta: `POST /api/sessions` responde `SECOND_FACTOR_REQUIRED` en lugar de
completar la sesion, y `POST /api/sessions/second-factor` es quien la
completa. El caso de uso falla cerrado -responde `503`- si una cuenta
administrativa se autentica sin que el proveedor emita ningun reto: eso
significa que el segundo factor no se esta aplicando para esa cuenta, no que
el login tuvo exito.

**Estado real de la integracion:** `AUTHENTICATION_DRIVER` elige el
adaptador, igual que `PERSISTENCE_DRIVER` elige el repositorio.

| Valor                | Adaptador                       | Uso                                                         |
| -------------------- | ------------------------------- | ----------------------------------------------------------- |
| `fake` (por defecto) | `FakeAuthenticationProvider`    | Test y desarrollo local sin red. No verifica nada real      |
| `cognito`            | `CognitoAuthenticationProvider` | `InitiateAuth`/`RespondToAuthChallenge` contra el pool real |

Con `NODE_ENV=production`, `AUTHENTICATION_DRIVER=fake` **impide arrancar**
el servicio, igual que `AUTH_MODE=disabled`: un binario de produccion no
puede aceptar cualquier cuenta sembrada en memoria como si fuera real.

El mecanismo de segundo factor aprobado por el cliente es correo electronico,
pero el user pool de Cognito ya aprovisionado tiene TOTP, no correo, porque el
correo exige SES y esa decision sigue pendiente (vease ADR-004 en
Nexus-Battle-Infrastructure). El puerto no asume ninguno de los dos:
transporta el reto tal como el proveedor lo emita.

**Por que `Admin*` y no el flujo publico.** El cliente de app de Cognito
(ADR-004) es el mismo cliente PUBLICO que usa Web por _authorization code
grant_ + PKCE. Si `CognitoAuthenticationProvider` usara el `InitiateAuth`
publico, habilitar `ALLOW_USER_PASSWORD_AUTH` en ese cliente dejaria a
CUALQUIER cliente que conozca el Client ID -no es secreto, viaja en la URL de
login- autenticar directo contra Cognito, saltandose `LoginAccount` y con el
la regla de que `ADMINISTRATOR`/`SUPER_ADMINISTRATOR` no obtienen acceso solo
con contrasena. Por eso usa `AdminInitiateAuth`/`AdminRespondToAuthChallenge`
(`AuthFlow: ADMIN_USER_PASSWORD_AUTH`): exige un flag de `ExplicitAuthFlows`
DISTINTO (`ALLOW_ADMIN_USER_PASSWORD_AUTH`) y credenciales de AWS firmadas
(IAM) que un navegador no tiene, forzando el camino Web -> Account -> Cognito.

**Blocker de Infrastructure sin confirmar:** las operaciones `Admin*` exigen
un permiso IAM (`cognito-idp:AdminInitiateAuth` /
`cognito-idp:AdminRespondToAuthChallenge`, acotado al ARN del user pool) sobre
el rol de ejecucion del runtime de Account, y que el cliente de Terraform
tenga `ALLOW_ADMIN_USER_PASSWORD_AUTH` en `ExplicitAuthFlows`. Ninguno de los
dos esta confirmado en ADR-004. Si falta cualquiera, el login real falla con
`AuthenticationProviderError` (503), no con credenciales invalidas.
Resolverlo es una decision de Infrastructure; el adaptador no usa claves de
AWS de larga duracion en ningun caso -se apoya en la cadena de credenciales
por defecto del SDK.

**Registro y Cognito ya son consistentes.** `RegisterAccount` usa el `subject`
del testimonio verificado cuando llega uno (`AUTH_MODE=jwt` con una identidad
real); `IdentityProviderPort.register` (`FakeIdentityProvider`) solo actua
como respaldo cuando la autenticacion esta desactivada. No hay dos procesos de
alta de identidad en conflicto entre HU-01 y HU-02.

## Estructura

```text
src/
  domain/            Entidades, objetos de valor, eventos y politicas. Sin dependencias externas.
  application/       Casos de uso, puertos, DTO y errores. Depende solo del dominio.
  adapters/
    inbound/http/    Controladores y contratos HTTP.
    outbound/        Persistencia, identidad, mensajeria y utilidades de sistema.
  infrastructure/    Configuracion, observabilidad, salud y raiz de composicion.
  main.ts            Punto de entrada del proceso.
test/
  unit/              Pruebas unitarias por capa.
  integration/       API real levantada con el modulo completo.
```

El dominio no importa NestJS, SDK de AWS, ORM, HTTP ni drivers de base de datos, y la capa de aplicación no conoce adaptadores concretos. La restricción se verifica en CI mediante reglas de ESLint sobre `src/domain` y `src/application`.

Los casos de uso son clases planas sin decoradores: se registran mediante fábricas explícitas en `infrastructure/bootstrap/app.module.ts`, de modo que podrían ejecutarse fuera de NestJS sin cambios.

## Versión de TypeScript

Este servicio usa **TypeScript 5.9.3**, no TypeScript 7. El motivo es concreto y verificable: `@nestjs/cli@11.0.24` declara `typescript: "5.9.3"` como dependencia directa. Subir la versión mayor requiere que el Nest CLI la soporte oficialmente, y esa evidencia debe registrarse en un ADR antes del cambio. No se introduce un sustituto silencioso del Nest CLI para forzarlo.

El worker de Notifications sí usa TypeScript 7, porque no depende del Nest CLI.

## Docker

```bash
docker build -t nexus-battle-account:local .
docker run --rm -p 3000:3000 nexus-battle-account:local
```

La imagen es multi-etapa, se ejecuta con el usuario sin privilegios `node`, incluye solo dependencias de producción y no contiene secretos.

## Limitaciones conocidas del alcance actual

- **La persistencia por defecto es en memoria y se pierde al reiniciar.** Con `PERSISTENCE_DRIVER=postgres` opera el adaptador real sobre PostgreSQL con Kysely, probado contra un motor en contenedor. El repositorio en memoria no es un resto del andamiaje: es lo que permite probar el dominio y los casos de uso **sin Docker**.
- **El alta de identidad sigue simulada.** `FakeIdentityProvider` implementa `IdentityProviderPort` (email + contraseña, sin persistir la contraseña). Cognito sustituye ese adaptador sin tocar el dominio. Ver ADR-004.
- **La autenticación (HU-02) tiene adaptador Cognito real (`CognitoAuthenticationProvider`), pero `AUTHENTICATION_DRIVER=fake` sigue siendo el valor por defecto** fuera de producción, donde `fake` está prohibido. Requiere que el registro haya creado el sujeto con un usuario real del pool (`AUTH_MODE=jwt` con un testimonio verdadero), no con `FakeIdentityProvider`.
- **Sin confirmar: permiso IAM y `ExplicitAuthFlows` para el flujo `Admin*`.** `CognitoAuthenticationProvider` usa `AdminInitiateAuth`/`AdminRespondToAuthChallenge` (no el flujo público, para no exponer `USER_PASSWORD_AUTH` en el cliente público de Web). Necesita `cognito-idp:AdminInitiateAuth`/`AdminRespondToAuthChallenge` en el rol IAM del runtime y `ALLOW_ADMIN_USER_PASSWORD_AUTH` en el cliente de Terraform; ninguno de los dos está confirmado en ADR-004. Si falta cualquiera, el login real falla con `AuthenticationProviderError`, no con credenciales inválidas.
- **El mecanismo de segundo factor aprobado (correo) no coincide con lo aprovisionado (TOTP).** El pool de Cognito exige SES para MFA por correo, todavía no decidido. Ver ADR-004 en Nexus-Battle-Infrastructure.
- **El avatar se guarda en disco local.** `LocalAvatarStorage` escribe bajo `AVATAR_STORAGE_PATH`. Un adaptador AWS sustituye ese puerto sin tocar `RegisterAccount`.
- **Las solicitudes de notificación no se publican en una cola.** Se registran con la forma exacta del mensaje que consumirá Notifications; la publicación real depende de ADR-006.
- La asignación y modificación de roles (`HU-39`) no forma parte de este alcance: HU-02 solo lee el rol vigente de la cuenta.

## Contribución

Se aplican las convenciones descritas en [CONTRIBUTING.md](CONTRIBUTING.md) y la [política de trazabilidad entre repositorios](https://github.com/Nexus-Battle-VI/Nexus-Battle-Management/blob/main/docs/governance/cross-repository-traceability.md) de Management.

## Licencia

`Licensing pending project governance`. Este repositorio todavía no tiene una licencia asignada; su definición requiere autorización del gobierno del proyecto.
