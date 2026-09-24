# Idioma preferido de la interfaz

Trazabilidad: HU-05 «Gestión de perfil y preferencias (Mi Cuenta)», CA-04 «Gestión de preferencias» ([Management #14](https://github.com/Nexus-Battle-VI/Nexus-Battle-Management/issues/14)).

## Contrato

- `GET /api/accounts/me` incluye `preferredLanguage: 'es' | 'en' | 'fr' | 'pt' | null`.
- `PATCH /api/accounts/me` acepta `preferredLanguage` como campo parcial, solo o junto con `displayName` y/o `countryCode`.
  - Omitido: se conserva el valor actual.
  - `null`: vuelve a «sin preferencia».
  - Cualquier otro valor (`es-ES`, `EN`, `' en '`, `''`, `de`, números, arrays…) recibe **400** y no cambia nada de la cuenta, tampoco los otros campos del mismo cambio.
- La cuenta se resuelve siempre por el sujeto del testimonio: 401 sin testimonio y 404 si el sujeto no tiene cuenta local.

No hay endpoint nuevo: se reutiliza la edición self-service existente.

## Semántica de `null`

`null` significa que la persona **nunca eligió** un idioma, que no es lo mismo que haber elegido español. La Web decide qué mostrar en ese caso (hoy, español o la elección local del navegador). Las cuentas existentes quedan en `null` sin backfill.

## Persistencia

- Columna `accounts.preferred_language text NULL`, sin valor por defecto.
- Restricción `accounts_preferred_language_allowed`: `preferred_language is null or preferred_language in ('es','en','fr','pt')`. La base de datos es la última línea; el dominio (`PreferredLanguage`) y el DTO (`@IsIn`) ya validan antes.
- Migración `z20260924-hu05-preferred-language`. El prefijo `z2026…` la ordena después de todas las ya aplicadas en producción: Kysely aborta con `corrupted migrations` si una migración nueva queda antes que una aplicada (ver `database.ts`).
- Control de intención idéntico al del país: el repositorio solo escribe la columna cuando esa instancia del agregado cambió el idioma, de modo que un guardado por otro motivo (renombrar, asignar un rol) con una lectura antigua no revierte un idioma elegido mientras tanto.

## Compatibilidad y rollback

La columna es nullable y la imagen anterior de Account no la lee ni la escribe (sus inserciones nombran columnas explícitas), así que un rollback de la imagen **no** exige deshacer la migración. El `down` existe, pero borrarla perdería las preferencias guardadas; no debe ejecutarse como parte de un rollback de imagen.

## Fuera de alcance

- El tema claro/oscuro sigue siendo una preferencia local de la Web.
- No se toca Cognito ni su atributo `locale`; los correos del proveedor de identidad no cambian de idioma.
- Los mensajes de error de este servicio siguen en español; la Web los localiza por código HTTP cuando la interfaz no está en español.
