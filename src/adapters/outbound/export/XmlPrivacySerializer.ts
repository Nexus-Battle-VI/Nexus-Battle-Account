import type { PortablePersonalData } from '../../../application/dto/PortablePersonalData'
import type { PrivacyExportFileDto } from '../../../application/dto/PrivacyExportFileDto'
import type { PortablePersonalDataSerializerPort } from '../../../application/ports/PortablePersonalDataSerializerPort'

const XML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
}

const escapeXml = (value: string): string =>
  value.replace(/[&<>"']/gu, (character) => XML_ESCAPES[character] ?? character)

export class XmlPrivacySerializer implements PortablePersonalDataSerializerPort {
  serialize(data: PortablePersonalData): PrivacyExportFileDto {
    const personal = data.personalData
    const roles = personal.roles.map((role) => `      <role>${escapeXml(role)}</role>`)
    const content = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      `<privacyExport schemaVersion="${data.schemaVersion}">`,
      `  <generatedAt>${escapeXml(data.generatedAt)}</generatedAt>`,
      '  <personalData>',
      `    <email>${escapeXml(personal.email)}</email>`,
      `    <displayName>${escapeXml(personal.displayName)}</displayName>`,
      `    <firstNames>${escapeXml(personal.firstNames)}</firstNames>`,
      `    <lastNames>${escapeXml(personal.lastNames)}</lastNames>`,
      '    <roles>',
      ...roles,
      '    </roles>',
      `    <termsAccepted>${String(personal.termsAccepted)}</termsAccepted>`,
      '  </personalData>',
      '</privacyExport>',
    ].join('\n')

    return {
      filename: 'nexus-battles-personal-data.xml',
      mediaType: 'application/xml; charset=utf-8',
      content,
    }
  }
}
