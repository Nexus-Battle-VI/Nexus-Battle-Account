# HU-44.2 — Consultas, historial y rango de registro

Auditoría y validación: 2026-09-09.

Refs Nexus-Battle-VI/Nexus-Battle-Management#38

Refs Nexus-Battle-VI/Nexus-Battle-Management#120

RF-44: CA-01 a CA-04, seguridad administrativa y no mutación. La exportación
existente reutiliza exactamente los mismos criterios.

## Fuente funcional y auditoría

Se leyeron AGENTS.md, CONTRIBUTING.md, README.md, docs/architecture.md y
.github/CODEOWNERS. No hay ADR locales. Se consultaron
[HU-44 #38](https://github.com/Nexus-Battle-VI/Nexus-Battle-Management/issues/38),
[Task #120](https://github.com/Nexus-Battle-VI/Nexus-Battle-Management/issues/120)
y sus comentarios.

La [auditoría del 5 de septiembre](https://github.com/Nexus-Battle-VI/Nexus-Battle-Management/issues/120#issuecomment-5556701006)
dejaba pendiente la semántica temporal. **El prompt posterior del responsable
aprueba registeredFrom/registeredTo opcionales, inclusivos, en UTC y combinados
mediante AND. Esa ambigüedad queda resuelta.** HU-42 también está integrada.

Rama: `feat/hu-44-2-completar-filtros-usuarios`. La primera fase comenzó limpia;
la fase temporal conserva los cambios sin commit de historial y no mutación.
Se audita el código actual antes de extenderlo, sin duplicar lo realizado.

| REQUISITO              | ESTADO INICIAL                                                                     | ARCHIVO                                                          | CAMBIO NECESARIO / REALIZADO                                  |
| ---------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------- |
| Endpoint               | GET /api/accounts y GET /api/accounts/export existentes                            | src/adapters/inbound/http/accounts.controller.ts                 | Conservar rutas y compartir mapeo                             |
| DTO/query              | Búsquedas, role, status; historial ya incorporado en primera fase                  | accounts.dto.ts; AdminAccountQueryCriteria.ts                    | Límites opcionales: string HTTP validado, Date interno        |
| Caso de uso            | Normaliza y consulta AdminAccountQueryPort                                         | ListAdminAccounts.ts                                             | Validar/copiar límites y rechazar rango invertido             |
| Errores                | Application independiente de HTTP                                                  | ApplicationError.ts                                              | InvalidAdminAccountQueryError; controller traduce a 400       |
| Puertos de cuentas     | Contratos de agregado y consulta separados                                         | AccountRepositoryPort.ts; AdminAccountQueryPort.ts               | Sin cambios                                                   |
| Account                | Sin historial ni fecha de persistencia en el agregado                              | src/domain/entities/Account.ts                                   | Sin cambios de dominio                                        |
| Fecha real             | accounts.created_at; metadatos del primer guardado en memoria; salida registeredAt | PostgresAccountRepository.ts; InMemoryAccountRepository.ts       | Comparaciones inclusivas sobre datos reales                   |
| Sanction HU-42         | Tipos, actor, destinatario, causal, fechas y apelación existentes                  | Sanction.ts; SanctionRepositoryPort.ts; adaptadores de sanciones | Primera fase: consulta mínima de IDs con historial            |
| Estadísticas           | active, suspended, banned y pendingVerification ya existentes                      | ListAdminAccounts.ts; AdminAccountSummaryDto.ts                  | Conservar conteos del resultado filtrado                      |
| Búsqueda, rol y estado | Igualdad normalizada, cuatro roles, estados reales y AND                           | Adaptadores de cuentas                                           | Reutilizar y combinar con fechas                              |
| Autorización           | JwtAuthGuard y RolesGuard, incluye SuperAdministrator                              | src/adapters/inbound/http/auth/                                  | Conservar protección                                          |
| No mutación            | El guard reactivaba al actor con suspensión vencida durante lecturas               | jwt-auth.guard.ts; decorators.ts                                 | Primera fase: impedir escritura en consulta/exportación HU-44 |
| Exportación            | ExportAdminAccounts reutiliza ListAdminAccounts                                    | ExportAdminAccounts.ts                                           | Sin filtro temporal separado                                  |

`AuthorizeAdminPanelAccess.ts` es un caso de uso anterior sin consumidores en
producción ni registro en AppModule. El endpoint actual se autoriza mediante
guards. No se crea una matriz RBAC paralela.

## Contrato HTTP final

GET `/api/accounts` y GET `/api/accounts/export` comparten parámetros opcionales:

| Parámetro              | Semántica                                                                           |
| ---------------------- | ----------------------------------------------------------------------------------- |
| id                     | Igualdad exacta tras normalización de AccountId                                     |
| email                  | Igualdad con normalización existente de EmailAddress                                |
| firstNames / lastNames | Igualdad sin distinguir mayúsculas tras PersonName; sin búsqueda parcial            |
| nickname               | Mapea a displayName; igualdad sin distinguir mayúsculas con normalización existente |
| role                   | Pertenencia a PLAYER, MODERATOR, ADMINISTRATOR o SUPER_ADMINISTRATOR                |
| status                 | Igualdad con PENDING_VERIFICATION, ACTIVE, SUSPENDED o BANNED                       |
| hasSanctionHistory     | true: recibió alguna sanción; false: ninguna; omitido: no filtra                    |
| registeredFrom         | ISO 8601 con hora y zona explícita; límite inferior inclusivo UTC                   |
| registeredTo           | ISO 8601 con hora y zona explícita; límite superior inclusivo UTC                   |

Ejemplo:

```text
GET /api/accounts?registeredFrom=2026-08-01T00:00:00.000Z&registeredTo=2026-08-31T23:59:59.999Z&role=PLAYER&hasSanctionHistory=true
```

Todos los criterios presentes se combinan mediante **AND**. Sin coincidencias:
items vacío y contadores en cero. Se conserva el orden por ID. statusCounts cuenta
el resultado filtrado; sin criterios cuenta todas las cuentas. Esta semántica
ya estaba documentada y probada antes de la tarea.

### Semántica de fechas y errores

- Ambos límites son opcionales e independientes.
- Desde: `registeredAt >= registeredFrom`.
- Hasta: `registeredAt <= registeredTo`.
- Ambos: `registeredFrom <= registeredAt <= registeredTo`.
- Ninguno: no se añade condición temporal.
- Límites iguales: válidos, representan un instante.
- HTTP requiere fecha y hora completas con `Z` o un offset `±HH:mm`.
  `2026-08-02T05:00:00-05:00` y `2026-08-02T10:00:00.000Z` representan
  el mismo instante UTC.
- Precisión de entrada: segundos o hasta tres dígitos fraccionarios, conforme
  a Date/registeredAt. Una precisión mayor se rechaza con 400 para evitar
  truncar silenciosamente el límite.
- Fecha local sin zona, solo fecha, formato local, fecha imposible, valor vacío
  y parámetro repetido: HTTP 400.
- Fecha inválida y from > to: InvalidAdminAccountQueryError en Application,
  traducido a HTTP 400 tanto al consultar como al exportar.
- Los Date se copian antes de consultar: mutarlos desde el llamador durante
  una operación asíncrona no altera el resultado.

El DTO HTTP usa IsISO8601 estricto y exige un instante con zona. El mapper
compartido crea los Date. Swagger documenta string/date-time, opcionalidad,
inclusividad, UTC, precisión y ejemplos. No se añade Date al agregado Account.

### PostgreSQL e InMemory

PostgreSQL añade únicamente las condiciones cuyos límites existen:

```sql
account.created_at >= $1
AND account.created_at <= $2
```

Kysely vincula los parámetros; no se interpola entrada del cliente. La comparación
ocurre sobre timestamptz sin cast a date ni truncamiento. La prueba real con
`2026-08-10T10:00:00.000001Z` demuestra que el motor conserva los microsegundos
almacenados al comparar contra límites de milisegundos.

InMemory compara Date.parse(registeredAt) con getTime() de los mismos límites.
registeredAt proviene de los metadatos reales del primer guardado. Se prueba
paridad con iguales fechas sembradas en ambos adaptadores. La salida JavaScript
conserva su precisión previa de milisegundos; no redefine la precisión del motor.

No se modifica esquema, migraciones, created_at ni updated_at.

### HU-42 y exportación

Se reutilizan la tabla sanctions, su índice target_account_id y la misma instancia
de repositorio de sanciones en memoria que usa HU-42. La consulta mínima
findAccountIdsWithHistory(accountIds) devuelve solo IDs candidatos sin duplicados.
InMemory consulta en lote; PostgreSQL usa EXISTS / NOT EXISTS por destinatario.

Se incluyen WARNING, TEMPORARY_SUSPENSION vigente o vencida y PERMANENT_BAN.
El actor no cuenta como sancionado. Sanciones de cuentas borradas no agregan
usuarios inexistentes. No hay segundo historial, carga de historiales completos
desde PostgreSQL ni N+1.

ExportAdminAccounts llama a ListAdminAccounts con los mismos criterios. Las dos
rutas comparten DTO y mapper. No hay otra implementación del filtro de fecha.

## Seguridad y no mutación

Administrator y SuperAdministrator permitidos. Player y Moderator reciben 403,
incluso enviando x-user-role: ADMINISTRATOR; anónimo recibe 401. Se mantienen los
guards reales y los dobles de identidad exclusivos del harness de pruebas.

La metadata interna ReadOnlyAccountQuery evita reinstate/save durante las dos
lecturas HU-44 cuando la suspensión del actor venció. El cliente no controla esa
metadata. Las suspensiones vigentes y baneos siguen rechazados; las demás rutas
conservan el comportamiento de HU-42.

Las pruebas comparan snapshots, registeredAt y sanciones. PostgreSQL compara todas
las columnas de accounts, account_roles y sanctions antes/después, incluidas
created_at y updated_at.

## Matriz final CA-01 a CA-04

| Criterio                | Evidencia                                                                                             | Estado |
| ----------------------- | ----------------------------------------------------------------------------------------------------- | ------ |
| CA-01                   | Acceso autorizado y estadísticas ACTIVE/SUSPENDED/BANNED, conjunto mixto y filtrado; Unit y HTTP      | PASS   |
| CA-02                   | ID, correo, nombres, apellidos y nickname/displayName; normalización y búsquedas vacías               | PASS   |
| CA-03                   | Roles, estados, historial y rango opcional inclusivo UTC; Unit, HTTP y PostgreSQL real                | PASS   |
| CA-04                   | AND de fecha con búsqueda, role, status, historial y múltiples criterios; casos vacíos y paridad      | PASS   |
| Exportación compartida  | Archivo idéntico a items para cada escenario temporal HTTP y DB                                       | PASS   |
| Seguridad / no mutación | Rechazos, protección ante header de rol, sin reactivación durante lectura; filas y snapshots intactos | PASS   |

## Pruebas y datos sintéticos

Esta segunda fase añade **44 casos habituales (17 unitarios y 27 HTTP)** y
**2 pruebas DB**. La principal DB recorre 15 escenarios; la segunda comprueba la
precisión real de timestamptz. Se conservan los casos previos de la primera fase.

| Casos exigidos                                                                  | Prueba                                                                                                           |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Solo desde/hasta, ambos, extremos iguales, fuera por debajo/encima, rango vacío | Unit «filtra por fecha»; HTTP «consulta y exportacion aplican»; DB «aplica limites inclusivos sobre timestamptz» |
| from > to, ISO inválido y fechas ambiguas                                       | HTTP «rechaza fechas invalidas o rango invertido»; Unit: error fuera de HTTP                                     |
| Conversión UTC                                                                  | HTTP y DB: límites equivalentes con offset -05:00                                                                |
| Fecha + búsqueda/rol/estado/historial/múltiples criterios                       | Las tres suites, incluido caso donde fecha excluye una coincidencia                                              |
| No modificación de created_at                                                   | DB: filas completas antes/después; Unit/HTTP: igualdad de registeredAt                                           |
| Exportación idéntica                                                            | HTTP y DB comparan archivo con items para cada escenario                                                         |
| Aislamiento de Date                                                             | Unit: cambios del llamador durante consulta asíncrona                                                            |
| OpenAPI                                                                         | HTTP: dos parámetros opcionales string/date-time                                                                 |

Datos sintéticos: correos @nexus.test. Unit registra cinco cuentas del 1 al 5 de
agosto de 2026 a las 10:00 UTC. HTTP registra banned/admin/super/suspended del 1
al 4 de agosto a las 10:00 UTC. DB/InMemory registra admin/super/suspended los
días 10, 11 y 12 a las 10:00 UTC. Los casos a ±1 ms comprueban exclusión inmediata.
No se usan datos personales reales.

Se reutilizan las suites de consultas, exportación, autenticación y HU-42.
No se cambian tests de otras funcionalidades para alterar sus expectativas.

## Validación final

Entorno: Node 24.18.0, npm 11.16.0, Docker Server 29.4.0. PostgreSQL real mediante
el harness Testcontainers existente, imagen postgres:17-alpine. No se agregan
dependencias ni se cambian versiones, exclusiones o umbrales.

TDD temporal: RED 15 fallos / 42 correctos antes de implementar; GREEN focalizado
116 casos. Los errores RED demuestran la ausencia de filtros válidos y Swagger.

| Comando               | Resultado                                                                        |
| --------------------- | -------------------------------------------------------------------------------- |
| npm run format        | PASS; ningún archivo ajeno modificado                                            |
| npm run format:check  | PASS                                                                             |
| npm run lint          | PASS desde la ruta real, evitando el problema conocido de resolución del sandbox |
| npm run typecheck     | PASS                                                                             |
| npm run test          | PASS: 52 suites, 803 pruebas                                                     |
| npm run test:coverage | PASS: 52 suites, 803 pruebas                                                     |
| npm run test:db       | PASS: 5 suites, 68 pruebas contra PostgreSQL real                                |
| npm run build         | PASS                                                                             |
| git diff --check      | PASS                                                                             |

| Cobertura | Statements          | Branches           | Functions         | Lines               |
| --------- | ------------------- | ------------------ | ----------------- | ------------------- |
| Habitual  | 91.42 % (2601/2845) | 84.98 % (962/1132) | 85.81 % (472/550) | 91.07 % (2480/2723) |
| DB        | 96.59 % (170/176)   | 91.66 % (66/72)    | 96.15 % (50/52)   | 97.07 % (166/171)   |

Se conservan las superficies y umbrales originales de cada configuración.
No se suman porcentajes. Todas las ejecuciones finales terminaron con código 0.

## Archivos y Git

La fase temporal modifica estos 12 archivos existentes en el workspace:

- src/application/dto/AdminAccountQueryCriteria.ts
- src/application/errors/ApplicationError.ts
- src/application/use-cases/ListAdminAccounts.ts
- src/adapters/inbound/http/accounts.dto.ts
- src/adapters/inbound/http/accounts.controller.ts
- src/adapters/outbound/persistence/InMemoryAccountRepository.ts
- src/adapters/outbound/persistence/PostgresAccountRepository.ts
- test/unit/admin-account-query.spec.ts
- test/integration/admin-accounts-http.spec.ts
- test/db/postgres-account-repository.spec.ts
- docs/evidence/hu-44-2-consultas-historial.md
- docs/evidence/hu-44-2-fecha-registro.md

El árbol acumulado contiene 17 archivos rastreados modificados y este informe
nuevo sin rastrear, procedente de la primera fase. Conserva también los cambios
anteriores de SanctionRepositoryPort, adaptadores de sanciones, decorators/guard
y AppModule. No hay archivos staged ni cambio de rama. No se ejecuta commit,
push, PR, merge ni cierre de Issues.

## Veredicto

**A. HU-44.2 COMPLETA Y LISTA PARA PR FINAL.**

CA-01 a CA-04 están verificados para el alcance backend de #120, incluido el
último filtro temporal aprobado. PostgreSQL real está validado. Esta conclusión
no declara la HU padre Done ni acredita tareas visuales ajenas a HU-44.2.
