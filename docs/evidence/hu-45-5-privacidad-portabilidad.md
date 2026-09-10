# Evidencia HU-45.5 — Privacidad y portabilidad

Refs Nexus-Battle-VI/Nexus-Battle-Management#39, #135 y #140.

## Alcance y fuentes de verdad

Actualización del 2026-09-09 para integrar Statistics en HU-45.3. Sustituye el diagnóstico del 2026-09-05 que mantenía CA-04 bloqueado por ausencia de fuente.

- [HU-45 / RF-45 #39](https://github.com/Nexus-Battle-VI/Nexus-Battle-Management/issues/39): consulta propia, JSON, XML, PDF con cuatro categorías y aislamiento.
- [HU-45.3 #135](https://github.com/Nexus-Battle-VI/Nexus-Battle-Management/issues/135): PDF, fuentes del mismo titular, secciones vacías y ausencia de mutaciones.
- [HU-45.5 #140](https://github.com/Nexus-Battle-VI/Nexus-Battle-Management/issues/140): verificación y evidencia reproducible.

Las tres issues se consultaron abiertas. No se cambió su estado. La auditoría y el contrato están en [HU-45.3 — Statistics](hu-45-3-estadisticas-player-inventory.md).

**PLAYER STATISTICS SOURCE NOT AVAILABLE: RESUELTO.** El PDF obtiene estadísticas base, efectivas y deltas del héroe preparado desde `GET /api/inventories/me/heroes/selection`. No inventa estadísticas de partidas, ranking o progreso.

## Ambiente

| Elemento                        | Valor                                                                                                   |
| ------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Rama                            | `feat/hu-45-3-integrar-estadisticas-player-inventory`                                                   |
| Account HEAD inicial            | `be8074ce50acae8b5dc8ffa735b611582e598558`, árbol limpio                                                |
| Player-Inventory auditado       | `8df9d74ca33f027cf7f415c278b20438a4587748`, limpio, solo lectura                                        |
| HTTP de Account                 | AppModule, guards y ValidationPipe reales; verificador de tokens de prueba                              |
| Statistics                      | Adaptador HTTP de producción contra servidor HTTP local con fixtures del contrato fuente                |
| Inventory, Community y Commerce | Puertos de prueba existentes en integración; adaptadores HTTP existentes cubiertos en pruebas unitarias |
| PDF                             | PDFKit real, lectura de texto y renderizado visual con Windows.Data.Pdf                                 |
| PostgreSQL                      | Gate `test:db` con Testcontainers y Docker                                                              |

## Matriz final CA-01 a CA-05

PASS significa comportamiento técnico comprobado en el alcance Account de esta ejecución.

| Criterio                | Verificación                                                                                                                                                      | Resultado |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| CA-01 — Consulta propia | `GET /api/accounts/me/privacy` devuelve datos permitidos del sujeto autenticado; sin selector; acceso inválido y cuenta ausente rechazados                        | PASS      |
| CA-02 — JSON            | Esquema 1.0, campos exactos, titular A/B correcto, exclusión de secretos; parseo independiente                                                                    | PASS      |
| CA-03 — XML             | XML bien formado con DTD prohibido; campos, roles, términos, fecha y titular equivalentes al JSON; caracteres escapados                                           | PASS      |
| CA-04 — PDF             | Inventario + estadísticas del héroe preparado + comentarios + historial de transacciones; valores base/efectivos y deltas de la fuente; descarga y lectura visual | PASS      |
| CA-05 — Titularidad     | A/B sin mezcla en consulta y formatos; query manipulada rechazada, body/headers sin efecto; mismo Bearer en Statistics sin selector externo                       | PASS      |

Comprobaciones transversales:

- **Sin héroe preparado:** 404 produce aviso de configuración ausente, sin inventar estadísticas ni fallar todo el PDF. También cubre pérdida de propiedad del héroe según la fuente.
- **Caída de Statistics:** 503, timeout, red y respuesta inválida producen indisponibilidad técnica independiente. Inventario, comentarios y pedidos siguen en el PDF.
- **Secciones vacías:** el renderer distingue ausencia de registros e indisponibilidad en las cuatro categorías.
- **Sin mutación:** snapshot de cuentas y respuestas fuente antes/después iguales; acceso Statistics exclusivamente GET. No se selecciona ni equipa un héroe.
- **Reproducibilidad:** mismo contenido textual del PDF para las mismas fuentes y reloj. No se exige identidad binaria porque PDFKit incorpora metadatos internos.
- **Autenticación previa:** token inválido o cuenta local ausente impiden llamadas a Statistics. No se registran tokens ni payloads.
- **JSON/XML:** conservan su esquema y no consultan Statistics.

## Pruebas

Se amplían `account-self-service-http.spec.ts`, `generate-privacy-pdf-report.spec.ts` y `pdf-kit-privacy-report-renderer.spec.ts`. Se agrega `player-statistics-report-adapter.spec.ts` y dos soportes para payload de selección y frontera HTTP local.

Se reutilizan `get-own-personal-data.spec.ts`, `portable-personal-data-export.spec.ts`, `privacy-report-adapters.spec.ts`, `privacy-export-evidence.ts` y `verify-hu-45-5-exports.ps1`. No se cambian serializers JSON/XML, umbrales ni dependencias.

TDD: RED por ausencia de estadísticas en el PDF; GREEN focalizado de 4 suites / 123 pruebas. La suite HTTP tiene 88 pruebas. Los nuevos casos cubren datos base/efectivos, magnitudes, deltas, ausencia, errores, token, aislamiento y no mutación.

## Gates finales

| Gate                    | Resultado final                                            | Salida |
| ----------------------- | ---------------------------------------------------------- | ------ |
| `npm run format`        | PASS, sin cambios en archivos ajenos al alcance            | 0      |
| `npm run format:check`  | Todos los archivos cumplen Prettier                        | 0      |
| `npm run lint`          | PASS desde la ruta real del repositorio                    | 0      |
| `npm run typecheck`     | PASS                                                       | 0      |
| `npm run test`          | 53 suites, 831 pruebas, todas PASS                         | 0      |
| `npm run test:coverage` | 53 suites, 831 pruebas, todas PASS; 76.782 s               | 0      |
| `npm run test:db`       | PostgreSQL real: 5 suites, 68 pruebas, todas PASS; 19.99 s | 0      |
| `npm run build`         | PASS                                                       | 0      |
| `git diff --check`      | Sin errores de whitespace                                  | 0      |

| Cobertura                  | Statements         | Branches           | Functions        | Lines              |
| -------------------------- | ------------------ | ------------------ | ---------------- | ------------------ |
| Suite principal            | 91.64% (2675/2919) | 85.60% (1029/1202) | 86.04% (481/559) | 91.32% (2548/2790) |
| Suite PostgreSQL           | 96.59% (170/176)   | 91.66% (66/72)     | 96.15% (50/52)   | 97.07% (166/171)   |
| Nuevo adaptador Statistics | 97.77%             | 98.03%             | 100%             | 100%               |

No se redujeron umbrales ni se excluyó código. La primera ejecución DB, simultánea con cobertura, agotó memoria en un worker; la repetición aislada del mismo `npm run test:db` pasó íntegramente. ESLint y el último `format:check` requirieron ejecutarse fuera del sandbox: la ruta virtual afectó la resolución de `eslint.config.mjs` y Prettier la detectó como enlace simbólico. Ambos pasaron desde la ruta real, sin cambiar configuración. Se corrigieron previamente una etiqueta con tipo potencialmente undefined y el formato de un test.

La comparación por bytes de los archivos previamente ajenos al alcance confirmó cero diferencias. `git status --short`: 8 archivos modificados y 6 nuevos, todos relacionados con Statistics/pruebas/evidencia; ninguno en staging. Player-Inventory conserva su HEAD y árbol limpio.

## Reproducción de artefactos

```powershell
$env:HU45_WRITE_EVIDENCE = '1'
npm run test -- --runTestsByPath test/integration/account-self-service-http.spec.ts --runInBand
Remove-Item Env:HU45_WRITE_EVIDENCE
& docs/evidence/verify-hu-45-5-exports.ps1
```

Produce `.tmp/hu-45-5/ana.{json,xml,pdf}`, `beatriz.{json,xml,pdf}`, `statistics-404.pdf` y `statistics-503.pdf`. La carpeta está ignorada por Git y contiene solo datos sintéticos. El verificador independiente confirmó PASS para JSON/XML de ambos titulares. Se renderizaron e inspeccionaron las cuatro páginas PDF sin recortes ni solapamientos.

## Límites de la evidencia

Esta ejecución verifica Account y su contrato HTTP. No ejecuta el portal Web, Cognito real ni servicios remotos desplegados. Las capturas del portal de #140 deben conservar su evidencia en Nexus-Battle-Web; estas pruebas no se presentan como capturas del portal. Player-Inventory fue auditado sin modificaciones y sus datos no se consultaron por base de datos.

Esta verificación no certifica cumplimiento integral de RNF-11 ni resuelve los pendientes de consentimiento/publicación/aceptación ADR-014 registrados históricamente en [EN-011 #197](https://github.com/Nexus-Battle-VI/Nexus-Battle-Management/issues/197). No se añaden esos requisitos al incremento.

**Veredicto A: HU-45 técnicamente completa y lista para PR final en el alcance Account verificado.** CA-01 a CA-05 pasan y el bloqueo de fuente Statistics queda resuelto. Se conservan los límites de ambiente indicados, sin declarar aceptación formal de producto. No se ejecutaron commit, push, PR, merge ni cierres de Management.
