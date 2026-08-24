import type { AccountPersonalDataDto } from '../../src/application/dto/AccountPersonalDataDto'
import type { PersonalDataExportFileDto } from '../../src/application/dto/PersonalDataExportFileDto'
import type { PersonalDataExportSerializerPort } from '../../src/application/ports/PersonalDataExportSerializerPort'
import { ExportPersonalData } from '../../src/application/use-cases/ExportPersonalData'
import { JsonPersonalDataExportAdapter } from '../../src/adapters/outbound/export/JsonPersonalDataExportAdapter'
import { XmlPersonalDataExportAdapter } from '../../src/adapters/outbound/export/XmlPersonalDataExportAdapter'

const PERSONAL_DATA: AccountPersonalDataDto = {
  email: 'owner@nexus.test',
  displayName: 'Ana Owner',
}

const JSON_SPECIAL_DATA: AccountPersonalDataDto = {
  email: 'owner+"\\\\unicode"@nexus.test',
  displayName: 'Ana "Backslash\\\\ Unicode \u00f1',
}

const XML_SPECIAL_DATA: AccountPersonalDataDto = {
  email: 'a&b<nexus>"owner"\'@nexus.test',
  displayName: 'Ana & <Owner> "quoted" \'single\'',
}

const countOccurrences = (content: string, token: string): number => content.split(token).length - 1

const parseJsonContent = (file: PersonalDataExportFileDto): Record<string, unknown> =>
  JSON.parse(file.content) as Record<string, unknown>

const readXmlElement = (content: string, element: 'email' | 'displayName'): string => {
  const opening = `<${element}>`
  const closing = `</${element}>`
  const start = content.indexOf(opening)
  const end = content.indexOf(closing)

  if (start < 0 || end < 0 || end < start) {
    throw new Error(`No se encontro el elemento XML ${element}.`)
  }

  return content.slice(start + opening.length, end)
}

class StubPersonalDataExportSerializer implements PersonalDataExportSerializerPort {
  readonly received: AccountPersonalDataDto[] = []

  constructor(private readonly file: PersonalDataExportFileDto) {}

  serialize(data: AccountPersonalDataDto): PersonalDataExportFileDto {
    this.received.push(data)

    return this.file
  }
}

describe('ExportPersonalData', () => {
  it('delega la serializacion y retorna exactamente el archivo producido', () => {
    const file: PersonalDataExportFileDto = {
      filename: 'personal-data.json',
      mediaType: 'application/json; charset=utf-8',
      content: '{"email":"owner@nexus.test","displayName":"Ana Owner"}',
    }
    const serializer = new StubPersonalDataExportSerializer(file)
    const exportPersonalData = new ExportPersonalData(serializer)

    const result = exportPersonalData.execute(PERSONAL_DATA)

    expect(result).toBe(file)
    expect(serializer.received).toHaveLength(1)
    expect(serializer.received[0]).toBe(PERSONAL_DATA)
  })
})

describe('JsonPersonalDataExportAdapter', () => {
  it('genera un archivo JSON valido con filename y mediaType exactos', () => {
    const file = new JsonPersonalDataExportAdapter().serialize(PERSONAL_DATA)

    expect(file.filename).toBe('personal-data.json')
    expect(file.mediaType).toBe('application/json; charset=utf-8')
    expect(parseJsonContent(file)).toEqual(PERSONAL_DATA)
  })

  it('genera contenido JSON exacto con indentacion determinista', () => {
    const file = new JsonPersonalDataExportAdapter().serialize(PERSONAL_DATA)

    expect(file.content).toBe(
      ['{', '  "email": "owner@nexus.test",', '  "displayName": "Ana Owner"', '}'].join('\n'),
    )
  })

  it('incluye exactamente email y displayName en el JSON parseado', () => {
    const file = new JsonPersonalDataExportAdapter().serialize(PERSONAL_DATA)

    expect(Object.keys(parseJsonContent(file))).toEqual(['email', 'displayName'])
  })

  it('excluye propiedades adicionales de runtime en JSON', () => {
    const data: AccountPersonalDataDto & {
      readonly secretInternalField: string
    } = {
      ...PERSONAL_DATA,
      secretInternalField: 'TOP-SECRET',
    }

    const file = new JsonPersonalDataExportAdapter().serialize(data)

    expect(parseJsonContent(file)).toEqual(PERSONAL_DATA)
    expect(file.content).not.toContain('secretInternalField')
    expect(file.content).not.toContain('TOP-SECRET')
  })

  it('mantiene semanticamente caracteres especiales al parsear JSON', () => {
    const file = new JsonPersonalDataExportAdapter().serialize(JSON_SPECIAL_DATA)

    expect(parseJsonContent(file)).toEqual(JSON_SPECIAL_DATA)
  })

  it('no muta el input al generar JSON', () => {
    const data: AccountPersonalDataDto & {
      readonly secretInternalField: string
    } = {
      ...PERSONAL_DATA,
      secretInternalField: 'TOP-SECRET',
    }
    const before = { ...data }

    new JsonPersonalDataExportAdapter().serialize(data)

    expect(data).toEqual(before)
  })
})

