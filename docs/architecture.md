# Arquitectura de Nexus-Battle-Account

Documento técnico del servicio. La arquitectura del sistema completo, los ADR y los diagramas viven en [Nexus-Battle-Infrastructure](https://github.com/Nexus-Battle-VI/Nexus-Battle-Infrastructure).

## Bounded context

**Account/Identity** es responsable de la existencia de una cuenta de jugador, su ciclo de vida y sus roles. Su lenguaje ubicuo se limita a cuenta, correo, nombre visible, estado, verificación y rol.

No es responsable de autenticar. Autenticar es demostrar que quien solicita es el titular, y esa prueba pertenece al proveedor de identidad. Account decide **si una cuenta puede autenticarse**, que es una regla de negocio distinta y sí le corresponde.

### Datos que posee

Account es propietario exclusivo de las cuentas: identificador, sujeto, correo, apodo (`display_name`), nombres, apellidos, consentimiento de términos, metadatos de avatar, estado y roles. Las respuestas de seguridad viven como hash en el mismo almacén. Ningún otro servicio accede a este almacén, ni directamente ni mediante claves foráneas.

Account **no posee credenciales**. No almacena contraseñas, hashes, sales, tokens de sesión ni secretos de segundo factor.

## Capas

```text
+-------------------------------------------------------------+
|  adapters/inbound/http   AccountsController, MfaController,   |
|                          PasswordController, SessionsController,|
|                          HealthController                    |
+-------------------------------------------------------------+
|  application             RegisterAccount, GetAccount,        |
|                          GetOwnAccount, UpdateOwnAccount,     |
|                          ChangeOwnPassword, VerifyAccount,    |
|                          LoginAccount, CompleteSecondFactor,  |
|                          ports/                               |
+-------------------------------------------------------------+
|  domain                  Account, Role, RolePolicy,          |
|                          EmailAddress, DisplayName, eventos  |
+-------------------------------------------------------------+
|  adapters/outbound       InMemoryAccountRepository,          |
|                          FakeAuthenticationProvider,           |
|                          CognitoAuthenticationProvider,        |
|                          CognitoTokenVerifier,                 |
|                          InMemoryRoleDirectory,                |
|                          CognitoRoleDirectory,                 |
|                          InMemoryPasswordChange,               |
|                          CognitoPasswordChange,                |
|                          LoggingNotificationRequester,        |
|                          LocalAvatarStorage,                   |
|                          SystemClock, UuidGenerator          |
+-------------------------------------------------------------+
|  infrastructure          config, observability, health,      |
|                          bootstrap (raiz de composicion)     |
+-------------------------------------------------------------+
```

Las dependencias apuntan siempre hacia el dominio. El dominio no conoce ninguna capa exterior, y la capa de aplicación no conoce NestJS.

## Puertos

| Puerto                        | Responsabilidad                                                                                          | Implementación actual                                                                               |
| ----------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `AccountRepositoryPort`       | Persistir y recuperar el agregado, incluida la busqueda por apodo (HU-02)                                | `InMemoryAccountRepository` / `PostgresAccountRepository`                                           |
| `AuthenticationProviderPort`  | Verificacion de contrasena y segundo factor (HU-02)                                                      | `FakeAuthenticationProvider` / `CognitoAuthenticationProvider`, elegido por `AUTHENTICATION_DRIVER` |
| `PasswordChangePort`          | Cambio de contrasena self-service (HU-05) sobre el testimonio del usuario; la credencial no toca Account | `InMemoryPasswordChange` / `CognitoPasswordChange`, segun haya proveedor configurado                |
| `RoleDirectoryPort`           | Refleja en el proveedor el rol que este servicio decide. Direccion unica: Account decide, el pool recoge | `InMemoryRoleDirectory` / `CognitoRoleDirectory`, segun haya proveedor configurado                  |
| `TotpEnrollmentPort`          | Inscripcion TOTP self-service (HU-02) sobre el testimonio del usuario                                    | `InMemoryTotpEnrollment` / `CognitoTotpEnrollment`, segun haya proveedor configurado                |
| `AvatarStoragePort`           | Guardar y borrar bytes de avatar                                                                         | `LocalAvatarStorage` (AWS sustituye el adaptador)                                                   |
| `NicknameBlacklistPort`       | Consultar la lista negra vigente de apodos                                                               | `InMemoryNicknameBlacklist` / `PostgresNicknameBlacklist`                                           |
| `SecurityQuestionCatalogPort` | Catálogo activo de preguntas de seguridad                                                                | En memoria / `PostgresSecurityQuestionCatalog`                                                      |
| `NotificationRequestPort`     | Solicitar una notificación al contexto Notifications                                                     | `LoggingNotificationRequester`                                                                      |
| `ClockPort`                   | Proveer el instante actual                                                                               | `SystemClock`                                                                                       |
| `IdGeneratorPort`             | Generar identificadores                                                                                  | `UuidGenerator`                                                                                     |

`ClockPort` e `IdGeneratorPort` existen para que el dominio sea determinista: ninguna entidad lee el reloj ni se genera a sí misma un identificador aleatorio, de modo que las pruebas comparan valores exactos en lugar de aproximaciones.

## Patrones aplicados

| Patrón                              | Dónde                                                             | Por qué                                                                      |
| ----------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Ports and Adapters                  | Todas las dependencias externas                                   | Permite sustituir persistencia o proveedor de identidad sin tocar el dominio |
| Repository                          | `AccountRepositoryPort`                                           | Aísla el agregado del mecanismo de almacenamiento                            |
| Specification implícita en política | `RolePolicy`                                                      | Concentra las reglas de roles en un único lugar verificable                  |
| Domain Events                       | `account.registered`, `account.verified`, `account.email-changed` | Registra hechos del dominio de forma trazable y desacoplada del transporte   |
| Compensación explícita              | `RegisterAccount`                                                 | Evita identidades huérfanas sin recurrir a una transacción distribuida       |

No se aplica CQRS ni Event Sourcing: el contexto no tiene un modelo de lectura diferenciado ni requiere reconstruir estado histórico.

## Consistencia del registro

`RegisterAccount` coordina dos sistemas que no comparten transacción: el proveedor de identidad y el almacén de cuentas. El orden es deliberado.

```text
1. Validar nombres, apellidos, correo, contraseña, apodo, términos,
   respuestas y avatar                         -> falla temprano, sin efectos
2. Comprobar unicidad de correo y apodo        -> falla temprano, sin efectos
3. Consultar lista negra vigente               -> falla temprano, sin efectos
4. Crear la identidad en el proveedor (signUp) -> devuelve el sujeto y Cognito
   (ADR-004, "Alta server-side")                 envía el código al correo;
                                                 "correo ya existe" => 409
5. Almacenar avatar                            -> primer efecto propio
6. Crear el agregado                           -> siempre PENDING_VERIFICATION;
                                                 el correo se confirma después
7. Reflejar el rol en el proveedor             -> antes de persistir; si falla,
                                                 se compensa el avatar
8. Persistir cuenta, roles y hashes            -> transaccion PostgreSQL;
                                                 si falla, se borra el avatar
9. Solicitar el correo de bienvenida           -> no compensa: la cuenta ya es valida
```

El paso 9 no participa de la compensación de forma deliberada. Si la solicitud de notificación falla, la cuenta existe y es correcta; deshacer el registro por no haber podido enviar un correo de bienvenida sería peor que reintentar la notificación. El error se propaga para que quede registrado, pero no revierte nada.

La identidad se crea en el proveedor con `signUp` (ADR-004, «Alta server-side»), no con `AdminCreateUser`: así Cognito envía el código de confirmación al correo con su emisor por defecto y la verificación del buzón sigue siendo real. La cuenta nace `PENDING_VERIFICATION` y pasa a `ACTIVE` cuando quien registra confirma el código en `POST /api/accounts/confirmation` (`ConfirmRegistration` → `confirmSignUp`). La contraseña viaja a `signUp` y no se persiste en Account. La identidad que crea `signUp` **no** se compensa ante un fallo posterior —haría falta `AdminDeleteUser`—; la ventana se minimiza validando todo lo validable antes de llamarla.

## Estados de la cuenta

```text
                  register
                     |
                     v
        PENDING_VERIFICATION  <----- changeEmail -----+
                     |                                |
                  verify                              |
                     |                                |
                     v                                |
                  ACTIVE  --------------------------- +
                   |   ^
             suspend   reinstate
                   v   |
               SUSPENDED

  PENDING_VERIFICATION, ACTIVE y SUSPENDED --- erase (HU-43.3) ---> DELETED (terminal)
```

Una cuenta solo puede autenticarse en estado `ACTIVE`. Cambiar el correo devuelve la cuenta a `PENDING_VERIFICATION`, porque la nueva dirección todavía no ha demostrado pertenecer a la persona titular.

`DELETED` es terminal: `erase()` (HU-43.3) puede alcanzarse desde cualquier otro estado y ninguna transición admite salir de él -`verify`, `suspend`, `reinstate`, `rename`, `changeEmail`, `grantRole` y `revokeRole` rechazan actuar sobre una cuenta eliminada-. `erase()` no borra la fila: anonimiza correo, nombres, apodo y avatar con un valor determinista y único por cuenta (los value objects siguen exigiendo un valor con formato válido) y es idempotente, para que el reintento de HU-43.3 tras un reinicio no falle ni repita efectos. Ver "Eliminación de cuenta (HU-43)" más abajo.

## Inicio de sesión (HU-02)

`LoginAccount` y `CompleteSecondFactor` resuelven el identificador de login
(correo o apodo) reutilizando `EmailAddress`/`DisplayName` para detectar el
formato -sin inventar una segunda normalización de apodo-, y delegan la
verificación de contraseña en `AuthenticationProviderPort`. El resultado se
modela como una unión discriminada (`LoginOutcome`), no como excepciones: a
diferencia del resto de casos de uso de este servicio, fallar un login es una
situación rutinaria, no excepcional, y la unión hace visible en un único
`switch` que "correo inexistente", "contraseña incorrecta" y "cuenta no
activa" producen la misma rama externa.

```text
identifier + password
        |
        v
resolver cuenta (correo o apodo) -> inexistente o no ACTIVE => invalidCredentials
        |
        v
AuthenticationProviderPort.authenticate
        |
        +-- invalidCredentials -----------------------------> invalidCredentials
        +-- challengeRequired ------------------------------> secondFactorRequired
        +-- authenticated, rol PLAYER/MODERATOR -------------> authenticated
        +-- authenticated, rol ADMINISTRATOR/SUPER_ADMIN ----> providerUnavailable
                                                                (falla cerrado: ver mas abajo)
```

Para `ADMINISTRATOR`/`SUPER_ADMINISTRATOR`, una contraseña correcta nunca
basta (CA-06). Si el proveedor entrega un token sin haber retado el segundo
factor para una cuenta de ese nivel, el caso de uso NO lo trata como éxito: es
la señal de que el segundo factor no se está aplicando para esa cuenta, y
responde `providerUnavailable` en lugar de conceder la sesión. `CompleteSecondFactor`
recibe de nuevo el identificador -no un correo que Web tendría que resolver- y
el `challengeToken` opaco que emitió el proveedor.

El `accessToken` que devuelve una sesión completada es el testimonio firmado
por el proveedor de identidad (Cognito), no un JWT propio: se verifica después
con el mismo `TokenVerifierPort` que ya protege el resto de rutas. Ver
`AuthenticationProviderPort` para la justificación de por qué comprobar una
contraseña es un puerto distinto de verificar un testimonio ya emitido.

`AUTHENTICATION_DRIVER` elige el adaptador (`fake`/`cognito`), igual que
`PERSISTENCE_DRIVER` elige el repositorio; `NODE_ENV=production` prohíbe
`fake`. `CognitoAuthenticationProvider` usa `AdminInitiateAuth`/
`AdminRespondToAuthChallenge` con `AuthFlow: ADMIN_USER_PASSWORD_AUTH` -no las
variantes públicas, y no SRP, por el mismo motivo que `CognitoTokenVerifier`
no reimplementa la verificación de firma a mano.

El cliente de app de Cognito (ADR-004) es el mismo cliente PÚBLICO que usa Web
por _authorization code grant_ + PKCE. Usar el flujo público
(`InitiateAuth`/`USER_PASSWORD_AUTH`) habría exigido habilitarlo en ese mismo
cliente, y con el Client ID -que viaja en la URL de login, no es secreto-
cualquiera podría autenticar directo contra Cognito saltándose `LoginAccount`
y, con él, la regla de que `ADMINISTRATOR`/`SUPER_ADMINISTRATOR` no obtienen
sesión solo con contraseña. Las operaciones `Admin*` no tienen ese problema:
exigen un flag distinto (`ALLOW_ADMIN_USER_PASSWORD_AUTH`) y SigV4 real (a
diferencia de las públicas, que no llevan firma en el modelo del SDK), así que
solo el runtime de Account -con permiso IAM explícito- puede invocarlas.
Ningún caso usa credenciales de AWS de larga duración: el cliente se apoya en
la cadena de credenciales por defecto del SDK.

`authenticate()` también clasifica el `ChallengeName` antes de convertirlo en
`challengeRequired`: solo los retos que HU-02 sabe resolver con un único
código (`SOFTWARE_TOKEN_MFA`, `SMS_MFA`, `EMAIL_OTP`) llegan a Web como
segundo factor. Cualquier otro -`NEW_PASSWORD_REQUIRED`, `MFA_SETUP`,
`SELECT_MFA_TYPE`- falla cerrado como `AuthenticationProviderError`: fingir
que un formulario de código los resuelve inventaría un flujo no aprobado.

### Evidencia de segundo factor para operaciones internas

Cognito no incluye en el access token una afirmación que demuestre qué segundo
factor se completó. Por eso Account registra, al finalizar el reto, una
evidencia efímera formada por `subject`, `jti`, `method`, `verifiedAt` y
`expiresAt`. La evidencia vence exactamente con el token y nunca se consulta
solo por sujeto.

Los retos del proveedor se normalizan sin perder su significado:
`SOFTWARE_TOKEN_MFA` se registra como `AUTHENTICATOR_APP`, `SMS_MFA` como `SMS`
y `EMAIL_OTP` como `EMAIL`. El contrato interno firmado consulta las tres
piezas `subject`, `jti` y `method`; por tanto, una evidencia de SMS o correo no
autoriza una operación que exige aplicación autenticadora. La creación
administrativa de productos en Catalog exige `AUTHENTICATOR_APP` y falla
cerrado si Account, la firma interna o la evidencia no están disponibles.

Las evidencias creadas antes de persistir el método se invalidan durante la
migración. No es posible clasificarlas de manera segura y su naturaleza
efímera permite solicitar nuevamente el segundo factor.

Pendiente de confirmar con Infrastructure: el permiso IAM
(`cognito-idp:AdminInitiateAuth`/`AdminRespondToAuthChallenge`, acotado al
ARN del pool) sobre el rol de ejecución del runtime, que
`ALLOW_ADMIN_USER_PASSWORD_AUTH` esté en `ExplicitAuthFlows` del cliente de
Terraform. Para la creación administrativa de productos, el uso de TOTP por
aplicación autenticadora ya fue confirmado; otros métodos requieren una
decisión funcional explícita por cada operación consumidora.

## Roles

Toda cuenta nace con el rol `PLAYER`, que no puede retirarse: garantiza que ninguna cuenta quede sin permisos básicos por una operación de gestión. Los roles `MODERATOR`, `ADMINISTRATOR` y `SUPER_ADMINISTRATOR` (HU-02) se acumulan sobre él.

Los roles nunca se aceptan desde la petición de registro ni desde la de login. El contrato HTTP rechaza campos no declarados, de modo que un cliente no puede autoconcederse privilegios; el rol que decide la autorización se lee siempre de la cuenta ya persistida.

**HU-02 solo LEE el rol vigente; no lo asigna.** La asignación y retirada de roles es HU-39, y ya está implementada: `AssignRole` (`POST /api/accounts/:id/roles`) y `RevokeRole` (`DELETE /api/accounts/:id/roles/:role`), ambas restringidas a `SUPER_ADMINISTRATOR`. `SUPER_ADMINISTRATOR` es una cuenta raíz única: no se crea mediante HU-01, no se recupera mediante HU-04 y no existe una operación pública que la genere (tampoco `AssignRole`, que rechaza ese rol).

`RolePolicy.canManageRoles` concede la gestión de roles **solo a `SUPER_ADMINISTRATOR`**. `Account.grantRole`/`Account.revokeRole` aplican esa política y los invocan `AssignRole`/`RevokeRole`; conceder un rol administrativo exige además que la cuenta destino tenga TOTP confirmado, y retirarlo cierra sus sesiones en el proveedor.

## Contrato HTTP

La especificación OpenAPI se genera desde el código con `@nestjs/swagger` y se expone en `/api/docs` cuando la documentación está habilitada. En producción permanece deshabilitada salvo decisión explícita.

### Mi Cuenta (HU-05)

Las operaciones sobre la cuenta propia derivan la cuenta del sujeto del testimonio, nunca de un identificador del cuerpo. No existe `PATCH /api/accounts/:id`.

| Ruta                             | Uso                                                                                                                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/accounts/me`           | Consulta. Contrato público, sin `subject` ni credenciales.                                                                                                          |
| `PATCH /api/accounts/me`         | Actualiza información personal. Hoy solo `displayName`, con las reglas de unicidad y lista negra del registro. `forbidNonWhitelisted` rechaza cualquier otro campo. |
| `POST /api/accounts/me/password` | Cambio de contraseña vía `PasswordChangePort`. La contraseña actúa sobre el testimonio de acceso y no toca `Account` ni PostgreSQL. Responde `204`.                 |

Eventos de dominio emitidos:

| Evento                  | Cuándo                                                 |
| ----------------------- | ------------------------------------------------------ |
| `account.registered`    | Se registra una cuenta nueva                           |
| `account.verified`      | La cuenta demuestra control del correo y pasa a activa |
| `account.email-changed` | Cambia la dirección de correo de una cuenta            |

### Eliminación de cuenta (HU-43)

EN-011 (Management #197) y ADR-014 Decisión 5 (Nexus-Battle-Infrastructure) fijan el alcance: Account trata únicamente sus propios datos personales, sin coordinar Community, Commerce, Player-Inventory ni Catalog por la sola presencia de un `subject` opaco. La matriz de tratamiento (`docs/privacy/data-treatment-matrix-v0.3.md`) es la referencia de qué campo se elimina, anonimiza o retiene.

| Ruta                                | Uso                                                                                                                                                      |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DELETE /api/accounts/me`           | HU-43.2. Registra la solicitud durable de HU-43.1 y responde `202`: aceptada, no completada. Idempotente.                                                |
| `npm run process-account-deletions` | HU-43.3. Procesador por lotes, fuera de cualquier petición HTTP -mismo patrón que `npm run migrate`-. Ejecuta el tratamiento real y cierra la solicitud. |

El flujo tiene tres piezas deliberadamente separadas:

1. **HU-43.1** (`AccountDeletionRequest`, ya en `develop` antes de esta Task): el estado durable de la solicitud (`RECEIVED` → `IN_PROGRESS` → `CLOSED`, con `FAILED` como fallo transitorio reintentable). Un índice único parcial en PostgreSQL (`account_deletion_requests_una_activa_por_cuenta`, sobre filas `status <> 'CLOSED'`) impide una segunda solicitud activa para la misma cuenta, incluso bajo llamadas concurrentes.
2. **HU-43.2** (`RequestAccountDeletion`): resuelve al titular exclusivamente por `VerifiedIdentity.subject` -nunca por un id del cuerpo-, y devuelve la solicitud activa existente en lugar de crear una segunda cuando ya hay una en curso.
3. **HU-43.3** (`ProcessAccountDeletion`, `Account.erase()`): ejecuta el tratamiento y cierra la solicitud.

`Account.erase()` no borra la fila: anonimiza `email`, `displayName`, `firstNames`, `lastNames` y el avatar con un valor determinista y único por cuenta (los value objects siguen exigiendo formato válido) y pasa el estado a `DELETED` (terminal). No toca `termsAccepted` -la matriz lo deja "Pendiente decisión", no se inventa una regla- ni los roles -vaciarlos rompería el invariante de `Account.restore`, que exige al menos uno, y la matriz no exige vaciarlos para que la cuenta deje de poder autenticarse-. La contraseña no vive en Account (Cognito, fuera de alcance según la propia matriz).

`ProcessAccountDeletion` retira el avatar **antes** de anonimizar y guardar la cuenta: si se hiciera al revés y el borrado del avatar fallara después de guardar la cuenta ya anonimizada, un reintento leería `account.currentAvatar.storageKey` ya sobrescrito por el marcador de `erase()` -no el original- y el archivo real nunca llegaría a borrarse. El correo de la notificación de cierre se captura una sola vez, en la recepción de la solicitud (`AccountDeletionRequest.notifyEmail`), por la misma razón: `erase()` anonimiza `accounts.email` antes de que el tratamiento llegue a notificar, y el proceso debe poder reanudarse tras un reinicio sin depender de un valor que ya fue sobrescrito.

La notificación de cierre usa el `notificationId` estable `${request.id}-cierre`: si el pipeline de Notifications ya la aceptó en un intento anterior que falló después (antes de cerrar la solicitud), el reintento no produce un segundo envío -la deduplicación por `notificationId` la aplica el pipeline de Notifications, no Account-. El identificador de plantilla (`ACCOUNT_DELETION_CLOSED_TEMPLATE_ID = 'account-deletion-closed'`) es el contrato del lado de Account con **HU-43.4** (Nexus-Battle-Notifications), que todavía no está implementada: hasta entonces, la notificación se registra o se intenta según `NOTIFICATIONS_INGEST_URL`, sin bloquear el cierre de la solicitud.

## Observabilidad

El registro es JSON estructurado por línea. Se emite exclusivamente desde `infrastructure/observability/logger.ts`; el resto del código tiene prohibido escribir en la consola mediante la regla `no-console` de ESLint.

El correo electrónico es un dato personal: la observabilidad registra el **dominio** de la dirección, nunca la dirección completa.

## Salud

`/api/health/live` confirma que el proceso responde y no consulta dependencias, porque reiniciar el servicio no repara una dependencia caída. `/api/health/ready` evalúa el repositorio real y responde `503` cuando falla. Una comprobación que lanza una excepción cuenta como fallo, nunca como éxito.

## Limitaciones conocidas del alcance actual

- ~~El alta de identidad (HU-01) sigue simulada en local.~~ **Superado el 2026-08-29**: este servicio no da de alta identidades y `IdentityProviderPort` se eliminó. El alta ocurre en la pantalla del proveedor, de modo que quien llega a `POST /api/accounts` ya tiene con qué autenticarse.
- `CognitoAuthenticationProvider` no está confirmado contra la configuración real: usa `AdminInitiateAuth`/`AdminRespondToAuthChallenge` (`ADMIN_USER_PASSWORD_AUTH`), que exige permiso IAM en el rol de ejecución del runtime y `ALLOW_ADMIN_USER_PASSWORD_AUTH` en `ExplicitAuthFlows`. ADR-004 no confirma ninguno de los dos. Si faltan, el login real falla (no las pruebas, que usan `FakeAuthenticationProvider`).
- El segundo factor administrativo (HU-02) usa el reto que el proveedor emita, pero el mecanismo aprobado por el cliente (correo) no coincide con el aprovisionado en el pool (TOTP): el correo exige SES, decisión todavía pendiente. Ver ADR-004 en Nexus-Battle-Infrastructure.
- Los bytes del avatar viven fuera de PostgreSQL (`AvatarStoragePort`). En local se usa disco; AWS sustituye el adaptador.
- Las solicitudes de notificación se registran en la observabilidad con la forma exacta del mensaje, pero no se publican en una cola. Depende de ADR-006.
- **Mi Cuenta (HU-05):** `PATCH /api/accounts/me` edita hoy **solo el apodo** (`displayName`). `firstNames`, `lastNames`, `email` y `avatar` no se editan porque HU-05 no enumera aquí una lista definitiva de campos editables (y `changeEmail` reabriría la verificación del correo).
- **Preferencias (HU-05):** idioma y apariencia no están implementadas. No existe en el repositorio un vocabulario aprobado de valores; modelarlas con valores inventados sería peor que declarar el bloqueo. `PATCH /api/accounts/me` está preparado para extenderse sin reescribirse.
- **Suscripciones y métodos de pago (HU-05):** sin operaciones funcionales aprobadas ni ownership definido para `Account`. Fuera del alcance implementable.
- **Notificación de cierre de eliminación (HU-43.4):** vive en Nexus-Battle-Notifications, todavía sin implementar. Account ya emite la solicitud con el identificador de plantilla `account-deletion-closed`; hasta que Notifications incorpore esa plantilla, la entrega depende de `NOTIFICATIONS_INGEST_URL` y no bloquea el cierre de la solicitud si falla.
- **Interfaz Web de eliminación (HU-43.5):** fuera del alcance de este repositorio.
- **Cognito de la cuenta eliminada:** la matriz de tratamiento deja explícitamente fuera de HU-43 la eliminación del usuario en el proveedor de identidad ("sujeto a la eliminación del usuario en Cognito, fuera del alcance de HU-43 sobre datos propios"). `erase()` no la invoca: la identidad en Cognito sigue existiendo tras el tratamiento, aunque ya no pueda autenticarse contra una cuenta `DELETED`.

Estas limitaciones están declaradas de forma explícita para que la arquitectura de demo no se confunda con la arquitectura objetivo, documentada en `docs/architecture/target-scale-deployment.md` de Nexus-Battle-Infrastructure.
