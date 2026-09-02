import type { ApplicablePrivacyPolicyPort } from '../../../application/ports/ApplicablePrivacyPolicyPort'

/**
 * Adaptador minimo: la version aplicable es un valor de configuracion, no una
 * tabla ni un servicio. `null` (sin configurar) significa "ninguna version es
 * aplicable todavia" -el valor por defecto, y el correcto mientras la Politica
 * siga sin aprobacion formal (ver `ApplicablePrivacyPolicyPort`)-. Rechaza
 * todo hasta que alguien active una version a proposito.
 */
export class ConfiguredPrivacyPolicyVersion implements ApplicablePrivacyPolicyPort {
  private readonly applicableVersion: string | null

  constructor(applicableVersion: string | null) {
    this.applicableVersion = applicableVersion
  }

  isApplicable(version: string): boolean {
    return this.applicableVersion !== null && this.applicableVersion === version
  }
}
