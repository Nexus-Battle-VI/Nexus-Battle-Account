import { JsonPrivacySerializer } from '../../src/adapters/outbound/export/JsonPrivacySerializer'
import { XmlPrivacySerializer } from '../../src/adapters/outbound/export/XmlPrivacySerializer'
import type { OwnPersonalDataDto } from '../../src/application/dto/OwnPersonalDataDto'
import { toPortablePersonalData } from '../../src/application/dto/PortablePersonalData'
import type { ClockPort } from '../../src/application/ports/ClockPort'
import { ExportPortablePersonalData } from '../../src/application/use-cases/ExportPortablePersonalData'
import type { GetOwnPersonalData } from '../../src/application/use-cases/GetOwnPersonalData'

const FIXED_NOW = new Date('2026-09-02T18:45:30.000Z')

const PERSONAL_DATA: OwnPersonalDataDto = {
  email: 'ana+privacy@nexus.test',
  displayName: 'Ana & <Nexus> "VI" \'Owner\'',
  firstNames: 'Ana María',
  lastNames: "Muñoz O'Connor",
  roles: ['PLAYER', 'MODERATOR'],
  termsAccepted: true,
}

const FIXED_CLOCK: ClockPort = { now: () => new Date(FIXED_NOW) }

const decodeXml = (value: string): string =>
  value
    .replaceAll('&apos;', "'")
    .replaceAll('&quot;', '"')
    .replaceAll('&gt;', '>')
    .replaceAll('&lt;', '<')
    .replaceAll('&amp;', '&')

const element = (xml: string, name: string): string => {
  const match = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'u').exec(xml)

  if (match?.[1] === undefined) {
    throw new Error(`Elemento XML ausente: ${name}`)
  }

  return decodeXml(match[1])
}

describe('PortablePersonalData', () => {
  it('construye una copia canónica versionada desde la proyección autorizada', () => {
    const result = toPortablePersonalData(PERSONAL_DATA, FIXED_NOW)

    expect(result).toEqual({
      schemaVersion: '1.0',
      generatedAt: '2026-09-02T18:45:30.000Z',
      personalData: PERSONAL_DATA,
    })
    expect(result.personalData).not.toBe(PERSONAL_DATA)
    expect(result.personalData.roles).not.toBe(PERSONAL_DATA.roles)
    expect(Object.keys(result.personalData).sort()).toEqual([
      'displayName',
      'email',
      'firstNames',
      'lastNames',
      'roles',
      'termsAccepted',
    ])
  })
})

describe('serialización portable JSON/XML', () => {
  const portable = toPortablePersonalData(PERSONAL_DATA, FIXED_NOW)

  it('genera JSON descargable, parseable y sin campos prohibidos', () => {
    const file = new JsonPrivacySerializer().serialize(portable)
    const parsed = JSON.parse(file.content) as Record<string, unknown>

    expect(file).toMatchObject({
      filename: 'nexus-battles-personal-data.json',
      mediaType: 'application/json; charset=utf-8',
    })
    expect(parsed).toEqual(portable)
    for (const forbidden of [
      'id',
      'subject',
      'status',
      'avatarStorageKey',
      'jti',
      'expiresAt',
      'token',
      'password',
      'secret',
      'hash',
      'credential',
    ]) {
      expect(file.content).not.toContain(`"${forbidden}"`)
    }
  })

  it('genera XML UTF-8 con atributos, arrays, booleanos y escape seguro', () => {
    const file = new XmlPrivacySerializer().serialize(portable)

    expect(file.filename).toBe('nexus-battles-personal-data.xml')
    expect(file.mediaType).toBe('application/xml; charset=utf-8')
    expect(file.content).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(file.content).toContain('<privacyExport schemaVersion="1.0">')
    expect(file.content).toContain('Ana &amp; &lt;Nexus&gt; &quot;VI&quot; &apos;Owner&apos;')
    expect(file.content.match(/<role>/gu)).toHaveLength(2)
    expect(element(file.content, 'generatedAt')).toBe(portable.generatedAt)
    expect(element(file.content, 'email')).toBe(PERSONAL_DATA.email)
    expect(element(file.content, 'displayName')).toBe(PERSONAL_DATA.displayName)
    expect(element(file.content, 'firstNames')).toBe(PERSONAL_DATA.firstNames)
    expect(element(file.content, 'lastNames')).toBe(PERSONAL_DATA.lastNames)
    expect(element(file.content, 'termsAccepted')).toBe('true')
  })

  it('representa en JSON y XML exactamente la misma semántica personal', () => {
    const json = JSON.parse(new JsonPrivacySerializer().serialize(portable).content) as {
      generatedAt: string
      personalData: OwnPersonalDataDto
      schemaVersion: string
    }
    const xml = new XmlPrivacySerializer().serialize(portable).content
    const roles = [...xml.matchAll(/<role>([\s\S]*?)<\/role>/gu)].map((match) =>
      decodeXml(match[1] ?? ''),
    )

    expect({
      schemaVersion: /<privacyExport schemaVersion="([^"]+)">/u.exec(xml)?.[1],
      generatedAt: element(xml, 'generatedAt'),
      personalData: {
        email: element(xml, 'email'),
        displayName: element(xml, 'displayName'),
        firstNames: element(xml, 'firstNames'),
        lastNames: element(xml, 'lastNames'),
        roles,
        termsAccepted: element(xml, 'termsAccepted') === 'true',
      },
    }).toEqual(json)
  })

  it('no muta el objeto canónico al serializar ambos formatos', () => {
    const before = structuredClone(portable)

    new JsonPrivacySerializer().serialize(portable)
    new XmlPrivacySerializer().serialize(portable)

    expect(portable).toEqual(before)
  })
})

describe('ExportPortablePersonalData', () => {
  it('consulta una sola vez la proyección autorizada y genera el formato solicitado', async () => {
    const execute = jest
      .fn<Promise<OwnPersonalDataDto>, [string]>()
      .mockResolvedValue(PERSONAL_DATA)
    const getOwnPersonalData = { execute } as unknown as GetOwnPersonalData
    const useCase = new ExportPortablePersonalData({
      getOwnPersonalData,
      clock: FIXED_CLOCK,
      serializers: {
        json: new JsonPrivacySerializer(),
        xml: new XmlPrivacySerializer(),
      },
    })

    const file = await useCase.execute('subject-verificado', 'json')

    expect(execute).toHaveBeenCalledWith('subject-verificado')
    expect(execute).toHaveBeenCalledTimes(1)
    expect(JSON.parse(file.content)).toEqual(toPortablePersonalData(PERSONAL_DATA, FIXED_NOW))
  })
})
