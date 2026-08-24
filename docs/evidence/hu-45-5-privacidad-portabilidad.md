# HU-45.5 — Evidencia de consulta, portabilidad y protección

Historia:
HU-45 / RF-45

Task:
HU-45.5 / #140

Branch:
test/hu-45-5-privacidad-portabilidad

Commit base evaluado:
ecea8f9

Ambiente:

- Node: v24.18.0
- npm: 11.16.0
- Fecha de evaluación: 2026-08-24

## Alcance evaluado

Disponible:

- consulta propia en Application mediante `GetOwnPersonalData`;
- minimización a `email` y `displayName`;
- aislamiento de titular desde `principal.accountId`;
- exportación JSON;
- exportación XML;
- integración técnica `consulta -> DTO autorizado -> JSON/XML`;
- ausencia de mutación sobre las cuentas durante consulta/exportación.

No disponible:

- autenticación real HU-02;
- HTTP seguro;
- descarga real;
- reporte PDF;
- frontend;
- E2E visual.

## Matriz de trazabilidad

| CA    | Requisito                 | Evidencia automatizada                                                                                    | Nivel                        | Estado  | Brecha                                                 |
| ----- | ------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------- | ------- | ------------------------------------------------------ |
| CA-01 | Consulta de datos propios | `test/unit/privacy-personal-data.spec.ts`, `test/integration/privacy-personal-data-export.spec.ts`        | Application / integration    | PARTIAL | Falta HU-02 y HTTP autenticado                         |
| CA-02 | Exportación JSON          | `test/unit/privacy-personal-data-export.spec.ts`, `test/integration/privacy-personal-data-export.spec.ts` | Application / adapter / flow | PARTIAL | Falta request autenticado y descarga HTTP              |
| CA-03 | Exportación XML           | `test/unit/privacy-personal-data-export.spec.ts`, `test/integration/privacy-personal-data-export.spec.ts` | Application / adapter / flow | PARTIAL | Falta request autenticado y descarga HTTP              |
| CA-04 | Reporte PDF               | Sin evidencia automatizada disponible                                                                     | N/A                          | BLOCKED | HU-45.3, generador PDF, fuentes externas y HTTP faltan |
| CA-05 | Protección de titularidad | `test/unit/privacy-personal-data.spec.ts`, `test/integration/privacy-personal-data-export.spec.ts`        | Application / integration    | PARTIAL | Falta identidad real HU-02, manipulación HTTP y E2E    |

## CA-01 - Consulta de datos propios

Evidencia:

- `test/unit/privacy-personal-data.spec.ts`;
- `test/integration/privacy-personal-data-export.spec.ts`.

Cubierto en núcleo:

- titular propio;
- principal ausente;
- `accountId` inválido;
- cuenta inexistente;
- minimización;
- dos titulares;
- no mutación;
- errores inesperados del repositorio se propagan.

Brecha:

- HU-02 / HTTP autenticado.

Estado global: PARTIAL.

## CA-02 - Exportación JSON

Evidencia:

- `test/unit/privacy-personal-data-export.spec.ts`;
- `test/integration/privacy-personal-data-export.spec.ts`.

Cubierto en núcleo:

- JSON válido;
- whitelist `email` y `displayName`;
- UTF-8 mediante `application/json; charset=utf-8`;
- filename `personal-data.json`;
- mediaType exacto;
- propiedad runtime extra excluida;
- caracteres especiales preservados semánticamente con `JSON.parse`;
- no mutación;
- datos del mismo titular en el flujo técnico integrado.

Brecha:

- request autenticado y descarga HTTP.

Estado global: PARTIAL.

## CA-03 - Exportación XML

Evidencia:

- `test/unit/privacy-personal-data-export.spec.ts`;
- `test/integration/privacy-personal-data-export.spec.ts`.

Cubierto en núcleo:

- XML estructurado;
- declaración XML;
- root `personalData`;
- tags `email` y `displayName`;
- escaping de contenido;
- whitelist `email` y `displayName`;
- filename `personal-data.xml`;
- mediaType `application/xml; charset=utf-8`;
- datos del mismo titular en el flujo técnico integrado;
- no mutación.

Brecha:

- request autenticado y descarga HTTP.

Estado global: PARTIAL.

## CA-04 - Reporte PDF

Estado: BLOCKED.

Bloqueos:

- HU-45.3 no implementada;
- no hay generador PDF real;
- no hay librería PDF aprobada;
- estadísticas concretas no están definidas;
- contrato privacy definitivo de comentarios pendiente;
- Commerce expone orders, pero no se ha aprobado que orders equivalga exactamente a "historial de transacciones" de RF-45;
- no hay descarga PDF HTTP.

No se creó prueba fake ni archivo PDF simulado.

## Evidencia de fuentes del PDF

Inventory:

- servicio Player/Inventory disponible;
- posee API y DTO de inventario;
- contrato privacy cross-service específico todavía no definido.

Statistics:

- HU-06 mantiene pendientes las métricas concretas;
- no se deben inventar métricas.

Comments:

- Community dispone de Thread/Post;
- falta contrato privacy específico por titular;
- la política respecto a mensajes ocultos debe decidirse formalmente.

Transactions:

- Commerce dispone de Orders por `customerId`;
- el servicio no procesa pagos;
- no se debe asumir que `OrderDto` equivale automáticamente a historial de transacciones de RF-45.

No se copiaron DTOs completos de otros servicios como contrato final de privacidad.

## CA-05 - Protección de titularidad

Estado: PARTIAL.

Cubierto en Application:

- única fuente `principal.accountId`;
- no existe `requestedAccountId` en el caso de uso;
- propiedad runtime manipulable ignorada en unit;
- dos titulares aislados;
- exportadores no seleccionan usuarios;
- integración `principal A -> datos A -> JSON A -> XML A`;
- no aparecen datos B.

Brecha:

- identidad real HU-02;
- manipulación HTTP;
- E2E.

## Resultados de ejecución

Integración técnica inicial:

```text
npx jest --selectProjects integration --runTestsByPath test/integration/privacy-personal-data-export.spec.ts
Test Suites: 1 passed, 1 total
Tests: 1 passed, 1 total
```

Suite HU-45.1:

```text
npx jest --selectProjects unit --runTestsByPath test/unit/privacy-personal-data.spec.ts
Test Suites: 1 passed, 1 total
Tests: 12 passed, 12 total
```

Suite HU-45.2:

```text
npx jest --selectProjects unit --runTestsByPath test/unit/privacy-personal-data-export.spec.ts
Test Suites: 1 passed, 1 total
Tests: 13 passed, 13 total
```

Suite global:

```text
npm run test:coverage
Test Suites: 7 passed, 7 total
Tests: 120 passed, 120 total
```

## Cobertura

```text
Statements: 99.5% (399/401)
Branches: 92.56% (112/121)
Functions: 100% (100/100)
Lines: 99.47% (380/382)
```

La cobertura no sustituye la aceptación funcional de los CA; solo complementa la evidencia técnica.

## Bloqueos para aceptación completa

- HU-02 autenticación;
- integración HTTP;
- HU-45.3 PDF;
- estadísticas;
- contratos externos;
- EN-011;
- HU-45.4 frontend;
- E2E/descarga.

## Conclusión

El núcleo implementado de consulta propia y exportación JSON/XML se encuentra verificado mediante pruebas unitarias y una integración técnica sin HTTP. HU-45.5 permanece parcialmente completada porque CA-04 y las verificaciones de autenticación, descarga y flujo visual continúan bloqueadas.
