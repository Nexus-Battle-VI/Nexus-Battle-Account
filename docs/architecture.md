# Arquitectura de Nexus-Battle-Account

Documento técnico del servicio. La arquitectura del sistema completo, los ADR y los diagramas viven en [Nexus-Battle-Infrastructure](https://github.com/Nexus-Battle-VI/Nexus-Battle-Infrastructure).

## Bounded context

**Account/Identity** es responsable de la existencia de una cuenta de jugador, su ciclo de vida y sus roles. Su lenguaje ubicuo se limita a cuenta, correo, nombre visible, estado, verificación y rol.

No es responsable de autenticar. Autenticar es demostrar que quien solicita es el titular, y esa prueba pertenece al proveedor de identidad. Account decide **si una cuenta puede autenticarse**, que es una regla de negocio distinta y sí le corresponde.

### Datos que posee

Account es propietario exclusivo de las cuentas: identificador, correo, nombre visible, estado y roles. Ningún otro servicio accede a este almacén, ni directamente ni mediante claves foráneas.

Account **no posee credenciales**. No almacena contraseñas, hashes, sales, tokens de sesión ni secretos de segundo factor.

## Capas

```text
+-------------------------------------------------------------+
|  adapters/inbound/http   AccountsController, HealthController|
+-------------------------------------------------------------+
|  application             RegisterAccount, GetAccount,        |
|                          VerifyAccount, ports/               |
+-------------------------------------------------------------+
|  domain                  Account, Role, RolePolicy,          |
|                          EmailAddress, DisplayName, eventos  |
+-------------------------------------------------------------+
|  adapters/outbound       InMemoryAccountRepository,          |
|                          FakeIdentityProvider,               |
|                          LoggingNotificationRequester,       |
|                          SystemClock, UuidGenerator          |
+-------------------------------------------------------------+
|  infrastructure          config, observability, health,      |
|                          bootstrap (raiz de composicion)     |
+-------------------------------------------------------------+
```

Las dependencias apuntan siempre hacia el dominio. El dominio no conoce ninguna capa exterior, y la capa de aplicación no conoce NestJS.

## Puertos

| Puerto                    | Responsabilidad                                      | Implementación actual          |
| ------------------------- | ---------------------------------------------------- | ------------------------------ |
| `AccountRepositoryPort`   | Persistir y recuperar el agregado                    | `InMemoryAccountRepository`    |
| `IdentityProviderPort`    | Alta, consulta y baja del sujeto de identidad        | `FakeIdentityProvider`         |
| `NotificationRequestPort` | Solicitar una notificación al contexto Notifications | `LoggingNotificationRequester` |
| `ClockPort`               | Proveer el instante actual                           | `SystemClock`                  |
| `IdGeneratorPort`         | Generar identificadores                              | `UuidGenerator`                |

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
1. Validar correo y nombre        -> falla temprano, sin efectos
2. Comprobar unicidad del correo  -> falla temprano, sin efectos
3. Alta en el proveedor           -> primer efecto externo
4. Persistir la cuenta            -> si falla, se retira el sujeto (compensacion)
5. Solicitar el correo            -> no compensa: la cuenta ya es valida
```

El paso 5 no participa de la compensación de forma deliberada. Si la solicitud de notificación falla, la cuenta existe y es correcta; deshacer el registro por no haber podido enviar un correo de bienvenida sería peor que reintentar la notificación. El error se propaga para que quede registrado, pero no revierte nada.

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

## Roles

Toda cuenta nace con el rol `PLAYER`, que no puede retirarse: garantiza que ninguna cuenta quede sin permisos básicos por una operación de gestión. Los roles `MODERATOR` y `ADMINISTRATOR` se acumulan sobre él y solo un administrador puede concederlos o retirarlos.

Los roles nunca se aceptan desde la petición de registro. El contrato HTTP rechaza campos no declarados, de modo que un cliente no puede autoconcederse privilegios.

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

- La persistencia es en memoria y se pierde al reiniciar. El adaptador PostgreSQL depende de ADR-005, que debe decidir el ORM u ODM antes de escribir esquema y migraciones.
- El proveedor de identidad es simulado. Es un blocker declarado del proyecto, no un olvido.
- Las solicitudes de notificación se registran en la observabilidad con la forma exacta del mensaje, pero no se publican en una cola. Depende de ADR-006.
- La emisión de JWT, la sesión y el segundo factor por correo no forman parte de este alcance.

Estas limitaciones están declaradas de forma explícita para que la arquitectura de demo no se confunda con la arquitectura objetivo, documentada en `docs/architecture/target-scale-deployment.md` de Nexus-Battle-Infrastructure.
