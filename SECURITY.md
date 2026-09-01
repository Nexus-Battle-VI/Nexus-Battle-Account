# Política de seguridad

## Alcance

Esta política cubre el código de `Nexus-Battle-Account`. Nexus Battles VI es un producto académico en desarrollo: no existe todavía una versión en producción con datos reales de usuarios.

## Versiones soportadas

| Versión | Estado                                                 |
| ------- | ------------------------------------------------------ |
| `0.1.x` | En desarrollo activo. Recibe correcciones de seguridad |

## Reporte de vulnerabilidades

Las vulnerabilidades **no se reportan mediante Issues públicas ni Pull Requests**.

Se utiliza el reporte privado de vulnerabilidades de GitHub, disponible en la pestaña _Security_ de este repositorio. Un reporte útil incluye:

- Componente afectado y versión o commit.
- Descripción del problema y su impacto.
- Pasos reproducibles.
- Configuración necesaria para reproducirlo.

El equipo propietario acusa recibo y coordina la corrección junto con los Scrum Masters. La divulgación se realiza después de que la corrección esté integrada.

## Controles activos en el repositorio

- Grafo de dependencias y alertas de Dependabot.
- Actualizaciones de seguridad de dependencias agrupadas y programadas.
- Escaneo de secretos con protección de subida.
- Análisis estático de código con CodeQL.
- Revisión obligatoria del Code Owner antes de integrar en `main`.
- Historial lineal y prohibición de forzar la subida o eliminar `main`.
- Permisos de solo lectura por defecto para el token de los workflows.
- Acciones de terceros fijadas por SHA de commit completo.
- Aprobación requerida para ejecutar workflows de contribuciones externas.

## Manejo de secretos

- No se incorporan secretos, credenciales, tokens ni claves al repositorio.
- La configuración sensible se entrega por variables de entorno. `.env` está ignorado por Git; `.env.example` documenta las variables sin valores reales.
- La imagen de contenedor no incluye archivos de entorno ni credenciales.
- No se utilizan claves de acceso de larga duración de AWS. Cuando se habilite el despliegue, la autenticación usará OIDC con credenciales de corta duración. `CognitoAuthenticationProvider` (HU-02) tampoco las necesita: `InitiateAuth` y `RespondToAuthChallenge` son operaciones sin firma en el modelo del SDK, igual que las usa un cliente público sin secreto desde un navegador.
- La evidencia enlazada desde las Issues no debe contener secretos.

## Consideraciones específicas del servicio

- **Este servicio no almacena contraseñas ni secretos de autenticación.** El registro y la verificación de credenciales pertenecen al proveedor de identidad externo, detrás de `AuthenticationProviderPort` (verificación de contraseña y segundo factor, HU-02). **El alta tampoco es de este servicio**: ocurre en la pantalla del proveedor, y `POST /api/accounts` exige un sujeto ya verificado. Esa separación es deliberada y no debe romperse añadiendo un campo de contraseña al agregado.
- **El cambio de contraseña (HU-05) se delega en el proveedor.** `POST /api/accounts/me/password` actúa sobre el testimonio de acceso de quien llama a través de `PasswordChangePort` (`ChangePassword` de Cognito), sin credenciales de AWS ni permiso IAM. La contraseña no se persiste, no se registra en la observabilidad y no aparece en ninguna respuesta; la política de complejidad la aplica el proveedor. `Account` y PostgreSQL siguen sin columnas, hashes ni campos de contraseña.
- **El login (HU-02) no distingue "correo inexistente" de "contraseña incorrecta" en su respuesta.** Ambos casos, y una cuenta pendiente de verificación o suspendida, producen exactamente el mismo resultado (`invalidCredentials`, HTTP 401 con el mismo mensaje), para no permitir enumerar cuentas por su existencia o su estado.
- **El rol nunca se acepta desde la petición de login.** El contrato HTTP no declara un campo `role`; el `ValidationPipe` global lo rechaza con 400 si llega. El rol se lee siempre de la cuenta ya persistida.
- **Una cuenta `ADMINISTRATOR` o `SUPER_ADMINISTRATOR` no obtiene sesión solo con la contraseña.** El caso de uso exige completar un segundo factor y falla cerrado (no concede la sesión) si el proveedor no emite un reto para una cuenta de ese nivel, en lugar de asumir que la ausencia de reto significa que no hace falta.
- El servicio trata correos electrónicos y nombres visibles, que son datos personales. La observabilidad registra el dominio del correo, nunca la dirección completa.
- La validación de entrada descarta propiedades no declaradas y rechaza la petición si llegan campos desconocidos, de modo que un cliente no puede inyectar atributos que el contrato no contempla.
- Los roles no se aceptan desde la petición de registro: toda cuenta nace con el rol base y solo un administrador puede elevarla.
- La documentación interactiva OpenAPI permanece deshabilitada en producción salvo decisión explícita.

## Identidad

La integración con un proveedor de identidad y con un directorio corporativo permanece pendiente de aprobación. Hasta entonces el sistema opera con un proveedor de identidad simulado y no almacena contraseñas propias. Ver `docs/adr/ADR-004-identity-directory.md` en Nexus-Battle-Infrastructure.
