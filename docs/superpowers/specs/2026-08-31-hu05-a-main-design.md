# Diseño de integración de HU-05 hacia `main`

## Contexto

Las ramas remotas `main` y `develop` divergieron desde `2f48555`. El estado analizado es:

- `main`: `9a7a33a`, que ya incluye HU-04 mediante el PR #36.
- `develop`: `ce05df7`, cuatro commits por delante y doce por detrás de `main`.
- No existe un PR abierto de `develop` hacia `main`.

Tres de los cuatro commits exclusivos por historia de `develop` no representan funcionalidad pendiente:

- `a5c45b3` tiene el mismo árbol que `main` en `8a21f29`.
- `b595b15` tiene el mismo árbol que `main` en `cf2c60d`.
- `66d5b64` tiene el mismo árbol que `main` en `01c3e91` y Git lo reconoce como parche equivalente.

El único cambio funcional pendiente es HU-05 en `ce05df7`: gestión segura de Mi Cuenta y cambio de contraseña.

## Objetivo

Integrar únicamente HU-05 sobre el `main` vigente, conservando sin pérdidas HU-04 y todo el contenido previamente publicado en `main`.

## Fuera de alcance

- No fusionar la historia completa de `develop`.
- No volver a introducir los commits de sincronización ni HU-03.
- No reescribir, reiniciar ni forzar las ramas `main` o `develop`.
- No fusionar directamente a `main` sin los checks y la revisión exigidos por GitHub.
- No realizar despliegues ni modificar infraestructura AWS.

## Estrategia elegida

Se creará `integration/hu-05-a-main` desde el `origin/main` vigente y se aplicará únicamente `ce05df7` mediante `cherry-pick`.

Esta estrategia conserva la trazabilidad del cambio funcional, evita arrastrar historia duplicada y reduce el conflicto de seis archivos a uno: `src/infrastructure/bootstrap/app.module.ts`.

Se descartaron estas alternativas:

1. Fusionar todo `develop`: vuelve a reconciliar estados ya publicados y aumenta los conflictos sin aportar funcionalidad.
2. Copiar archivos manualmente: pierde trazabilidad, puede omitir dependencias y dificulta demostrar qué se transfirió.

## Resolución del conflicto

La resolución de `app.module.ts` será aditiva y semántica:

- Se conservarán todos los controladores, proveedores, puertos, adaptadores y casos de uso de recuperación de contraseña de HU-04.
- Se incorporarán los controladores, proveedores, puertos, adaptadores y casos de uso de Mi Cuenta y cambio de contraseña de HU-05.
- Se conservarán los tokens de inyección existentes y se añadirán los de HU-05 sin reemplazar arreglos completos por la versión de una sola rama.
- No se resolverá el archivo seleccionando globalmente `ours` ni `theirs`.

Los demás archivos de HU-05 deberán aplicarse sin conflicto. Cualquier conflicto adicional detendrá la integración para volver a comparar el estado remoto, en vez de improvisar una resolución.

## Validación de preservación

Antes de publicar se comprobará:

1. La rama de integración contiene `origin/main` como ancestro.
2. El diff contra `origin/main` corresponde a HU-05, la resolución combinada de `app.module.ts` y este documento.
3. Ningún archivo exclusivo de HU-04 desaparece o se revierte.
4. Los endpoints y dependencias de recuperación de contraseña de HU-04 siguen presentes.
5. Los endpoints de Mi Cuenta y cambio de contraseña de HU-05 quedan registrados.
6. No quedan marcadores de conflicto ni errores de whitespace.

## Verificación técnica

Con Node.js 24 se ejecutará la misma secuencia de calidad del repositorio:

1. `npm ci`
2. `npm run lint`
3. `npm run format:check`
4. `npm run typecheck`
5. `npm run test:unit`
6. `npm run test:integration`
7. `npm run test:db`
8. `npm run test:coverage`
9. `npm run build`
10. Construcción y pruebas de humo de la imagen Docker según el workflow de CI.

Las pruebas PostgreSQL se ejecutarán contra un motor real mediante Testcontainers. Un fallo detendrá la publicación de la rama hasta identificar y corregir su causa.

## Entrega

Tras la validación local se publicará `integration/hu-05-a-main` y se abrirá un PR hacia `main`. La integración final quedará sujeta a los checks remotos y a la aprobación humana configurada en la protección de rama.

## Criterios de aceptación

- HU-05 funciona sobre el `main` que ya contiene HU-04.
- No se incluye ningún commit funcional duplicado de `develop`.
- No se pierde ni revierte comportamiento existente en `main`.
- Todas las validaciones locales y remotas terminan correctamente.
- El PR es fusionable y solo queda sujeto a las políticas normales de revisión de la rama.
