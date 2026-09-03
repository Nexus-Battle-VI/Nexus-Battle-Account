import type { PortablePersonalData } from '../dto/PortablePersonalData'
import type { PrivacyExportFileDto } from '../dto/PrivacyExportFileDto'

export interface PortablePersonalDataSerializerPort {
  serialize(data: PortablePersonalData): PrivacyExportFileDto
}
