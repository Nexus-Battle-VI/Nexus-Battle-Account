import { Sanction } from '../../src/domain/entities/Sanction'
import { SanctionType } from '../../src/domain/entities/SanctionType'

const CREATED_AT = new Date('2026-09-06T12:00:00.000Z')
const APPEAL_DEADLINE = new Date('2026-10-06T12:00:00.000Z')

const buildSanction = (): Sanction =>
  Sanction.create({
    id: 'sanction-appeal-1',
    targetAccountId: 'target-1',
    actorAccountId: 'actor-1',
    type: SanctionType.Warning,
    reason: 'Conducta ofensiva reiterada.',
    createdAt: CREATED_AT,
  })

describe('Sanction appeal window - HU-42.3', () => {
  it('habilita la apelacion durante los 30 dias posteriores a la sancion', () => {
    const sanction = buildSanction()

    expect(sanction.appealDeadline).toEqual(APPEAL_DEADLINE)

    expect(sanction.canAppeal(new Date('2026-09-20T12:00:00.000Z'))).toBe(true)
  })

  it('permite apelar exactamente en el limite de 30 dias', () => {
    const sanction = buildSanction()

    expect(sanction.canAppeal(APPEAL_DEADLINE)).toBe(true)
  })

  it('deshabilita la apelacion despues del limite de 30 dias', () => {
    const sanction = buildSanction()

    expect(sanction.canAppeal(new Date('2026-10-06T12:00:00.001Z'))).toBe(false)
  })

  it('no permite apelar antes de que la sancion haya sido aplicada', () => {
    const sanction = buildSanction()

    expect(sanction.canAppeal(new Date('2026-09-06T11:59:59.999Z'))).toBe(false)
  })

  it('expone la fecha limite de apelacion en el snapshot', () => {
    const sanction = buildSanction()

    expect(sanction.toSnapshot()).toMatchObject({
      id: 'sanction-appeal-1',
      appealDeadline: APPEAL_DEADLINE,
    })
  })
})
