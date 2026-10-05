# Account como dependencia de HU-77

Contrato consumido: `torneos-hu77-84-78-hu83-v2.0.0`, preparado por Coordinación el 5 de octubre de 2026. Esta entrega es local; la integración de servicios, las dos sesiones Cognito reales y la aceptación funcional siguen pendientes.

## Consultas internas

`GET /api/internal/accounts/:subject/tournament-eligibility` devuelve exclusivamente `{subject,displayName,eligible}`. El identificador es el sujeto del proveedor de identidad, codificado mediante `encodeURIComponent` al construir la URL; no el ID interno de Account. Una cuenta es elegible si su estado persistido es `ACTIVE` y contiene el rol `PLAYER`. Los privilegios administrativos por sí solos no la hacen jugador.

Una cuenta pendiente, suspendida, baneada o sin rol de jugador devuelve `eligible:false`. Esta lectura no reactiva suspensiones vencidas: la política de login/reactivación vigente sigue siendo responsabilidad de Account y una nueva operación consulta nuevamente el estado. Una cuenta inexistente responde 404; un repositorio inaccesible o una respuesta inconsistente con el sujeto consultado responde 503, sin detalles de proveedor. Los roles o la actividad enviados por el cliente no intervienen en la decisión.

`POST /api/internal/accounts/tournament-team-identity/validation` recibe solo `{name,avatarSubject}` y devuelve 200:

```json
{
  "name": "Nombre Normalizado",
  "avatar": { "kind": "ACCOUNT_AVATAR", "subject": "sujeto-del-integrante" },
  "policyVersion": "account-team-identity-v1"
}
```

Reutiliza `DisplayName` (normalización, 3–32 caracteres, caracteres vigentes), la blacklist activa y `GetAccountAvatar.executeBySubject`. No impone unicidad de nicknames a equipos, crea cuentas, carga imágenes ni persiste referencias del torneo. Comprueba que el avatar existente tenga bytes recuperables; no devuelve esos bytes, rutas, claves ni datos personales. No vuelve a aplicar el límite de subida a imágenes históricas ya admitidas por Account.

Tournament comprueba que `avatarSubject` sea uno de sus dos integrantes y conserva la autoridad sobre equipos, consentimiento, cupos y pagos. Que Account valide una referencia no acredita por sí solo esa pertenencia ni el consentimiento del compañero. Web utiliza con JWT el endpoint de avatar por sujeto ya publicado.

Formato incorrecto o campos extra: 400. Cuenta inexistente: 404. Nombre/avatar inválido: 422 `{code:'INVALID_TEAM_NAME'|'INVALID_TEAM_AVATAR',message}`. Política, repositorio o almacenamiento no disponible: 503 saneado. Esta consulta pide `failOnUnavailable:true` al resolver el avatar: `LocalAvatarStorage.read` solo interpreta `ENOENT` como ausencia y propaga errores de permisos/lectura. La opción es aditiva; los consumidores publicados de avatar conservan su comportamiento cuando no la solicitan.

## HMAC y configuración

Ambas rutas declaran `@InternalOnly('tournament')`: la lista explícita de ruta sustituye la lista global antigua. El servicio está reservado mediante `routeOnlyServices:['tournament']` en la composición; incluso si se agrega a `INTERNAL_SERVICE_ALLOWED_SERVICES`, no obtiene acceso a MFA, battle-profile o sanciones. Los consumidores antiguos mantienen su configuración y contratos.

El secreto se suministra mediante `INTERNAL_SERVICE_AUTH_SECRET`, compartido por los servicios que verifican el contrato HMAC existente. `.env.example` deja su valor vacío; no incluye credenciales nuevas. No hace falta agregar `tournament` a la lista global para habilitar estas dos rutas. No se añaden variables de configuración ni un JWT de servicio.

Cabeceras: `x-internal-service:tournament`, `x-internal-timestamp` en milisegundos y `x-internal-signature` HMAC-SHA256 hexadecimal. Se conserva la canonicalización vigente de caller, método, ruta codificada sin query, timestamp y SHA-256 del JSON canónico. Un GET sin cuerpo firma `{}`; el POST firma el cuerpo completo antes de normalizarlo. Ventana y comparación en tiempo constante siguen siendo las del guard existente. Caller, firma, cabeceras o timestamp inválidos responden el mismo 401. Sin secreto configurado, 503.

`@Public()` excluye estas rutas del guard de JWT de personas; el guard HMAC global sigue protegiéndolas, incluso con `AUTH_MODE=disabled`. El JWT de un navegador no da acceso interno. `/api/internal*` debe continuar bloqueado en el proxy público conforme al contrato; esta entrega no modifica ni acredita el despliegue de Infrastructure. Las rutas públicas protegidas siguen usando la autenticación actual y producción conserva sus validaciones de configuración.

## Verificación y límites

`test/integration/internal-tournament-eligibility-http.spec.ts` ejerce la composición actual con `AUTH_MODE=jwt`, HMAC, sujetos codificados, estados/roles reales del dominio, política vigente, respuestas mínimas, lectura sin escrituras, permisos por ruta y fallos de dependencias. Sustituye exclusivamente en el arnés el verificador de tokens, persistencia y almacenamiento por colaboradores controlados. No valida una sesión Cognito real ni acepta HU-77.

`test/unit/avatar-storage-unavailable.spec.ts` distingue ausencia, permisos denegados y errores de disco, conservando el límite del directorio de avatares y el comportamiento de los consumidores antiguos. `test/db/postgres-tournament-account.spec.ts` comprueba estas consultas con PostgreSQL, blacklist persistente y avatar en disco, incluyendo lecturas sin cambios de cuenta y conservación de HU-90. Las pruebas históricas del prototipo no son evidencia del checkout asignado. Comandos, resultados, entorno, commit y evidencias ejecutadas se registran en `estado-account.json` de la coordinación.

La migración `z20261003-hu90-sanction-reason-code` y las demás migraciones publicadas se conservan. Las consultas nuevas no requieren migración. El documento Sprint 3 conserva dos diferencias: preveía ningún cambio en Account y relleno IA; el contrato nuevo necesita estas consultas y HU-78 exige ocho equipos humanos confirmados sin IA.
