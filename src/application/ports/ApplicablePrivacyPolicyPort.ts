/**
 * Que version de la Politica de Privacidad acepta HOY el registro (EN-011,
 * CA-02).
 *
 * Separa a proposito dos cosas que `RegisterAccount` no debe confundir:
 * la CAPACIDAD tecnica de persistir un consentimiento versionado (que ya
 * existe con este cambio) de la decision de que version es la APLICABLE en
 * runtime (que este puerto resuelve). Que `privacy-policy-v0.3.md` exista en
 * el repositorio de Infrastructure no la convierte en aplicable: mientras esa
 * fuente siga marcada `Review Candidate / Pending Internal Approval`
 * (ADR-014 sigue `Proposed`), nada debe aceptarla en silencio.
 *
 * Por eso la implementacion no lee el markdown ni ningun repositorio externo:
 * lee una configuracion explicita de este servicio. Activar una version en
 * produccion es, a proposito, un cambio de configuracion visible y deliberado
 * el dia que exista aprobacion formal -no una consecuencia automatica de que
 * el documento exista-.
 */
export interface ApplicablePrivacyPolicyPort {
  /** Si `version` es la que este entorno reconoce como aplicable ahora mismo. */
  isApplicable(version: string): boolean
}

export const APPLICABLE_PRIVACY_POLICY = Symbol('ApplicablePrivacyPolicyPort')
