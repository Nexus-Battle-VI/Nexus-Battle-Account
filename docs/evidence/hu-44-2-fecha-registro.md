# HU-44.2 — Soporte de fecha de registro

Fecha de auditoría: 2026-09-05.

Refs Nexus-Battle-VI/Nexus-Battle-Management#38

Refs Nexus-Battle-VI/Nexus-Battle-Management#120

## Alcance y base auditada

Se verifica exclusivamente el soporte existente de fecha de registro. No se declara
terminada HU-44 ni la totalidad de HU-44.2.

- Account: rama `test/hu-44-2-fecha-registro-evidencia`, inicialmente limpia.
- `HEAD`, `develop` y `origin/develop` locales: `59d1f0e4e5b4a08890e12142decf64d88f64e81d`.
- El conector GitHub confirmó el mismo SHA para `develop` remoto. La comprobación
  inicial con `git ls-remote` no tuvo conectividad desde el sandbox.
- Web inspeccionada sin cambios: `Nexus-Battle-Web`, rama `develop`, SHA
  `f873f0364af73c7dacb7b20555f85d9e281ee9e1`, árbol limpio.
- Entorno: Node `24.18.0`, npm `11.16.0`, Docker Server `29.4.0`.

Se consultaron la [HU padre #38](https://github.com/Nexus-Battle-VI/Nexus-Battle-Management/issues/38),
la [Task #120](https://github.com/Nexus-Battle-VI/Nexus-Battle-Management/issues/120)
y su comentario de evidencia. CA-03 exige filtro por fecha, pero no especifica
modalidad, límites, zona horaria ni interpretación por día. El comentario no añade
una decisión funcional al respecto. Se conserva ese pendiente.

## Recorrido exacto y archivos revisados

Rutas relativas a Account salvo las marcadas Web:

| Superficie   | Archivo                                                               | Evidencia del comportamiento existente                                                                                                                                                               |
| ------------ | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Persistencia | `src/adapters/outbound/persistence/migrations/001-accounts.ts`        | `accounts.created_at`: `timestamptz NOT NULL DEFAULT now()`.                                                                                                                                         |
| Esquema      | `src/adapters/outbound/persistence/schema.ts`                         | `created_at: Generated<Date>`.                                                                                                                                                                       |
| PostgreSQL   | `src/adapters/outbound/persistence/PostgresAccountRepository.ts`      | `query` selecciona `account.created_at as created_at`; proyecta `registeredAt: row.created_at.toISOString()`. `persistAccount` no reemplaza `created_at` en el UPSERT; actualiza `updated_at`.       |
| InMemory     | `src/adapters/outbound/persistence/InMemoryAccountRepository.ts`      | Copia el reloj con `new Date(this.now().getTime())`; conserva `createdAt: metadata?.createdAt ?? current`; expone `createdAt.toISOString()`.                                                         |
| DTO          | `src/application/dto/AdminAccountSummaryDto.ts`                       | `readonly registeredAt: string`.                                                                                                                                                                     |
| Consulta     | `src/application/use-cases/ListAdminAccounts.ts`                      | Clona el resumen sin recalcular la fecha.                                                                                                                                                            |
| Criterios    | `src/application/dto/AdminAccountQueryCriteria.ts`                    | Solo ID, correo, nombres, apellidos, displayName, rol y estado; ningún criterio temporal.                                                                                                            |
| HTTP         | `src/adapters/inbound/http/accounts.dto.ts`, `accounts.controller.ts` | Respuesta administrativa con `registeredAt`; `GET /api/accounts` devuelve el caso de uso y `GET /api/accounts/export` entrega el contenido del archivo. Ambos conservan autorización administrativa. |
| Exportación  | `src/adapters/outbound/export/JsonAdminAccountExportAdapter.ts`       | Asigna `registeredAt: account.registeredAt` y serializa con `JSON.stringify`; conserva exactamente el string.                                                                                        |
| Web          | `src/features/account/admin-users/api.ts`                             | Recibe `registeredAt: string`; el constructor de query no envía fechas.                                                                                                                              |
| Web          | `src/features/account/admin-users/AdminUsersSection.tsx`              | Presenta `<time dateTime={account.registeredAt}>{formatDateTime(account.registeredAt)}</time>`; el selector «Fecha de registro» sigue `disabled`.                                                    |
| Web          | `src/lib/format.ts`                                                   | Formateador de presentación existente; no se cambia ni se adopta como semántica del filtro.                                                                                                          |

También se revisaron `AGENTS.md`, `package.json`, `jest.config.ts`, `jest.db.config.ts`,
`test/db/postgres-runtime.ts` y la evidencia histórica
[`hu-44-5-panel-usuarios.md`](hu-44-5-panel-usuarios.md).

La fecha verificada es la de creación persistida de la fila: PostgreSQL la asigna
en la inserción e InMemory en el primer guardado. No se añade al agregado ni se
reinterpreta como hora de un evento de dominio. La serialización existente es ISO
con milisegundos y sufijo `Z`; esto no define una zona de negocio para filtrar días.
La prueba DB compara el valor recuperado por el driver, sin prometer preservación
de microsegundos de PostgreSQL en un `Date` de JavaScript.

## Pruebas existentes reutilizadas

| Archivo                                                            | Comprobación reutilizada                                                                                                                                           |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `test/unit/admin-account-query.spec.ts`                            | Fecha conocida `2026-08-01T10:00:00.000Z`, listado y consultas sin mutar resúmenes ni roles.                                                                       |
| `test/unit/admin-account-export.spec.ts`                           | Valor ISO exacto exportado, igualdad con listado filtrado, campos aprobados y ausencia de mutación.                                                                |
| `test/integration/admin-accounts-http.spec.ts`                     | GET administrativo real, presencia de `registeredAt`, autorización y consultas.                                                                                    |
| `test/integration/admin-accounts-export-http.spec.ts`              | Igualdad completa listado/exportación, orden, filtros existentes, controles 401/403 y campos exportados.                                                           |
| `test/db/postgres-account-repository.spec.ts`                      | Paridad completa PostgreSQL/InMemory con fechas sembradas; exportación igual al listado; comparación antes/después de cuentas, `created_at`, `updated_at` y roles. |
| Web: `src/features/account/admin-users/AdminUsersSection.test.tsx` | Renderizado del panel con fechas recibidas y selector de fecha deshabilitado.                                                                                      |
| Web: `src/features/account/admin-users/api.test.ts`                | Queries únicamente con criterios soportados y los mismos criterios para exportar.                                                                                  |

## Pruebas añadidas: solo huecos de verificación

1. **InMemory, dos casos parametrizados** (`save` y `saveRegistration`) en
   `test/unit/admin-account-query.spec.ts`: conserva la fecha inicial al mutar la
   referencia del reloj, actualizar el apodo, guardar nuevamente y volver a
   consultar. También comprueba el snapshot tras las consultas.
2. **PostgreSQL real, dos casos parametrizados** (`save` y `saveRegistration`) en
   `test/db/postgres-account-repository.spec.ts`: inserción sin sembrar ni editar
   `created_at`; se comprueba que cae entre dos lecturas del reloj del motor.
   Tras actualizar la cuenta y crear otra instancia del repositorio, el listado
   entrega exactamente `inserted.created_at.toISOString()`, la exportación coincide
   y la fila completa permanece igual después de consultar/exportar.
3. **HTTP, un caso** en `test/integration/admin-accounts-export-http.spec.ts`:
   registra mediante el repositorio real del AppModule en
   `2026-08-01T10:23:45.678Z`, actualiza con el reloj avanzado y exige ese string
   exacto en GET y exportación. Repite GET y compara el snapshot. El reloj falso
   se limita al guardado InMemory y se restaura antes de HTTP; se reutiliza el
   stub de verificación de identidad de la suite, sin cambiar seguridad productiva.

Son cinco casos nuevos en tres archivos de pruebas. No se modifica código
productivo ni se añaden dependencias. Estas pruebas verifican una implementación
que ya existía: no se provocó un RED artificial ni se afirma haber desarrollado
una funcionalidad nueva. La primera ejecución DB detectó una colisión entre los
apodos de los dos fixtures nuevos; se corrigió su unicidad, sin cambiar el producto.

## Implementado y verificado

- Persistencia de fecha de registro y conservación tras actualizaciones.
- Exposición administrativa `created_at` → `registeredAt`, ISO consistente en HTTP.
- Presentación en Web: consumo y renderizado del dato comprobados por inspección
  del componente y ejecución de las pruebas existentes. No constituye una nueva
  validación visual en navegador ni una prueba end-to-end Web/PostgreSQL.
- Exportación: conserva el mismo valor que el listado y no modifica la fecha.

## Pendiente de refinement: decisión del PO/equipo

**Ninguna opción está aprobada ni aplicada.**

| Opción                           | Utilidad posible                                          | Decisiones que faltan                                                                                    |
| -------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| A. Fecha exacta de calendario    | Localizar altas de un día concreto.                       | Qué calendario/zona define el día y cómo se delimitan sus instantes.                                     |
| B. Rango desde/hasta             | Consultar periodos y cohortes para gestión y exportación. | Tipo de entrada, obligatoriedad de extremos, límites, orden inválido y zona si son fechas de calendario. |
| C. Registrado desde una fecha    | Consultar altas recientes a partir de un punto.           | Fecha o instante, inclusión del límite y zona/interpretación aplicable.                                  |
| D. Registrado antes de una fecha | Consultar cuentas anteriores a un punto.                  | Fecha o instante, inclusión del límite y zona/interpretación aplicable.                                  |

**Recomendación técnica para discutir: B**, por permitir delimitar periodos de
gestión y reutilizar el mismo criterio en listado y exportación. C y D ofrecen una
interfaz más simple si solo interesa un extremo. B necesita más decisiones y
pruebas; no se presupone que permita extremos opcionales ni que englobe A, C o D.
Esto es una evaluación del diseño existente, no un requisito incorporado a RF-44.

El PO/equipo debe seleccionar la modalidad y resolver las decisiones asociadas
antes de definir el contrato HTTP o habilitar el control. Después corresponderá
derivar ejemplos positivos, negativos y de frontera y verificar paridad entre
repositorios, listado y exportación.

No se añaden rango, fecha exacta, from/to, before/after, reglas de inclusión,
conversión de zona ni interpretación por día calendario. No se modifica
`AdminAccountQueryCriteria`, no se agregan query params y no se cambia la Web.

Los pendientes generales de HU-44/HU-44.2 sobre `BANNED`, sanciones/HU-42 y aceptación
funcional permanecen fuera de este incremento; este documento no los declara resueltos.

## Quality gates de esta ejecución

Todos los comandos siguientes terminaron con código 0:

| Comando                 | Resultado                                                             |
| ----------------------- | --------------------------------------------------------------------- |
| `npm run format`        | PASS; únicamente pruebas nuevas y esta evidencia necesitaron formato. |
| `npm run format:check`  | PASS.                                                                 |
| `npm run lint`          | PASS.                                                                 |
| `npm run typecheck`     | PASS.                                                                 |
| `npm run test`          | PASS: 49 suites, 677 pruebas.                                         |
| `npm run test:coverage` | PASS: 49 suites, 677 pruebas; umbrales sin cambios.                   |
| `npm run build`         | PASS.                                                                 |
| `git diff --check`      | PASS.                                                                 |
| `npm run test:db`       | PASS: 5 suites, 65 pruebas, PostgreSQL real con Testcontainers.       |

Docker Desktop estaba instalado pero detenido. Se inició en segundo plano y se
ejecutó `test:db` fuera del sandbox para acceder al motor. No se instalaron paquetes
ni se reemplazó el runtime de pruebas del repositorio.

| Cobertura | Statements | Branches | Functions | Lines  |
| --------- | ---------- | -------- | --------- | ------ |
| General   | 91.89%     | 84.68%   | 88.09%    | 91.57% |
| DB        | 95.73%     | 89.06%   | 96.07%    | 96.22% |

Ejecuciones focalizadas adicionales:

- Antes de editar: 30 pruebas unitarias existentes de consulta/exportación, PASS.
- Después de añadir verificaciones: 4 suites de consulta/exportación unitarias y
  HTTP, 55 pruebas, PASS.
- En `Nexus-Battle-Web`: `npm run test -- src/features/account/admin-users/AdminUsersSection.test.tsx src/features/account/admin-users/api.test.ts`,
  2 archivos, 14 pruebas existentes, PASS. No se ejecutaron todos los gates Web,
  porque no se modificó ese repositorio.

## Veredicto y estado Git

**A. SOPORTE DE FECHA DE REGISTRO COMPLETAMENTE VERIFICADO; FILTRO BLOQUEADO SOLO POR SEMÁNTICA.**

Este veredicto se limita al soporte de fecha dentro del alcance solicitado y a
los niveles de verificación descritos arriba. No declara Done la Task completa
ni la HU padre, ni resuelve sus otras dependencias funcionales.

Estado del árbol al cierre de esta verificación:

```text
## test/hu-44-2-fecha-registro-evidencia
 M test/db/postgres-account-repository.spec.ts
 M test/integration/admin-accounts-export-http.spec.ts
 M test/unit/admin-account-query.spec.ts
?? docs/evidence/hu-44-2-fecha-registro.md
```

Sin cambios productivos ni Web. Sin staging, commit, push, PR ni merge.
