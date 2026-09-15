# HU-45.3 — Estadísticas del héroe preparado en el PDF

Refs Nexus-Battle-VI/Nexus-Battle-Management#39, #135 y #140.

## Auditoría y decisión de fuente

Auditoría del 2026-09-09. Account parte de `be8074ce50acae8b5dc8ffa735b611582e598558`, rama `feat/hu-45-3-integrar-estadisticas-player-inventory`, árbol limpio. Player-Inventory se consultó sin modificaciones en HEAD `8df9d74ca33f027cf7f415c278b20438a4587748`, también limpio.

| Fuente                 | Endpoint GET                                   | Identidad                               | Datos                                                | Semántica                                                            | Apta para HU-45                              |
| ---------------------- | ---------------------------------------------- | --------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------- |
| Inventory, existente   | `/api/inventories/me/items?page=N`             | Bearer del titular                      | Referencia, nombre, cantidad                         | Inventario propio paginado                                           | Sí, conservada                               |
| Statistics, elegida    | `/api/inventories/me/heroes/selection`         | `VerifiedIdentity.subject` del Bearer   | Configuración, estadísticas, preparación y capacidad | Configuración propia preparada actual; una llamada, sin elegir héroe | Sí                                           |
| Equipment, alternativa | `/api/inventories/me/heroes/:heroId/equipment` | Sujeto verificado y propiedad del héroe | Héroe, equipo, estadísticas y efectos                | Requiere conocer previamente un héroe propio                         | Válida, innecesaria para la selección actual |
| Community, existente   | `/api/me/posts`                                | Bearer del titular                      | Comentarios propios                                  | Publicaciones del titular                                            | Sí, conservada                               |
| Commerce, existente    | `/api/orders`                                  | Bearer del titular                      | Pedidos propios                                      | Historial del titular                                                | Sí, conservada                               |

La matriz y la decisión se entregaron antes de modificar código. `GeneratePrivacyPdfReport` ya componía tres puertos HTTP; el renderer imprimía un aviso fijo para Statistics. No se reimplementaron esas fuentes.

## Contrato real de Player-Inventory

Archivos auditados: `src/application/dto/HeroSelectionDto.ts`, `HeroEquipmentDto.ts`, los casos de uso `GetHeroSelection.ts`, `GetHeroEquipment.ts`, `hero-selection-shared.ts`, `hero-equipment-shared.ts`, `src/adapters/inbound/http/hero-selection.controller.ts`, `src/domain/services/effective-stats.ts` y `src/domain/value-objects/equipment-effects.ts`.

`HeroSelectionDto` devuelve:

- `selectedAt`: string del instante de selección.
- `configuration.hero`: `heroId`, `reference`, `subtype`, `name`, `imageUrl`.
- `configuration.equipment`: armas, armadura por ranura e ítems equipados.
- `configuration.baseStats` y `effectiveStats`: `power`, `health`, `defense` numéricos; `attack` numérico o null; `damage` y `healing` como magnitud o null.
- Magnitudes: `{ mode: 'FIXED', amount }`, `{ mode: 'PERCENTAGE', basisPoints }` o `{ mode: 'DICE', count, sides }`.
- `configuration.deltas`: `{ statistic, base, effective, delta }[]`. La fuente calcula diferencias numéricas para POWER, HEALTH, DEFENSE y ATTACK.
- `configuration.activeEffects`: efectos con procedencia y `appliedToStats`.
- `readiness`: `{ ready, blockers }`; `capacity`: ocupación/máximo de armas, armadura e ítems.

No hay un campo HTTP `available`: Account lo usa solo para expresar disponibilidad de la consulta. `configuration` es la vista de HU-28. Account no calcula estadísticas, interpreta efectos ni ejecuta combate.

La proyección mínima de Account conserva nombre/referencia del héroe, baseStats, effectiveStats, deltas y `readiness.ready`. No copia entidades de dominio, equipamiento, imágenes, capacidad ni efectos. El PDF muestra Poder, Vida, Defensa, Ataque, Daño y Sanación. Null se conserva como «no informado»; los dados se muestran como `2d6` sin resolverlos; 1250 puntos básicos se presentan como 12.5%.

## Puerto, adaptador y errores

