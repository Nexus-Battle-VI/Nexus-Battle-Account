import { toPortablePersonalData } from '../dto/PortablePersonalData'
import type { PrivacyExportFileDto } from '../dto/PrivacyExportFileDto'
import type { ClockPort } from '../ports/ClockPort'
import type { PortablePersonalDataSerializerPort } from '../ports/PortablePersonalDataSerializerPort'
import type { GetOwnPersonalData } from './GetOwnPersonalData'

export type PortablePrivacyFormat = 'json' | 'xml'

interface ExportPortablePersonalDataDependencies {
  readonly getOwnPersonalData: GetOwnPersonalData
  readonly clock: ClockPort
  readonly serializers: Readonly<Record<PortablePrivacyFormat, PortablePersonalDataSerializerPort>>
}

export class ExportPortablePersonalData {
  constructor(private readonly deps: ExportPortablePersonalDataDependencies) {}

  async execute(subject: string, format: PortablePrivacyFormat): Promise<PrivacyExportFileDto> {
    const personalData = await this.deps.getOwnPersonalData.execute(subject)
    const portable = toPortablePersonalData(personalData, this.deps.clock.now())

    return this.deps.serializers[format].serialize(portable)
  }
}
