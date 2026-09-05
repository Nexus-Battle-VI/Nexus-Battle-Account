# Evidencia HU-45.5 — Privacidad y portabilidad

## Alcance y fuentes de verdad

Refs Nexus-Battle-VI/Nexus-Battle-Management#140.

Fuentes consultadas el 2026-09-05, incluyendo sus comentarios:

- [HU-45 / RF-45 #39](https://github.com/Nexus-Battle-VI/Nexus-Battle-Management/issues/39): CA-01 a CA-05; el PDF debe incluir información de inventario, estadísticas, comentarios y transacciones. Consultar/exportar no modifica ni elimina datos.
- [HU-45.5 #140](https://github.com/Nexus-Battle-VI/Nexus-Battle-Management/issues/140): verificación, titularidad, comparación de formatos y evidencia reproducible.
- [HU-45.3 #135](https://github.com/Nexus-Battle-VI/Nexus-Battle-Management/issues/135): generación del PDF, cuatro secciones, descarga y fuentes; figura cerrada.
- [RNF-11 / EN-011 #197](https://github.com/Nexus-Battle-VI/Nexus-Battle-Management/issues/197): minimización, ownership y exclusión de secretos. Figura cerrada, pero su [nota de Refinement del 2026-09-03](https://github.com/Nexus-Battle-VI/Nexus-Battle-Management/issues/197#issuecomment-5521776360) advierte pendientes de consentimiento versionado, publicación en runtime y aceptación de ADR-014. Esta verificación de Account no certifica todo EN-011 ni resuelve esa discrepancia documental.

Solo se amplían pruebas y evidencia del comportamiento integrado. No se cambian contratos, requisitos, código de producción, dependencias, umbrales ni configuración de cobertura. No se implementa Statistics. No se declara aceptada ni se cierra HU-45 padre.

## Ambiente y versión

| Elemento                     | Valor                                                                                                                        |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Fecha                        | 2026-09-05, America/Bogota                                                                                                   |
| Repositorio                  | `Nexus-Battle-VI/Nexus-Battle-Account`                                                                                       |
| Directorio                   | `C:\Users\Usuario\Documents\PI2\Nexus-Battle-Account`                                                                        |
| Rama                         | `test/hu-45-5-verificacion-privacidad-final`                                                                                 |
| Base / HEAD antes de cambios | `fae42665cdc8417c228c811d815f297f53f99805`                                                                                   |
| Base verificada              | HEAD, develop local y origin/develop local coinciden; `git ls-remote origin refs/heads/develop` confirmó el mismo SHA remoto |
| Árbol inicial                | Limpio                                                                                                                       |
| SO / shell                   | Windows / PowerShell                                                                                                         |
| Node / npm                   | `v24.18.0` / `11.16.0`                                                                                                       |
| Stack del lockfile           | TypeScript 5.9.3, NestJS 11.2.1, Jest 30.4.2, Supertest 7.2.2                                                                |
| HTTP                         | AppModule real, guards activos con AUTH_MODE=jwt, ValidationPipe real y Supertest                                            |
| Persistencia HTTP            | InMemory existente                                                                                                           |
| Identidad                    | TokenVerifierPort sustituido por el doble existente; no se contacta Cognito ni se afirma validar JWT reales en esta suite    |
| Fuentes PDF                  | Dobles existentes de los tres Ports; fixtures diferenciados por testimonio A/B                                               |
| PDF                          | Renderer PDFKit real; inspección del texto de los bytes descargados                                                          |
| XML                          | Comparación semántica Jest reutilizada y parser System.Xml de .NET para los archivos descargados                             |
| Docker                       | CLI y Server 29.4.0, contexto desktop-linux; Desktop iniciado para test:db                                                   |

El primer acceso a Docker dentro del sandbox no pudo leer su configuración. Fuera del sandbox se confirmó que el daemon aún no estaba iniciado. Tras `docker desktop start`, `docker info --format '{{.ServerVersion}}'` respondió `29.4.0` y la suite DB pudo ejecutarse. Es una condición de ambiente resuelta, independiente de Statistics.

## Auditoría y reutilización

| Alias      | Suite existente                                      | Evidencia reutilizada / refuerzo                                                                                                                                                                |
| ---------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTTP       | `test/integration/account-self-service-http.spec.ts` | Consulta permitida, 401/404, campos exactos, descarga JSON/XML/PDF, aislamiento A/B, selector query y no mutación. Se amplían los casos existentes y se parametrizan formatos/selectores.       |
| OWN        | `test/unit/get-own-personal-data.spec.ts`            | Resolución por subject verificado, exclusión de campos internos, copia de roles, no mutación y titulares distintos. Sin cambios.                                                                |
| PORTABLE   | `test/unit/portable-personal-data-export.spec.ts`    | JSON parseable, versión/fecha, XML escapado, arrays/booleanos, equivalencia semántica y no mutación. Sin cambios.                                                                               |
| PDF-USE    | `test/unit/generate-privacy-pdf-report.spec.ts`      | Agregación, mismo testimonio en las fuentes, identidad inexistente, fuentes no disponibles. Se sustituye la comprobación de claves de los mocks por ejecución y comparación de datos de origen. |
| PDF-RENDER | `test/unit/pdf-kit-privacy-report-renderer.spec.ts`  | Firma/EOF y casos vacíos/no disponibles. Se sustituyen aserciones de tamaño/no excepción por contenido extraído del PDF.                                                                        |
| SOURCES    | `test/unit/privacy-report-adapters.spec.ts`          | Adaptadores HTTP reales con fetch sustituido: contratos vigentes, Bearer propio, paginación de Inventory, falta de configuración, error HTTP y error de red. Sin cambios.                       |

No se crea una segunda suite de privacidad. Las pruebas añadidas caracterizan funcionalidad ya integrada: la primera ejecución de las ampliaciones fue GREEN. No hubo un RED por funcionalidad ausente ni se inventó una modificación de producción para obtenerlo. El hueco detectado era de evidencia: firma/tamaño no demostraban contenido; el último token reenviado no demostraba aislamiento del PDF; la vista pública no demostraba conservación del snapshot completo.

## Matriz RF-45 → CA → caso

Los nombres entre comillas identifican casos o plantillas `it.each` en las suites de la tabla anterior. PASS significa comportamiento técnico verificado en este ambiente, no aceptación integral del producto.

| RF    | CA            | Caso de prueba / archivo                                                                                                                                                                                                  | Esperado                                                                                                          | Obtenido                                                                                                                |
| ----- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| RF-45 | CA-01         | HTTP: «devuelve los datos personales permitidos del titular autenticado»; OWN: «resuelve los datos personales del titular usando el subject verificado»                                                                   | 200, datos exactos de A; búsqueda por identidad verificada                                                        | PASS                                                                                                                    |
| RF-45 | CA-01         | HTTP: «responde 401 sin testimonio» en consulta; «rechaza un testimonio inválido en %s sin exponer datos»                                                                                                                 | 401 sin datos personales                                                                                          | PASS                                                                                                                    |
| RF-45 | CA-01 / CA-05 | HTTP: «no utiliza %s en query como selector de otro titular»; «no existe una ruta de privacidad de otro accountId (%s)»                                                                                                   | Query accountId/customerId/subject no selecciona B; rutas de privacidad por ID devuelven 404                      | PASS: consulta ignora query y devuelve A; no se exige 400 donde el contrato no lo define                                |
| RF-45 | CA-01         | HTTP: «consultar no cambia snapshots ni respuestas de seguridad de ningún titular»; OWN: «no muta la cuenta consultada», «devuelve una copia de roles que no comparte arreglo con la cuenta»                              | Snapshots completos y respuestas de seguridad iguales antes/después; sin alias mutable de roles                   | PASS                                                                                                                    |
| RF-45 | CA-02         | HTTP: «descarga JSON canónico del titular autenticado»; PORTABLE: «genera JSON descargable, parseable y sin campos prohibidos»                                                                                            | 200, application/json, attachment, JSON parseable, schemaVersion/generatedAt/personalData exactos                 | PASS                                                                                                                    |
| RF-45 | CA-02 / CA-05 | HTTP: «resuelve exportaciones %s diferentes exclusivamente desde cada subject verificado», formato json                                                                                                                   | A solo contiene correo A, B solo correo B                                                                         | PASS                                                                                                                    |
| RF-45 | CA-02         | HTTP: «no muta snapshots ni respuestas de seguridad al exportar %s», json; PORTABLE: «no muta el objeto canónico al serializar ambos formatos»                                                                            | Conservación de datos almacenados y objeto serializado                                                            | PASS                                                                                                                    |
| RF-45 | CA-03         | HTTP: «descarga XML equivalente con UTF-8 y datos escapados»; PORTABLE: «genera XML UTF-8 con atributos, arrays, booleanos y escape seguro»; script `verify-hu-45-5-exports.ps1`                                          | attachment XML, UTF-8, XML bien formado con parser, caracteres escapados                                          | PASS para los archivos A/B y fixtures unitarios                                                                         |
| RF-45 | CA-03         | PORTABLE: «representa en JSON y XML exactamente la misma semántica personal»; script XML sobre archivos HTTP A/B                                                                                                          | Igual versión, fecha, campos, valores, roles y consentimiento                                                     | PASS                                                                                                                    |
| RF-45 | CA-03 / CA-05 | HTTP: «resuelve exportaciones %s diferentes exclusivamente desde cada subject verificado», xml                                                                                                                            | Titular propio en cada XML, ausencia del otro                                                                     | PASS                                                                                                                    |
| RF-45 | CA-03         | HTTP: «no muta snapshots ni respuestas de seguridad al exportar %s», xml                                                                                                                                                  | Snapshots y respuestas de seguridad intactos                                                                      | PASS                                                                                                                    |
| RF-45 | CA-04         | HTTP: «descarga un PDF real (ya no 503): identidad + inventario + comentarios + transacciones»; PDF-RENDER: «produce un PDF valido (firma %PDF, EOF, tamano no trivial)»                                                  | 200, application/pdf, attachment, bytes PDF y contenido del titular                                               | PASS técnico                                                                                                            |
| RF-45 | CA-04         | Mismo caso HTTP y PDF-RENDER: «escribe identidad y contenido de las fuentes, con Statistics explícitamente no disponible»                                                                                                 | Inventario y su contenido                                                                                         | PASS: Espada de Hierro / cantidad 1 en HTTP                                                                             |
| RF-45 | CA-04         | Mismos casos HTTP y PDF-RENDER                                                                                                                                                                                            | Comentarios y su contenido                                                                                        | PASS: Buen combate en HTTP                                                                                              |
| RF-45 | CA-04         | Mismos casos HTTP y PDF-RENDER                                                                                                                                                                                            | Historial de transacciones y su contenido                                                                         | PASS: ord-1 / CONFIRMED / 30000 COP / 2 artículos en HTTP                                                               |
| RF-45 | CA-04         | Mismos casos HTTP y PDF-RENDER; igualdad exacta del texto entre Estadísticas y Comentarios                                                                                                                                | Sección Estadísticas presente; únicamente aviso explícito si no hay fuente, sin valores inventados                | PASS técnico: «Sección no disponible: todavía no existe una fuente de datos de estadísticas del jugador en el sistema.» |
| RF-45 | CA-04         | Información real de Statistics requerida por #39                                                                                                                                                                          | Estadísticas reales del titular obtenidas desde fuente backend aprobada                                           | **BLOCKED funcional: no existe esa fuente. CA-04 no está completamente aceptado.**                                      |
| RF-45 | CA-04         | PDF-RENDER: casos «secciones externas no estan disponibles» y «secciones estan disponibles pero vacias (sin registros)»; PDF-USE: casos de fuentes no disponibles                                                         | Diferenciar vacío confirmado de fuente no disponible; conservar las demás secciones                               | PASS: textos distintos comprobados dentro del PDF                                                                       |
| RF-45 | CA-04         | HTTP: «no muta la cuenta al generar el PDF»; PDF-USE: «no altera los datos de origen al ejecutar la generación»                                                                                                           | Snapshots, respuestas de seguridad y datasets de los Ports sin cambios                                            | PASS en Account y fixtures; no certifica almacenamiento remoto                                                          |
| RF-45 | CA-05         | HTTP: «resuelve siempre la cuenta del subject del JWT y mantiene aislamiento A/B», exportaciones json/xml y «resuelve el reporte exclusivamente desde el subject verificado, nunca de un identificador del titular ajeno» | Dos identidades reciben solo sus datos; PDF comprueba identidad, inventario, comentarios y pedidos propios/ajenos | PASS técnico A/B                                                                                                        |
| RF-45 | CA-05         | HTTP: «rechaza el selector $selector en exportación $format»                                                                                                                                                              | accountId, ownerId, customerId, subject, userId en query: 400 para json/xml/pdf; sin attachment ni datos de B     | PASS, 15 combinaciones                                                                                                  |
| RF-45 | CA-05         | HTTP: «ignora selectores de body y headers en %s»                                                                                                                                                                         | accountId/customerId/subject no tienen autoridad; consulta y tres exportaciones siguen devolviendo A              | PASS, 4 rutas                                                                                                           |
| RF-45 | CA-05         | HTTP: casos 401, testimonio inválido y cuenta local inexistente; PDF-USE: error de resolución antes de consultar fuentes                                                                                                  | Fail-closed, sin archivo/datos ajenos; sin consultar fuentes si no hay cuenta                                     | PASS                                                                                                                    |
| RF-45 | CA-05         | PDF-USE / HTTP: reenvío del testimonio; SOURCES: «recupera … reenviando el testimonio del titular»                                                                                                                        | Mismo Bearer en los contratos existentes; sin selector de titular construido por Account                          | PASS con dobles en la frontera remota                                                                                   |

## Datos y archivos reproducibles

Todos los datos son sintéticos. El alta de fixtures usa `registerAccountRequest`; A y B tienen identidad diferenciada. El reloj de exportación está fijado a `2026-09-02T18:45:30.000Z`.

| Titular | Correo / apodo                     | Inventario           | Comentario                      | Transacción                                  |
| ------- | ---------------------------------- | -------------------- | ------------------------------- | -------------------------------------------- |
| A       | ana@nexus.test / Ana Ramirez       | Espada de Hierro, 1  | Buen combate                    | ord-1, CONFIRMED, 30000 COP, 2 artículos     |
| B       | beatriz@nexus.test / Beatriz Lopez | Escudo de Beatriz, 7 | Comentario exclusivo de Beatriz | ord-beatriz, CONFIRMED, 7000 COP, 1 artículo |

Los nombres personales adicionales proceden del fixture de registro existente; no se inventan campos de privacidad. El contrato consultado/exportado contiene únicamente `email`, `displayName`, `firstNames`, `lastNames`, `roles`, `termsAccepted`. JSON añade `schemaVersion`, `generatedAt` y `personalData`. XML representa el mismo contenido. Los campos internos y secretos quedan fuera; no se guardan tokens en los artefactos.

La opción `HU45_WRITE_EVIDENCE=1` conserva los archivos descargados por Supertest en `.tmp/hu-45-5`: `ana.json`, `ana.xml`, `ana.pdf`, `beatriz.json`, `beatriz.xml`, `beatriz.pdf`. Es un directorio local ignorado por Git. No son ejemplos escritos a mano: son cuerpos de respuesta del AppModule bajo los fixtures descritos.

```powershell
$env:HU45_WRITE_EVIDENCE = '1'
npm run test -- --runInBand --runTestsByPath test/integration/account-self-service-http.spec.ts test/unit/get-own-personal-data.spec.ts test/unit/portable-personal-data-export.spec.ts test/unit/generate-privacy-pdf-report.spec.ts test/unit/pdf-kit-privacy-report-renderer.spec.ts test/unit/privacy-report-adapters.spec.ts
Remove-Item Env:HU45_WRITE_EVIDENCE
powershell -NoProfile -ExecutionPolicy Bypass -File docs/evidence/verify-hu-45-5-exports.ps1
```

El script usa System.Xml con DTD prohibido y resolución externa deshabilitada. Falla si el XML no está bien formado o difiere del JSON en titular, campos o semántica. Resultado obtenido: `PASS ana` y `PASS beatriz`.

`privacyPdfText` inspecciona operadores TJ de streams comprimidos de PDFKit con fuente estándar WinAnsi. No es un parser PDF general, no verifica visualmente el diseño ni sustituye abrir el PDF en un visor. Las aserciones verifican el contenido realmente serializado, no llamadas al renderer ni solo longitud del archivo.

## Ejecución y calidad

| Comando                                                                                                   | Resultado obtenido                                                                                      | Código de salida |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------- |
| Suite dirigida inicial: seis archivos de la auditoría, `npm run test -- --runInBand --runTestsByPath ...` | 6 suites, 94 pruebas, todas PASS; 53.349 s                                                              | 0                |
| Tres suites modificadas, con HU45_WRITE_EVIDENCE=1                                                        | 3 suites, 95 pruebas, todas PASS; 19.935 s; seis archivos generados                                     | 0                |
| `npm run format`                                                                                          | Prettier aplicado; sin cambios ajenos al alcance                                                        | 0                |
| `npm run format:check`                                                                                    | All matched files use Prettier code style                                                               | 0                |
| `npm run lint`                                                                                            | Sin errores                                                                                             | 0                |
| `npm run typecheck`                                                                                       | Sin errores                                                                                             | 0                |
| `npm run test`                                                                                            | 49 suites, 674 pruebas, todas PASS; 48.967 s; advertencia de cierre de worker                           | 0                |
| `npm run test:coverage`                                                                                   | 49 suites, 674 pruebas, todas PASS; 91.435 s; umbrales satisfechos                                      | 0                |
| `npm run test -- --runInBand --detectOpenHandles`                                                         | 49 suites, 674 pruebas, todas PASS; 119.093 s; sin advertencia de worker ni reporte de handles abiertos | 0                |
| `npm run build`                                                                                           | Nest build correcto                                                                                     | 0                |
| `npm run test:db`                                                                                         | 5 suites, 63 pruebas, todas PASS; 38.902 s; Docker/Testcontainers                                       | 0                |
| `verify-hu-45-5-exports.ps1`                                                                              | JSON parseable y XML bien formado/equivalente para ana y beatriz                                        | 0                |
| `git diff --check`                                                                                        | Sin errores de whitespace                                                                               | 0                |

La ampliación añade **28 casos HTTP netos** y refuerza aserciones existentes de PDF e inmutabilidad, sin aumentar el número de suites. La ejecución inicial de `npm run test` avisó: `A worker process has failed to exit gracefully and has been force exited`. La ejecución posterior de cobertura no repitió esa advertencia. El diagnóstico con `--runInBand --detectOpenHandles` terminó con 674 pruebas correctas y sin reporte de handles abiertos. No se reprodujo la advertencia en esas ejecuciones; no se atribuye una causa que no se haya demostrado ni se modifica código ajeno para eliminarla.

| Cobertura | Statements         | Branches         | Functions        | Lines              |
| --------- | ------------------ | ---------------- | ---------------- | ------------------ |
| Global    | 91.89% (2358/2566) | 84.68% (835/986) | 88.09% (444/504) | 91.57% (2249/2456) |
| DB        | 95.73% (157/164)   | 87.50% (56/64)   | 96.07% (49/51)   | 96.22% (153/159)   |

Se conservan las exclusiones y umbrales existentes. El porcentaje global no incluye las implementaciones PostgreSQL que el repositorio mide por separado con `test:db`. La suite DB es la existente; no se presenta como una nueva prueba HTTP de privacidad con PostgreSQL.

Comandos completos de calidad:

```powershell
npm run format
npm run format:check
npm run lint
npm run typecheck
npm run test
npm run test:coverage
npm run build
git diff --check
npm run test:db
git status --short
git diff --stat
git diff --check
```

Archivos del incremento:

- Modificados: `test/integration/account-self-service-http.spec.ts`, `test/unit/generate-privacy-pdf-report.spec.ts`, `test/unit/pdf-kit-privacy-report-renderer.spec.ts`.
- Nuevos: `test/support/privacy-export-evidence.ts`, este documento y `docs/evidence/verify-hu-45-5-exports.ps1`.
- Evidencia local ignorada: seis archivos JSON/XML/PDF en `.tmp/hu-45-5`.

`git diff --stat` de los archivos rastreados: 3 archivos, 244 inserciones, 60 eliminaciones. Los tres archivos nuevos aparecen en `git status --short` y no se incluyen en ese stat porque no se ha ejecutado `git add`.

## Límites y bloqueo funcional

**HU-45.3 técnicamente integrada:** generación y descarga de PDF, identidad, contenido disponible de tres fuentes y las cuatro secciones. Las pruebas verifican el aviso honesto de Statistics y el aislamiento bajo los contratos disponibles.

**HU-45 padre sin aceptación completa:** #39 CA-04 exige la información de estadísticas del jugador. Una sección con «no disponible» no equivale a estadísticas reales ni a una sección vacía confirmada. Falta fuente backend aprobada, contrato/owner integrado y verificación con datos del titular. Ese bloqueo no se resuelve con ceros, un Fake Statistics ni pruebas que declaren éxito funcional artificialmente.

**Portal Web y servicios desplegados:** el usuario informa HU-45.4 integrada. Este incremento ejecuta pruebas de Account; no modifica Web, no ejecuta el navegador ni genera capturas del portal. La evidencia visual exigida por #140 debe enlazarse o revalidarse en Nexus-Battle-Web. Tampoco se presentan los dobles de Ports/fetch como prueba contra servicios remotos desplegados ni contra Cognito real. El aislamiento remoto y su persistencia se validan en sus respectivos contextos; aquí se comprueban contratos y reenvío de la identidad.

**RNF-11:** esta matriz prueba minimización y protección de titularidad del flujo disponible. No declara cumplimiento integral de política/consentimiento ni aceptación formal de ADR-014; se conserva la salvedad de #197.

Veredicto: **B. HU-45.5 técnicamente avanzada pero funcionalmente bloqueada por Statistics**. Las verificaciones técnicas obligatorias terminan correctamente. CA-01, CA-02, CA-03 y CA-05 son verificables en Account con las limitaciones del ambiente documentadas; CA-04 solo tiene verificación técnica parcial. No se ejecutan commit, push, PR, merge ni cierres de issues.