describe('XmlPersonalDataExportAdapter', () => {
  it('genera un archivo XML con filename, mediaType y estructura exactos', () => {
    const file = new XmlPersonalDataExportAdapter().serialize(PERSONAL_DATA)

    expect(file.filename).toBe('personal-data.xml')
    expect(file.mediaType).toBe('application/xml; charset=utf-8')
    expect(file.content).toBe(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<personalData>',
        '  <email>owner@nexus.test</email>',
        '  <displayName>Ana Owner</displayName>',
        '</personalData>',
      ].join('\n'),
    )
  })

  it('declara XML, usa un root unico y tags exactos', () => {
    const file = new XmlPersonalDataExportAdapter().serialize(PERSONAL_DATA)

    expect(file.content.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n')).toBe(true)
    expect(countOccurrences(file.content, '<personalData>')).toBe(1)
    expect(countOccurrences(file.content, '</personalData>')).toBe(1)
    expect(countOccurrences(file.content, '<email>')).toBe(1)
    expect(countOccurrences(file.content, '</email>')).toBe(1)
    expect(countOccurrences(file.content, '<displayName>')).toBe(1)
    expect(countOccurrences(file.content, '</displayName>')).toBe(1)
    expect(file.content.endsWith('</personalData>')).toBe(true)
  })

  it('escapa contenido XML para elementos', () => {
    const file = new XmlPersonalDataExportAdapter().serialize(XML_SPECIAL_DATA)

    expect(file.content).toBe(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<personalData>',
        '  <email>a&amp;b&lt;nexus&gt;&quot;owner&quot;&apos;@nexus.test</email>',
        '  <displayName>Ana &amp; &lt;Owner&gt; &quot;quoted&quot; &apos;single&apos;</displayName>',
        '</personalData>',
      ].join('\n'),
    )
  })

  it('excluye propiedades adicionales de runtime en XML', () => {
    const data: AccountPersonalDataDto & {
      readonly id: string
      readonly accountId: string
      readonly status: string
      readonly roles: readonly string[]
      readonly secretInternalField: string
    } = {
      ...PERSONAL_DATA,
      id: 'acc-1',
      accountId: 'acc-1',
      status: 'ACTIVE',
      roles: ['PLAYER'],
      secretInternalField: 'TOP-SECRET',
    }

    const file = new XmlPersonalDataExportAdapter().serialize(data)

    expect(file.content).not.toContain('<id>')
    expect(file.content).not.toContain('<accountId>')
    expect(file.content).not.toContain('<status>')
    expect(file.content).not.toContain('<roles>')
    expect(file.content).not.toContain('secretInternalField')
    expect(file.content).not.toContain('TOP-SECRET')
  })

  it('no muta el input al generar XML', () => {
    const data: AccountPersonalDataDto & {
      readonly secretInternalField: string
    } = {
      ...PERSONAL_DATA,
      secretInternalField: 'TOP-SECRET',
    }
    const before = { ...data }

    new XmlPersonalDataExportAdapter().serialize(data)

    expect(data).toEqual(before)
  })
})

describe('Consistencia JSON/XML de datos personales', () => {
  it('representa los mismos email y displayName en ambos formatos', () => {
    const jsonFile = new JsonPersonalDataExportAdapter().serialize(PERSONAL_DATA)
    const xmlFile = new XmlPersonalDataExportAdapter().serialize(PERSONAL_DATA)
    const jsonPayload = parseJsonContent(jsonFile)

    expect(jsonPayload).toEqual(PERSONAL_DATA)
    expect(readXmlElement(xmlFile.content, 'email')).toBe(jsonPayload.email)
    expect(readXmlElement(xmlFile.content, 'displayName')).toBe(jsonPayload.displayName)
  })
})
