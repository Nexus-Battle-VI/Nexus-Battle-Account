import type { AccountPersonalDataDto } from '../../../application/dto/AccountPersonalDataDto'
import type { PersonalDataExportFileDto } from '../../../application/dto/PersonalDataExportFileDto'
import type { PersonalDataExportSerializerPort } from '../../../application/ports/PersonalDataExportSerializerPort'

export class JsonPersonalDataExportAdapter implements PersonalDataExportSerializerPort {
  serialize(data: AccountPersonalDataDto): PersonalDataExportFileDto {
    const payload = {
      email: data.email,
      displayName: data.displayName,
    }

    return {
      filename: 'personal-data.json',
      mediaType: 'application/json; charset=utf-8',
      content: JSON.stringify(payload, null, 2),
    }
  }
}
