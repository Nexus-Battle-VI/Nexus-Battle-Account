# Evidencia HU-44.5 - Panel administrativo de usuarios

## 1. Alcance

Task: `HU-44.5 - Verificar panel, filtros, autorizacion y exportacion de usuarios`.

Management:

- Task: Nexus-Battle-VI/Nexus-Battle-Management#127
- Historia padre: Nexus-Battle-VI/Nexus-Battle-Management#38
- Requisito funcional: `RF-44`

Esta evidencia verifica el incremento disponible en `Nexus-Battle-Account` sobre:

- `GET /api/accounts`
- `GET /api/accounts/export`
- `ListAdminAccounts`
- `ExportAdminAccounts`
- `AdminAccountQueryPort`
- `AdminAccountExportPort`
- adaptadores InMemory y PostgreSQL existentes

No declara completa la HU-44 padre porque hay criterios obligatorios aun no
implementables dentro de Account:

- estado `BANNED`
- historial de sanciones, dependiente de HU-42
- semantica de filtro por fecha de registro
- evidencia visual del panel, dependiente de HU-44.3 y Nexus-Battle-Web

## 2. Ambiente

| Elemento                  | Valor                                                                       |
| ------------------------- | --------------------------------------------------------------------------- |
| SO/shell                  | Windows / PowerShell                                                        |
| Node.js                   | `v24.18.0`                                                                  |
| npm                       | `11.16.0`                                                                   |
| Docker CLI                | `29.4.0`                                                                    |
| Docker Server             | `29.4.0` con acceso elevado                                                 |
| Docker context elevado    | `desktop-linux`                                                             |
| Contexto normal observado | `default`, con bloqueo de permisos a `C:\Users\Usuario\.docker\config.json` |

`test:db` se ejecuta con Docker Desktop disponible. En esta maquina, el acceso
normal al pipe Docker queda bloqueado por permisos locales; con elevacion el
daemon responde y Testcontainers puede crear PostgreSQL.

## 3. SHA base

| Base    | SHA       | Commit                                                                     |
| ------- | --------- | -------------------------------------------------------------------------- |
| HU-44.2 | `12affa0` | `feat(account): [HU-44.2] implementar consulta administrativa de usuarios` |
| HU-44.4 | `c7793b2` | `feat(account): [HU-44.4] implementar exportacion de usuarios`             |

## 4. Matriz RF-44 / CA / pruebas

| RF    | CA    | Requisito verificable                                                                       | Caso de prueba                                                              | Archivo                                                                                               | Resultado                                       |
| ----- | ----- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| RF-44 | CA-01 | Acceso administrativo y estadisticas de usuarios activos/suspendidos representables.        | Lista cuentas sin filtros y calcula estadisticas de estados representables. | `test/unit/admin-account-query.spec.ts`                                                               | PASS                                            |
| RF-44 | CA-01 | El endpoint administrativo devuelve conteos coherentes con el dataset filtrado.             | Permite a ADMINISTRATOR consultar listado filtrado y valida `statusCounts`. | `test/integration/admin-accounts-http.spec.ts`                                                        | PASS                                            |
| RF-44 | CA-01 | Estadistica de baneados.                                                                    | No ejecutable en Account actual.                                            | N/A                                                                                                   | BLOCKED: `BANNED` no existe en `AccountStatus`. |
| RF-44 | CA-02 | Busqueda por ID, email, nombres, apellidos y apodo/displayName con normalizacion soportada. | Busca por cada criterio con normalizacion determinista.                     | `test/unit/admin-account-query.spec.ts`                                                               | PASS                                            |
| RF-44 | CA-02 | Busqueda sin coincidencias para cada criterio disponible.                                   | Devuelve vacio por ID/email/nombres/apellidos/apodo sin coincidencias.      | `test/unit/admin-account-query.spec.ts`                                                               | PASS                                            |
| RF-44 | CA-02 | Busqueda HTTP por criterios disponibles.                                                    | Combina filtros de busqueda y devuelve resultado valido.                    | `test/integration/admin-accounts-http.spec.ts`                                                        | PASS                                            |
| RF-44 | CA-03 | Filtro por rol para `PLAYER`, `MODERATOR`, `ADMINISTRATOR`, `SUPER_ADMINISTRATOR`.          | Filtra por rol.                                                             | `test/unit/admin-account-query.spec.ts`                                                               | PASS                                            |
| RF-44 | CA-03 | Filtro por estados reales: `PENDING_VERIFICATION`, `ACTIVE`, `SUSPENDED`.                   | Filtra por estado real.                                                     | `test/unit/admin-account-query.spec.ts`                                                               | PASS                                            |
| RF-44 | CA-03 | Filtro por fecha de registro.                                                               | No ejecutable sin semantica aprobada.                                       | N/A                                                                                                   | SPECIFICATION GAP                               |
| RF-44 | CA-03 | Filtro por historial de sanciones.                                                          | No ejecutable sin contrato HU-42 integrado.                                 | N/A                                                                                                   | BLOCKED BY HU-42                                |
| RF-44 | CA-04 | Combinacion AND de criterios disponibles.                                                   | Combina criterios presentes con AND.                                        | `test/unit/admin-account-query.spec.ts`                                                               | PASS                                            |
| RF-44 | CA-04 | Combinacion AND via HTTP.                                                                   | `role=ADMINISTRATOR&status=ACTIVE` y busqueda por nombres/apellidos.        | `test/integration/admin-accounts-http.spec.ts`, `test/integration/admin-accounts-export-http.spec.ts` | PASS                                            |
| RF-44 | CA-05 | Exportacion JSON descargable y parseable.                                                   | Genera archivo JSON determinista con media type y nombre seguros.           | `test/unit/admin-account-export.spec.ts`                                                              | PASS                                            |
| RF-44 | CA-05 | El archivo exportado contiene el mismo conjunto y orden que el panel.                       | Mantiene paridad panel/export para busqueda, filtro, AND y vacio.           | `test/integration/admin-accounts-export-http.spec.ts`                                                 | PASS                                            |
| RF-44 | CA-05 | Campos exportados exactos y ausencia de campos sensibles.                                   | Incluye solo campos aprobados y no exporta campos sensibles.                | `test/unit/admin-account-export.spec.ts`, `test/integration/admin-accounts-export-http.spec.ts`       | PASS                                            |
| RF-44 | CA-06 | Rechazo de actores no autorizados en consulta y exportacion.                                | Moderator/Player 403, anonimo 401, sin payload administrativo/exportable.   | `test/integration/admin-accounts-http.spec.ts`, `test/integration/admin-accounts-export-http.spec.ts` | PASS                                            |
| RF-44 | CA-06 | Reglas base de autenticacion/autorizacion.                                                  | `JwtAuthGuard`, `RolesGuard`, HU-39/RBAC.                                   | `test/unit/auth.spec.ts`, `test/integration/auth-http.spec.ts`                                        | PASS                                            |

