import type { OwnPersonalDataDto } from './OwnPersonalDataDto'

export interface PortablePersonalData {
  readonly schemaVersion: '1.0'
  readonly generatedAt: string
  readonly personalData: OwnPersonalDataDto
}

export const toPortablePersonalData = (
  data: OwnPersonalDataDto,
  generatedAt: Date,
): PortablePersonalData => ({
  schemaVersion: '1.0',
  generatedAt: generatedAt.toISOString(),
  personalData: {
    email: data.email,
    displayName: data.displayName,
    firstNames: data.firstNames,
    lastNames: data.lastNames,
    roles: [...data.roles],
    termsAccepted: data.termsAccepted,
  },
})
