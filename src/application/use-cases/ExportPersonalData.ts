import type { AccountPersonalDataDto } from '../dto/AccountPersonalDataDto'
import type { PersonalDataExportFileDto } from '../dto/PersonalDataExportFileDto'
import type { PersonalDataExportSerializerPort } from '../ports/PersonalDataExportSerializerPort'

export class ExportPersonalData {
  private readonly serializer: PersonalDataExportSerializerPort

  constructor(serializer: PersonalDataExportSerializerPort) {
    this.serializer = serializer
  }

  execute(data: AccountPersonalDataDto): PersonalDataExportFileDto {
    return this.serializer.serialize(data)
  }
}