## 5. Positivos

- `ADMINISTRATOR` autorizado en `GET /api/accounts`.
- `SUPER_ADMINISTRATOR` autorizado por jerarquia en rutas `ADMINISTRATOR`.
- Busqueda con coincidencia por ID.
- Busqueda con coincidencia por email normalizado.
- Busqueda con coincidencia por nombres.
- Busqueda con coincidencia por apellidos.
- Busqueda con coincidencia por apodo/displayName.
- Filtro por cada rol existente.
- Filtro por cada estado existente.
- Exportacion con coincidencia y archivo JSON parseable.

## 6. Negativos

- `MODERATOR` recibe 403 en consulta.
- `PLAYER` recibe 403 en consulta.
- Peticion anonima recibe 401 en consulta.
- `MODERATOR` recibe 403 en exportacion.
- `PLAYER` recibe 403 en exportacion.
- Peticion anonima recibe 401 en exportacion.
- Criterios invalidos (`email`, `role`, `status`) reciben 400 sin payload administrativo/exportable.

## 7. Frontera

- Resultado vacio en consulta: HTTP 200 con `items = []`.
- Resultado vacio en exportacion: HTTP 200 con archivo JSON `[]`.
- Cuenta con multiples roles.
- `SUPER_ADMINISTRATOR` filtrable como rol.
- Combinacion de filtros por AND.
- Lista de un solo usuario.
- Caracteres JSON seguros cubiertos por `JSON.stringify` y parseo del archivo.

## 8. Resultados especificos

| Comando                                                                                            | Resultado               |
| -------------------------------------------------------------------------------------------------- | ----------------------- |
| `npm run test:unit -- --runTestsByPath test/unit/admin-account-query.spec.ts`                      | PASS: 1 suite, 23 tests |
| `npm run test:unit -- --runTestsByPath test/unit/admin-account-export.spec.ts`                     | PASS: 1 suite, 7 tests  |
| `npm run test:integration -- --runTestsByPath test/integration/admin-accounts-http.spec.ts`        | PASS: 1 suite, 9 tests  |
| `npm run test:integration -- --runTestsByPath test/integration/admin-accounts-export-http.spec.ts` | PASS: 1 suite, 13 tests |

## 9. Cobertura

La cobertura global se verifico con `npm run test:coverage`. El umbral minimo
del proyecto permanece en 80% para statements, branches, functions y lines.

| Metrica    | Resultado    |
| ---------- | ------------ |
| Statements | PASS: 91.63% |
| Branches   | PASS: 84.34% |
| Functions  | PASS: 89%    |
| Lines      | PASS: 91.27% |

Gate completo:

