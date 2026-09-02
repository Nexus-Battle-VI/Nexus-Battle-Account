/**
 * Variables de entorno por defecto SOLO para la suite de integracion.
 *
 * `AppModule` real arranca en estas pruebas (`Test.createTestingModule({
 * imports: [AppModule] })`), asi que lee la version de Politica aplicable
 * igual que en produccion (EN-011, CA-02): sin configurar, rechaza cualquier
 * registro. "v0.3" aqui es SOLO el valor de pruebas -ver ConfiguredPrivacyPolicyVersion
 * y .env.example-, nunca una afirmacion de que v0.3 es la Politica legal vigente.
 *
 * `??=` respeta un valor que el entorno de CI ya trajera; no lo sobreescribe.
 */
process.env.PRIVACY_POLICY_APPLICABLE_VERSION ??= 'v0.3'
