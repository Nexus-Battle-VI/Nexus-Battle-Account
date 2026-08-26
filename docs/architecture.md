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
|  adapters/inbound/http   AccountsController, SessionsController,|
|                          HealthController                    |
+-------------------------------------------------------------+
|  application             RegisterAccount, GetAccount,        |
|                          VerifyAccount, LoginAccount,         |
|                          CompleteSecondFactor, ports/         |
+-------------------------------------------------------------+
|  domain                  Account, Role, RolePolicy,          |
|                          EmailAddress, DisplayName, eventos  |
+-------------------------------------------------------------+
|  adapters/outbound       InMemoryAccountRepository,          |
|                          FakeIdentityProvider,                |
|                          FakeAuthenticationProvider,           |
|                          LoggingNotificationRequester,        |
|                          SystemClock, UuidGenerator          |
+-------------------------------------------------------------+
|  infrastructure          config, observability, health,      |
|                          bootstrap (raiz de composicion)     |
+-------------------------------------------------------------+
```

Las dependencias apuntan siempre hacia el dominio. El dominio no conoce ninguna capa exterior, y la capa de aplicación no conoce NestJS.

## Puertos

| Puerto                        | Responsabilidad                                                                                                                | Implementación actual                                                                                            |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `AccountRepositoryPort`       | Persistir y recuperar el agregado, incluida la busqueda por apodo (HU-02)                                                      | `InMemoryAccountRepository` / `PostgresAccountRepository`                                                        |
| `IdentityProviderPort`        | Alta, consulta y baja del sujeto de identidad                                                                                  | `FakeIdentityProvider` (Cognito sustituye el adaptador)                                                          |
| `AuthenticationProviderPort`  | Verificacion de contrasena y segundo factor (HU-02). Separado de `IdentityProviderPort` a proposito: ver el archivo del puerto | `FakeAuthenticationProvider` (Cognito sustituye el adaptador; pendiente, igual que el de `IdentityProviderPort`) |
| `AvatarStoragePort`           | Guardar y borrar bytes de avatar                                                                                               | `LocalAvatarStorage` (AWS sustituye el adaptador)                                                                |
| `NicknameBlacklistPort`       | Consultar la lista negra vigente de apodos                                                                                     | `InMemoryNicknameBlacklist` / `PostgresNicknameBlacklist`                                                        |
| `SecurityQuestionCatalogPort` | Catálogo activo de preguntas de seguridad                                                                                      | En memoria / `PostgresSecurityQuestionCatalog`                                                                   |
| `NotificationRequestPort`     | Solicitar una notificación al contexto Notifications                                                                           | `LoggingNotificationRequester`                                                                                   |
| `ClockPort`                   | Proveer el instante actual                                                                                                     | `SystemClock`                                                                                                    |
| `IdGeneratorPort`             | Generar identificadores                                                                                                        | `UuidGenerator`                                                                                                  |

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
4. Alta en el proveedor de identidad           -> primer efecto externo
5. Almacenar avatar                            -> segundo efecto externo
6. Persistir cuenta, roles y hashes            -> transaccion PostgreSQL;
                                                 si falla, se borra el avatar
                                                 y se revoca solo el sujeto
                                                 creado en esta peticion
7. Solicitar el correo                         -> no compensa: la cuenta ya es valida
```