| Comando                    | Resultado                                  |
| -------------------------- | ------------------------------------------ |
| `npm run format:check`     | PASS                                       |
| `npm run lint`             | PASS                                       |
| `npm run typecheck`        | PASS                                       |
| `npm run test:unit`        | PASS: 18 suites, 304 tests                 |
| `npm run test:integration` | PASS: 6 suites, 89 tests                   |
| `npm run test`             | PASS: 24 suites, 393 tests                 |
| `npm run test:coverage`    | PASS: 24 suites, 393 tests                 |
| `npm run test:db`          | PASS con Docker elevado: 1 suite, 28 tests |
| `npm run build`            | PASS                                       |
| `git diff --check`         | PASS                                       |

## 10. DB

La persistencia PostgreSQL se verifica con el setup Testcontainers existente en
`test/db/postgres-account-repository.spec.ts`.

No se crea un segundo contenedor manual desde tests.

Cobertura DB incluida:

- paridad InMemory/PostgreSQL para filtros administrativos soportados;
- exportacion desde PostgreSQL usando el mismo resultado de `ListAdminAccounts`;
- comparacion antes/despues de `accounts` y `account_roles` para no mutacion.

Resultado DB:

- intento normal: FAIL por runtime Docker no disponible para Testcontainers en
  el contexto de permisos local;
- diagnostico: Docker CLI/Server 29.4.0 responde con acceso elevado en
  `desktop-linux`;
- ejecucion elevada: PASS, 1 suite, 28 tests;
- cobertura DB: statements 96.22%, branches 82.5%, functions 100%, lines
  96.11%.

## 11. Exportacion

Formato tecnico: JSON.

JSON no se declara como regla funcional nueva de RF-44. Se usa porque la HU no
impone CSV, XLSX, PDF ni otro formato concreto.

Archivo:

- `Content-Type`: `application/json; charset=utf-8`
- `Content-Disposition`: `attachment; filename="nexus-battles-users.json"`
- cuerpo: arreglo JSON de usuarios administrativos

Campos incluidos:

- `id`
- `email`
- `displayName`
- `firstNames`
- `lastNames`
- `status`
- `roles`
- `registeredAt`

Campos excluidos:

- `subject`
- `password`
- tokens
- claims completos
- MFA secrets
- security answers
- datos internos de Cognito

## 12. Autorizacion

Operaciones verificadas:

- `GET /api/accounts`
- `GET /api/accounts/export`

Resultado esperado y cubierto:

| Actor                 | Resultado |
| --------------------- | --------- |
| `ADMINISTRATOR`       | 200       |
| `SUPER_ADMINISTRATOR` | 200       |
| `MODERATOR`           | 403       |
| `PLAYER`              | 403       |
| anonimo               | 401       |

En respuestas 401/403 no se devuelve `items`, `statusCounts`,
`Content-Disposition` de archivo ni identificadores de cuentas del dataset.

## 13. Blockers

| Elemento               | Estado            | Motivo                                                                                         |
| ---------------------- | ----------------- | ---------------------------------------------------------------------------------------------- |
| `BANNED`               | BLOCKED           | No existe en `AccountStatus`; no se debe inventar `banned: 0`.                                 |
| Historial de sanciones | BLOCKED BY HU-42  | Account no tiene contrato integrado para sanciones.                                            |
| Filtro por fecha       | SPECIFICATION GAP | `registeredAt` existe como dato exportable/listable, pero no hay semantica aprobada de filtro. |
| Evidencia visual       | BLOCKED           | Account no es frontend. Depende de HU-44.3 / Nexus-Battle-Web / validacion de diseno.          |

## 14. Evidencia visual

EVIDENCIA VISUAL: pendiente de HU-44.3 / Nexus-Battle-Web / validacion del
diseno.

No se inventan capturas de UI, HTML ficticio ni implementacion Web dentro de
Account. Las capturas o salidas de terminal son evidencia tecnica, pero no
sustituyen la evidencia visual del panel.

## 15. Comandos reproducibles

```bash
git branch --show-current
git status -sb
git log -3 --oneline
git stash list

npm run test:unit -- --runTestsByPath test/unit/admin-account-query.spec.ts
npm run test:unit -- --runTestsByPath test/unit/admin-account-export.spec.ts
npm run test:integration -- --runTestsByPath test/integration/admin-accounts-http.spec.ts
npm run test:integration -- --runTestsByPath test/integration/admin-accounts-export-http.spec.ts

npm run format:check
npm run lint
npm run typecheck
npm run test:unit
npm run test:integration
npm run test
npm run test:coverage
npm run test:db
npm run build

git diff --check
git status --short
```

## 16. Conclusion

Incremento actualmente implementable de HU-44 verificado en Account.

Estado recomendado para HU-44.5: VERIFICACION TECNICA COMPLETA DEL ALCANCE
DISPONIBLE, PADRE AUN PARCIAL.

No se debe declarar HU-44 completa mientras sigan pendientes `BANNED`,
historial de sanciones, filtro por fecha y evidencia visual real del panel.
