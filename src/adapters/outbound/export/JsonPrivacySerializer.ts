import type { PortablePersonalData } from '../../../application/dto/PortablePersonalData'
import type { PrivacyExportFileDto } from '../../../application/dto/PrivacyExportFileDto'
import type { PortablePersonalDataSerializerPort } from '../../../application/ports/PortablePersonalDataSerializerPort'

export class JsonPrivacySerializer implements PortablePersonalDataSerializerPort {
  serialize(data: PortablePersonalData): PrivacyExportFileDto {
    return {
      filename: 'nexus-battles-personal-data.json',
      mediaType: 'application/json; charset=utf-8',
      content: JSON.stringify(data, null, 2),
    }
  }
}
