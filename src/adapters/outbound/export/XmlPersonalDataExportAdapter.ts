import type { AccountPersonalDataDto } from '../../../application/dto/AccountPersonalDataDto'
import type { PersonalDataExportFileDto } from '../../../application/dto/PersonalDataExportFileDto'
import type { PersonalDataExportSerializerPort } from '../../../application/ports/PersonalDataExportSerializerPort'

const XML_CONTENT_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
}

const escapeXmlContent = (value: string): string =>
  value.replace(/[&<>"']/g, (character) => XML_CONTENT_ESCAPES[character] ?? character)

export class XmlPersonalDataExportAdapter implements PersonalDataExportSerializerPort {
  serialize(data: AccountPersonalDataDto): PersonalDataExportFileDto {
    const payload = {
      email: data.email,
      displayName: data.displayName,
    }
    const content = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<personalData>',
      `  <email>${escapeXmlContent(payload.email)}</email>`,
      `  <displayName>${escapeXmlContent(payload.displayName)}</displayName>`,
      '</personalData>',
    ].join('\n')

    return {
      filename: 'personal-data.xml',
      mediaType: 'application/xml; charset=utf-8',
      content,
    }
  }
}
