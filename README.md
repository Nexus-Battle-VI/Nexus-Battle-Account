# Nexus-Battle-Account

Servicio de cuentas e identidad de Nexus Battles VI. Implementa el bounded context **Account/Identity**: registro de cuentas, verificación, ciclo de vida y control de acceso basado en roles.

Este repositorio contiene código y Pull Requests. No contiene Issues ni Product Backlog: la fuente única de verdad es [Nexus-Battle-Management](https://github.com/Nexus-Battle-VI/Nexus-Battle-Management).

- **Team propietario:** Team Alfa
- **Arquitectura interna:** Clean + Hexagonal, con puertos y adaptadores
- **Base de datos objetivo:** PostgreSQL (ver limitaciones más abajo)
- **Documentación técnica del sistema:** [Nexus-Battle-Infrastructure](https://github.com/Nexus-Battle-VI/Nexus-Battle-Infrastructure)

## Este servicio no almacena contraseñas

El agregado `Account` modela la cuenta y sus roles, no las credenciales.

**Este servicio tampoco crea identidades.** El alta ocurre en la pantalla del proveedor —**Amazon Cognito**, `us-east-1_HrEiSzzKW`, aprovisionado y en uso—, de modo que cuando se llega a `POST /api/accounts` la persona ya existe y lo que falta es su cuenta en el producto. Sin un sujeto verificado, el registro responde 401 en lugar de inventar uno.

El puerto que modelaba ese alta, `IdentityProviderPort`, **se eliminó** el 2026-08-29 al quedarse sin consumidores. La frontera con el proveedor son hoy tres contratos estrechos:

| Puerto                       | Responsabilidad                                          |
| ---------------------------- | -------------------------------------------------------- |
| `TokenVerifierPort`          | Verificar un testimonio ya emitido                       |
| `AuthenticationProviderPort` | Comprobar contraseña y segundo factor (HU-02)            |
| `RoleDirectoryPort`          | Reflejar en el proveedor el rol que este servicio decide |

## Verificación de identidad en las peticiones

El servicio comprueba el testimonio que acompaña a cada petición contra el JWKS del user pool. Se verifica el **token de acceso**, no el de identidad: el de identidad describe al usuario para la interfaz, el de acceso es el que autoriza y el único cuyo `client_id` puede comprobarse.

La comprobación de firma la hace [`aws-jwt-verify`](https://github.com/awslabs/aws-jwt-verify). **No se implementa verificación criptográfica a mano**: es la clase de código donde un error sutil no falla, sino que acepta tokens falsificados en silencio.

| Ruta                                  | Protección                                                      |
| ------------------------------------- | --------------------------------------------------------------- |
| `POST /api/accounts`                  | Testimonio válido. La cuenta queda vinculada a su `sub`         |
| `GET /api/accounts/me`                | Testimonio válido. Resuelve **la propia cuenta**                |
| `PATCH /api/accounts/me`              | Testimonio válido. Edita **la propia cuenta** (apodo, HU-05)    |
| `POST /api/accounts/me/password`      | Testimonio válido. Cambia la contraseña en el proveedor (HU-05) |
| `GET /api/accounts/:id`               | Rol **`ADMINISTRATOR`**                                         |
| `POST /api/accounts/:id/verification` | Rol **`ADMINISTRATOR`**                                         |
| `POST /api/sessions`                  | **Pública.** Pedirla ya exigiría la sesión que crea             |
| `POST /api/sessions/second-factor`    | **Pública.** Continúa el login administrativo (HU-02)           |
| `GET /api/health/*`                   | **Pública.** Un orquestador no lleva testimonio                 |

### El registro exige testimonio, y no es arbitrario

Con un proveedor real, el alta de la identidad ocurre en **su propia pantalla de registro**. Cuando se llega a `POST /api/accounts`, la persona ya existe en el proveedor y lo que falta es su cuenta en el producto.

Por eso el caso de uso **exige** un `subject` ya verificado, y lo toma del testimonio, nunca del cuerpo de la petición: el cliente no puede reclamar un sujeto. Darlo de alta aquí produciría **dos identidades para la misma persona**.

Como ya no crea ninguna, tampoco hay identidad que compensar: ante un fallo de persistencia solo se retira el avatar guardado en esta petición.

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

`POST /api/accounts` recibe `multipart/form-data` (el avatar es archivo, no Base64). El apodo viaja como `nickname` y se persiste en `display_name`. **La contraseña no se guarda en PostgreSQL y este servicio tampoco la envía a ningún sitio al registrar**: la credencial ya está en el proveedor, donde la persona la creó.

El avatar se escribe en `AVATAR_STORAGE_PATH`. La imagen lo define en `/var/lib/nexus/avatars` y crea ese directorio con el dueño correcto: el proceso corre sin privilegios y `/app` pertenece a root, así que el valor por defecto de la configuración —relativo a `/app`— **no se podía crear**, y todo registro respondía 500. Hay una comprobación en CI que lo verifica contra la imagen construida.

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

Con la configuración por defecto el servicio arranca con el repositorio en memoria, el proveedor de autenticación simulado y el directorio de roles en memoria: no requiere base de datos ni servicios externos. Para HU-01 en local, usa PostgreSQL según la sección de persistencia.

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

| Método  | Ruta                             | Descripción                                                          |
| ------- | -------------------------------- | -------------------------------------------------------------------- |
| `POST`  | `/api/accounts`                  | Registra una cuenta de jugador (`multipart/form-data`, HU-01)        |
| `GET`   | `/api/accounts/me`               | Recupera la cuenta del testimonio                                    |
| `PATCH` | `/api/accounts/me`               | Actualiza la información personal de la cuenta propia (apodo, HU-05) |
| `POST`  | `/api/accounts/me/password`      | Cambia la contraseña de la cuenta propia (HU-05)                     |
| `GET`   | `/api/accounts/:id`              | Recupera una cuenta                                                  |
| `POST`  | `/api/accounts/:id/verification` | Marca la cuenta como verificada                                      |
| `POST`  | `/api/sessions`                  | Inicia sesion con correo/apodo + contrasena (HU-02)                  |
| `POST`  | `/api/sessions/second-factor`    | Completa el segundo factor administrativo (HU-02)                    |
| `GET`   | `/api/health/live`               | El proceso responde. No consulta dependencias                        |
| `GET`   | `/api/health/ready`              | Evalúa las dependencias reales. Responde `503` si alguna falla       |
| `GET`   | `/api/version`                   | Servicio, versión y entorno                                          |

## Inicio de sesion y RBAC (HU-02)

`POST /api/sessions` recibe `identifier` (correo o apodo) y `password`. El
servicio resuelve el identificador internamente -Web nunca traduce un apodo a
un correo- y delega la verificacion de la contrasena en
`AuthenticationProviderPort`, deliberadamente separado de la verificacion de
testimonios y del reflejo del rol (vease la justificacion en el propio archivo
de puertos). El contrato NO
acepta un campo `role`: el rol siempre se lee de la cuenta ya persistida.

Roles reconocidos: `PLAYER`, `MODERATOR`, `ADMINISTRATOR` y
`SUPER_ADMINISTRATOR`. El login solo LEE el rol vigente; asignarlo y retirarlo
es HU-39, ya implementada (`POST /api/accounts/:id/roles` y
`DELETE /api/accounts/:id/roles/:role`, solo `SUPER_ADMINISTRATOR`). No existe
una API publica que cree un `SUPER_ADMINISTRATOR`: es una cuenta raiz unica,
fuera del alcance de HU-01 y HU-04.

Para `ADMINISTRATOR`/`SUPER_ADMINISTRATOR`, una contrasena correcta nunca
basta: `POST /api/sessions` responde `SECOND_FACTOR_REQUIRED` en lugar de
completar la sesion, y `POST /api/sessions/second-factor` es quien la
completa. El caso de uso falla cerrado -responde `503`- si una cuenta
administrativa se autentica sin que el proveedor emita ningun reto: eso
significa que el segundo factor no se esta aplicando para esa cuenta, no que
el login tuvo exito.

**Estado real de la integracion:** `AUTHENTICATION_DRIVER` elige el
adaptador, igual que `PERSISTENCE_DRIVER` elige el repositorio.

| Valor                | Adaptador                       | Uso                                                                                                                                                     |
| -------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fake` (por defecto) | `FakeAuthenticationProvider`    | Test y desarrollo local sin red. No verifica nada real                                                                                                  |
| `cognito`            | `CognitoAuthenticationProvider` | `AdminInitiateAuth`/`AdminRespondToAuthChallenge` contra el pool real. La variante **Admin** exige credenciales de AWS firmadas, no solo el `client_id` |

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

**Registro y Cognito son consistentes porque solo hay un alta de identidad, y no
la hace este servicio.** `RegisterAccount` toma el `subject` del testimonio
verificado y falla sin el. No existe respaldo ni segundo camino: no hay dos
procesos de alta que puedan entrar en conflicto entre HU-01 y HU-02.

**El rol se refleja en el proveedor.** La fuente de verdad sigue siendo
`account_roles`, en PostgreSQL, pero `RoleDirectoryPort` lo refleja en los grupos
del pool para que viaje en `cognito:groups`, que es lo que leen los otros cuatro
servicios. El reflejo ocurre **antes** de persistir: al reves, un fallo dejaria
una cuenta cuyo rol no viaja en el testimonio, e irreparable por reintento porque
el segundo intento chocaria con el correo ya registrado. Si el proveedor no
responde, el registro falla cerrado con **503** y la cuenta no se crea.

## Mi Cuenta (HU-05)

Las operaciones sobre la cuenta propia son **self-service**: la cuenta se resuelve
siempre desde el sujeto del testimonio (`@CurrentIdentity()`), nunca desde un
identificador del cuerpo. No existe `PATCH /api/accounts/:id`.

- **`GET /api/accounts/me`** — consulta. Devuelve el contrato público
  (`id`, `email`, `displayName`, `firstNames`, `lastNames`, `status`, `roles`).
  El `subject` es un vínculo interno con el proveedor y **no** sale del servicio.
- **`PATCH /api/accounts/me`** — actualización de información personal. Hoy admite
  **únicamente `displayName`** (apodo), reutilizando las reglas ya aprobadas en el
  registro: formato de `DisplayName`, unicidad insensible a mayúsculas y lista
  negra vigente. El `ValidationPipe` global (`forbidNonWhitelisted`) rechaza con
  400 cualquier campo no declarado, de modo que no se puede tocar `status`,
  `roles`, `subject` ni ninguna propiedad interna. Editar el apodo al **mismo**
  valor es idempotente y no se trata como colisión consigo mismo.
- **`POST /api/accounts/me/password`** — cambio de contraseña. La contraseña
  **no** pertenece al agregado `Account` ni a PostgreSQL: la operación actúa
  sobre el testimonio de acceso de quien llama (`ChangePassword` de Cognito,
  igual que la inscripción TOTP), sin credenciales de AWS ni permiso IAM. La
  política de complejidad la aplica el proveedor, como en el alta. La contraseña
  no se persiste, no se registra y no se devuelve; la respuesta es `204`.

### Pendiente de definición funcional

- **Campos editables adicionales** (`firstNames`, `lastNames`, `email`, `avatar`):
  HU-05 no enumera en este repositorio una lista definitiva. `email` además
  devolvería la cuenta a `PENDING_VERIFICATION`. No se implementan hasta que la
  fuente funcional los apruebe.
- **Preferencias** (idioma, apariencia): no hay en el repositorio un vocabulario
  aprobado de valores. No se implementa hasta disponer de esa lista; `PATCH
/api/accounts/me` está preparado para extenderse sin reescribirse.
- **Suscripciones**: sin operaciones funcionales aprobadas. Bloqueado.
- **Métodos de pago**: sin ownership definido para `Account` ni operaciones
  simuladas aprobadas. Fuera del alcance implementable.

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
- ~~**El alta de identidad sigue simulada.**~~ **Superado.** Este servicio ya no da de alta identidades y el puerto que lo modelaba se eliminó; el alta ocurre en la pantalla del proveedor.
- **`AUTHENTICATION_DRIVER=fake` sigue siendo el valor por defecto** fuera de producción, donde `fake` está prohibido y el servicio ni siquiera arranca con él. El despliegue corre con `cognito`.
- ~~**Sin confirmar: permiso IAM y `ExplicitAuthFlows` para el flujo `Admin*`.**~~ **Confirmados ambos.** El cliente declara `ALLOW_ADMIN_USER_PASSWORD_AUTH`, y el rol de instancia tiene `AdminInitiateAuth`/`AdminRespondToAuthChallenge` más las tres acciones del reflejo del rol, acotadas a este pool. Verificado con `iam simulate-principal-policy`, incluidos controles negativos: `AdminCreateUser` y `AdminDeleteUser` responden `implicitDeny`, a propósito.
- **La decisión general sobre segundo factor sigue siendo parcial.** Para la creación administrativa de productos se aprobó TOTP mediante aplicación autenticadora; para las demás operaciones, el lineamiento de correo todavía no coincide con el pool aprovisionado con TOTP y exigiría SES. Ver ADR-004 en Nexus-Battle-Infrastructure.
- **El avatar se guarda en disco local.** `LocalAvatarStorage` escribe bajo `AVATAR_STORAGE_PATH`, que la imagen define en `/var/lib/nexus/avatars`. En el despliegue hay un volumen montado ahí; sin él los avatares vivirían en la capa de escritura del contenedor y desaparecerían en cada despliegue. Si la instancia se reemplaza, se pierden: sacarlos de la máquina exigiría S3, que el alcance actual no autoriza. Un adaptador AWS sustituye ese puerto sin tocar `RegisterAccount`.
- **Las solicitudes de notificación no se publican en una cola.** Se registran con la forma exacta del mensaje que consumirá Notifications; la publicación real depende de ADR-006.

## Contribución

Se aplican las convenciones descritas en [CONTRIBUTING.md](CONTRIBUTING.md) y la [política de trazabilidad entre repositorios](https://github.com/Nexus-Battle-VI/Nexus-Battle-Management/blob/main/docs/governance/cross-repository-traceability.md) de Management.

## Licencia

`Licensing pending project governance`. Este repositorio todavía no tiene una licencia asignada; su definición requiere autorización del gobierno del proyecto.