El paso 7 no participa de la compensación de forma deliberada. Si la solicitud de notificación falla, la cuenta existe y es correcta; deshacer el registro por no haber podido enviar un correo de bienvenida sería peor que reintentar la notificación. El error se propaga para que quede registrado, pero no revierte nada.

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
```

Una cuenta solo puede autenticarse en estado `ACTIVE`. Cambiar el correo devuelve la cuenta a `PENDING_VERIFICATION`, porque la nueva dirección todavía no ha demostrado pertenecer a la persona titular.

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
`AuthenticationProviderPort` para la justificación de por qué es un puerto
separado de `IdentityProviderPort`, y el reporte de HU-02 para el estado real
de la integración con Cognito (pendiente, igual que el alta) y el desajuste
entre el segundo factor aprobado (correo) y el aprovisionado (TOTP).

## Roles

Toda cuenta nace con el rol `PLAYER`, que no puede retirarse: garantiza que ninguna cuenta quede sin permisos básicos por una operación de gestión. Los roles `MODERATOR`, `ADMINISTRATOR` y `SUPER_ADMINISTRATOR` (HU-02) se acumulan sobre él.

Los roles nunca se aceptan desde la petición de registro ni desde la de login. El contrato HTTP rechaza campos no declarados, de modo que un cliente no puede autoconcederse privilegios; el rol que decide la autorización se lee siempre de la cuenta ya persistida.

**HU-02 solo LEE el rol vigente; no lo asigna.** La asignación y modificación de roles es HU-39 (`Nexus-Battle-Management#27`), todavía no implementada. `SUPER_ADMINISTRATOR` es una cuenta raíz única: no se crea mediante HU-01, no se recupera mediante HU-04 y no existe una operación pública que la genere.

`RolePolicy.canManageRoles` sigue concediendo la gestión de roles a `ADMINISTRATOR`, lo que la HU-39 vigente contradice (solo `SUPER_ADMINISTRATOR` debería poder hacerlo). `grantRole`/`revokeRole` no los invoca ningún caso de uso hoy, así que no hay una vulnerabilidad activa; la inconsistencia queda documentada en el propio archivo de `RolePolicy` y corresponde corregirla a HU-39, no a HU-02.

## Contrato HTTP

La especificación OpenAPI se genera desde el código con `@nestjs/swagger` y se expone en `/api/docs` cuando la documentación está habilitada. En producción permanece deshabilitada salvo decisión explícita.

Eventos de dominio emitidos:

| Evento                  | Cuándo                                                 |
| ----------------------- | ------------------------------------------------------ |
| `account.registered`    | Se registra una cuenta nueva                           |
| `account.verified`      | La cuenta demuestra control del correo y pasa a activa |
| `account.email-changed` | Cambia la dirección de correo de una cuenta            |

## Observabilidad

El registro es JSON estructurado por línea. Se emite exclusivamente desde `infrastructure/observability/logger.ts`; el resto del código tiene prohibido escribir en la consola mediante la regla `no-console` de ESLint.

El correo electrónico es un dato personal: la observabilidad registra el **dominio** de la dirección, nunca la dirección completa.

## Salud

`/api/health/live` confirma que el proceso responde y no consulta dependencias, porque reiniciar el servicio no repara una dependencia caída. `/api/health/ready` evalúa el repositorio real y responde `503` cuando falla. Una comprobación que lanza una excepción cuenta como fallo, nunca como éxito.

## Limitaciones conocidas del alcance actual

- El proveedor de identidad es simulado en local (`FakeIdentityProvider` / `FakeAuthenticationProvider`, HU-01/HU-02). Cognito sustituye ambos adaptadores sin reescribir el dominio. Es un blocker declarado del proyecto, no un olvido: mientras el registro no cree un usuario real en el pool, no hay nadie real contra quien autenticar.
- El segundo factor administrativo (HU-02) usa el reto que el proveedor emita, pero el mecanismo aprobado por el cliente (correo) no coincide con el aprovisionado en el pool (TOTP): el correo exige SES, decisión todavía pendiente. Ver ADR-004 en Nexus-Battle-Infrastructure.
- Los bytes del avatar viven fuera de PostgreSQL (`AvatarStoragePort`). En local se usa disco; AWS sustituye el adaptador.
- Las solicitudes de notificación se registran en la observabilidad con la forma exacta del mensaje, pero no se publican en una cola. Depende de ADR-006.
- La asignación y modificación de roles (`HU-39`) no forma parte de este alcance: HU-02 solo lee el rol vigente.

Estas limitaciones están declaradas de forma explícita para que la arquitectura de demo no se confunda con la arquitectura objetivo, documentada en `docs/architecture/target-scale-deployment.md` de Nexus-Battle-Infrastructure.
