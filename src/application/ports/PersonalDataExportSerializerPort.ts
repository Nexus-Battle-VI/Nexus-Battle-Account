import type { AccountPersonalDataDto } from '../dto/AccountPersonalDataDto'
import type { PersonalDataExportFileDto } from '../dto/PersonalDataExportFileDto'

export interface PersonalDataExportSerializerPort {
  serialize(data: AccountPersonalDataDto): PersonalDataExportFileDto
}