`PlayerStatisticsReportPort.getOwnPreparedHeroStatistics(accessToken)` es de solo lectura. `HttpPlayerStatisticsReportAdapter` hace un único GET con el mismo Bearer ya autenticado por Account. Reutiliza `PLAYER_INVENTORY_BASE_URL`, timeout de 5000 ms, AbortSignal y logger existentes. No agrega configuración ni dependencias. Rechaza redirecciones para mantener la consulta en el endpoint configurado.

| Respuesta fuente                                      | Resultado del puerto                      | PDF                                                                                   |
| ----------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------- |
| 200, proyección válida                                | `available: true`, estadísticas recibidas | Héroe preparado, preparación, seis estadísticas base/efectivas y deltas presentes     |
| 404                                                   | `available: true, statistics: null`       | «No hay una configuración de héroe preparado disponible para consultar estadísticas.» |
| Error HTTP, red, timeout, JSON o proyección inválidos | `available: false, statistics: null`      | Aviso técnico independiente; las otras tres categorías permanecen                     |
| URL sin configurar                                    | `available: false, statistics: null`      | Mismo aviso, sin llamadas                                                             |

La fuente documenta dos causas de 404: `NoHeroSelectedError` y `HeroNotOwnedError` cuando el héroe ya no pertenece al titular. Por eso el PDF informa ausencia de configuración disponible, sin afirmar siempre que nunca se seleccionó un héroe. Catalog indisponible se traduce en 503. `ready: false` conserva los datos y muestra preparación «no listo».

Se validan tipos de campos consumidos, números finitos, magnitudes, deltas y preparación. No se presentan datos parciales ante respuestas inválidas. No se registran Bearer, payload ni mensajes de excepciones remotas.

## Titularidad y verificación

Primero `GetOwnPersonalData` resuelve la cuenta por sujeto verificado; luego se consultan los cuatro puertos en paralelo. El nuevo puerto no admite accountId, ownerId, customerId, subject ni heroId como selectores. JSON/XML no consultan Statistics ni cambian de esquema.

TDD: la prueba del PDF falló porque seguía apareciendo el aviso fijo. Después de implementar, pasaron las cuatro suites focalizadas: 123 pruebas, incluyendo las 88 de integración HTTP.

- Adaptador: GET/Bearer, contrato válido, 404, URL ausente, HTTP 401/403/429/500/503, proyecciones inválidas, JSON inválido, red, timeout, null, porcentajes y logs sin datos sensibles.
- Renderer: estadísticas base/efectivas, dados, valores fijos, porcentajes, null, deltas, preparación, cuatro secciones disponibles/vacías/indisponibles y no mutación.
- HTTP: AppModule, guards y pipes reales; adaptador Statistics de producción contra servidor HTTP local del contrato auditado. A obtiene Guerrera de Ana (Poder 12/16); B obtiene Maga de Beatriz (37/41). Se verifica GET, ruta fija y Bearer.
- Se conservan los casos de query/body/headers manipulados y se comprueba que no mezclan héroes. Tokens inválidos y cuentas inexistentes no consultan Statistics.
- 404, 503 y payload inválido permiten descargar las otras tres categorías. Los snapshots de Account y datos fuente permanecen iguales.
- Dos exportaciones con fuentes y reloj iguales producen el mismo contenido textual. No se exige igualdad binaria de metadatos PDFKit.

Los fixtures son sintéticos y respetan el contrato auditado; no son estadísticas locales de producción. Los cuatro PDF de evidencia (A, B, 404, 503) se renderizaron con Windows.Data.Pdf y se inspeccionaron: una página cada uno, legibles y sin recortes ni solapamientos. JSON/XML pasaron la comparación independiente para ambos titulares.

Se auditó el código de la API real y se comprobó el transporte HTTP local. No se afirma una prueba contra un despliegue remoto ni Cognito real. Player-Inventory, Web, el dominio de Account y las otras tres fuentes no fueron modificados.

## Resultado

**PLAYER STATISTICS SOURCE NOT AVAILABLE: RESUELTO** en Account mediante la selección propia de Player-Inventory, sin inventar datos. La matriz CA-01 a CA-05, comandos reproducibles y resultados finales de los gates están en [HU-45.5](hu-45-5-privacidad-portabilidad.md).
