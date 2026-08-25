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

| Ruta                                  | Protección                                                 |
| ------------------------------------- | ---------------------------------------------------------- |
| `POST /api/accounts`                  | **Pública.** Quien se registra todavía no tiene testimonio |
| `GET /api/accounts/:id`               | Testimonio válido                                          |
| `POST /api/accounts/:id/verification` | Rol **`ADMINISTRATOR`**                                    |
| `GET /api/health/*`                   | **Pública.** Un orquestador no lleva testimonio            |

**La protección es el comportamiento por defecto.** El guard se registra de forma global y hay que excluir explícitamente lo que deba ser público con `@Public()`. Al revés —proteger ruta por ruta— cualquier endpoint nuevo nacería desprotegido, y ese olvido no falla ninguna prueba.

### Un binario de producción sin autenticación no arranca

Con `NODE_ENV=production` y `AUTH_MODE=disabled`, `loadConfig` lanza `ConfigurationError` y el servicio **no llega a escuchar**. Es la traducción en código del blocker de ADR-004: un aviso en el registro se pasa por alto; un arranque que falla, no.

| Variable             | Efecto                                              |
| -------------------- | --------------------------------------------------- |
| `AUTH_MODE=disabled` | Ninguna ruta comprueba nada. **Estado del blocker** |
| `AUTH_MODE=jwt`      | Exige `COGNITO_USER_POOL_ID` y `COGNITO_CLIENT_ID`  |

Los roles llegan en el claim `cognito:groups`. **Los grupos que no corresponden a un rol conocido se descartan**: aceptarlos convertiría el pool en una fuente de roles arbitrarios, donde bastaría crear un grupo con cualquier nombre para inventar un permiso.

### Lo que todavía NO comprueba

**No hay comprobación de propiedad.** Cualquier testimonio válido puede leer cualquier cuenta, porque el agregado `Account` **no guarda el sujeto de identidad**: no existe forma de saber que una cuenta pertenece a quien pregunta.

Vincularlo por correo sería un vínculo frágil —el correo cambia— y afirmar la propiedad sin comprobarla sería peor. Añadir `subject` al agregado es el paso siguiente, y hasta entonces esta limitación queda declarada en lugar de disimulada.

Ver `docs/adr/ADR-004-identity-directory.md` en Nexus-Battle-Infrastructure.

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

Con la configuración por defecto el servicio arranca con el repositorio en memoria y el proveedor de identidad simulado: no requiere base de datos ni servicios externos.

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
| `POST` | `/api/accounts`                  | Registra una cuenta nueva                                      |
| `GET`  | `/api/accounts/:id`              | Recupera una cuenta                                            |
| `POST` | `/api/accounts/:id/verification` | Marca la cuenta como verificada                                |
| `GET`  | `/api/health/live`               | El proceso responde. No consulta dependencias                  |
| `GET`  | `/api/health/ready`              | Evalúa las dependencias reales. Responde `503` si alguna falla |
| `GET`  | `/api/version`                   | Servicio, versión y entorno                                    |

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

- **La persistencia es en memoria.** El repositorio guarda instantáneas y se pierde al reiniciar. El adaptador PostgreSQL depende de que ADR-005 decida el ORM u ODM; hasta entonces no se elige uno de facto. Configurar `PERSISTENCE_DRIVER=postgres` valida la configuración y lo advierte en el registro, pero no habilita un adaptador que no existe.
- **La identidad es simulada.** Ver la sección correspondiente arriba.
- **Las solicitudes de notificación no se publican en una cola.** Se registran con la forma exacta del mensaje que consumirá Notifications; la publicación real depende de ADR-006.
- La autenticación, la emisión de JWT y el segundo factor por correo no forman parte de este alcance. El agregado ya distingue si una cuenta puede autenticarse, que es la regla de negocio que corresponde a este contexto.

## Contribución

Se aplican las convenciones descritas en [CONTRIBUTING.md](CONTRIBUTING.md) y la [política de trazabilidad entre repositorios](https://github.com/Nexus-Battle-VI/Nexus-Battle-Management/blob/main/docs/governance/cross-repository-traceability.md) de Management.

## Licencia

`Licensing pending project governance`. Este repositorio todavía no tiene una licencia asignada; su definición requiere autorización del gobierno del proyecto.
