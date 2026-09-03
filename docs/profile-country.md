# País del perfil como dependencia del e-commerce

La instrucción del usuario del 3 de septiembre de 2026 amplía la edición de perfil descrita en HU-05 para soportar HU-57: el origen del país del cliente es su perfil guardado. Trazabilidad: [Management #31](https://github.com/Nexus-Battle-VI/Nexus-Battle-Management/issues/31). Esta ampliación permite editar `countryCode` además de `displayName`.

`GET /api/accounts/me` incluye `countryCode: string | null`. `PATCH /api/accounts/me` acepta un objeto parcial con `displayName` y/o `countryCode`. El país admite códigos ISO 3166-1 alpha-2 asignados, normalizados con trim y mayúsculas; `co` se guarda como `CO`. Un campo omitido conserva su valor; `countryCode: null` elimina el país. Un objeto vacío, un código no asignado, un apodo nulo o una propiedad ajena al contrato recibe 400. El cambio mixto valida ambos campos antes de guardar ninguno. La cuenta siempre se resuelve mediante el sujeto autenticado: el cuerpo no puede elegir otra cuenta.

La migración `hu57-profile-country` añade `accounts.country_code` nullable después de todas las migraciones existentes. Las cuentas anteriores y los registros nuevos conservan `null` hasta que su titular lo declare. No se infiere el país desde AWS, Cognito, IP, correo ni idioma del navegador. La columna valida formato normalizado; el dominio valida la pertenencia al vocabulario ISO.

El país es dato personal. Se incluye en la proyección administrativa y su exportación JSON existente, con las mismas autorizaciones; no se añade a testimonios, eventos ni logs. Permanece en la misma fila de la cuenta y no crea otro almacén de datos personales. La solicitud de eliminación existente mantiene su alcance: registrar una solicitud no ejecuta todavía la eliminación del dato.

Account solo guarda y entrega el país. La correspondencia con COP/USD/EUR, los importes regionales, el tratamiento de país desconocido y las promociones pertenecen al contrato comercial y necesitan definición allí; Account no convierte precios ni inventa reglas de cambio.
