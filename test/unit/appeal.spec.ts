import { Appeal } from '../../src/domain/entities/Appeal'
import { AppealStatus } from '../../src/domain/entities/AppealStatus'
import { AppealDecision } from '../../src/domain/entities/AppealDecision'
import { DomainError } from '../../src/domain/errors/DomainError'

const SUBMITTED_AT = new Date('2026-10-05T12:00:00.000Z')

const submitted = () =>
  Appeal.submit({
    id: 'appeal-1',
    sanctionId: 'sanction-1',
    accountId: 'account-1',
    statement: 'La sancion no corresponde a mi conducta.',
    submittedAt: SUBMITTED_AT,
  })

describe('Appeal (HU-42, §7.3.2 "Proceso de apelacion")', () => {
  it('nace en estado SUBMITTED sin decision', () => {
    const appeal = submitted()

    expect(appeal.currentStatus).toBe(AppealStatus.Submitted)
    expect(appeal.currentDecision).toBeNull()
    expect(appeal.isResolved).toBe(false)
  })

  it('calcula decisionDueAt como 15 dias habiles (lunes a viernes) desde la presentacion', () => {
    const appeal = submitted()

    // 2026-10-05 es lunes. +15 dias habiles salta 3 fines de semana completos:
    // 15 dias habiles + 6 dias de fin de semana = 21 dias naturales -> 2026-10-26.
    expect(appeal.decisionDueAt.toISOString()).toBe('2026-10-26T12:00:00.000Z')
  })

  it('rechaza una justificacion vacia', () => {
    expect(() =>
      Appeal.submit({
        id: 'appeal-2',
        sanctionId: 'sanction-1',
        accountId: 'account-1',
        statement: '   ',
        submittedAt: SUBMITTED_AT,
      }),
    ).toThrow(DomainError)
  })

  it('resuelve con OVERTURNED y conserva quien decidio y cuando', () => {
    const appeal = submitted()
    const resolvedAt = new Date('2026-10-10T09:00:00.000Z')

    appeal.resolve({
      decision: AppealDecision.Overturned,
      notes: 'La causal citada no esta respaldada por el registro de chat.',
      resolvedByAccountId: 'moderador-1',
      resolvedAt,
    })

    expect(appeal.isResolved).toBe(true)
    expect(appeal.currentStatus).toBe(AppealStatus.Resolved)
    expect(appeal.currentDecision).toBe(AppealDecision.Overturned)
    expect(appeal.toSnapshot()).toMatchObject({
      resolvedByAccountId: 'moderador-1',
      resolvedAt,
      resolutionNotes: 'La causal citada no esta respaldada por el registro de chat.',
    })
  })

  it('rechaza resolver dos veces la misma apelacion', () => {
    const appeal = submitted()

    appeal.resolve({
      decision: AppealDecision.Upheld,
      notes: 'La sancion esta debidamente fundamentada.',
      resolvedByAccountId: 'moderador-1',
      resolvedAt: new Date('2026-10-10T09:00:00.000Z'),
    })

    expect(() => {
      appeal.resolve({
        decision: AppealDecision.Overturned,
        notes: 'Cambio de opinion.',
        resolvedByAccountId: 'moderador-2',
        resolvedAt: new Date('2026-10-11T09:00:00.000Z'),
      })
    }).toThrow(DomainError)
  })

  it('rechaza una resolucion sin justificacion', () => {
    const appeal = submitted()

    expect(() => {
      appeal.resolve({
        decision: AppealDecision.Upheld,
        notes: '   ',
        resolvedByAccountId: 'moderador-1',
        resolvedAt: new Date('2026-10-10T09:00:00.000Z'),
      })
    }).toThrow(DomainError)
  })

  it('isOverdue es verdadero solo despues del plazo y mientras no se resuelva', () => {
    const appeal = submitted()

    expect(appeal.isOverdue(new Date('2026-10-20T12:00:00.000Z'))).toBe(false)
    expect(appeal.isOverdue(new Date('2026-10-27T12:00:00.000Z'))).toBe(true)

    appeal.resolve({
      decision: AppealDecision.Upheld,
      notes: 'Resuelta.',
      resolvedByAccountId: 'moderador-1',
      resolvedAt: new Date('2026-10-30T12:00:00.000Z'),
    })

    expect(appeal.isOverdue(new Date('2026-10-30T12:00:01.000Z'))).toBe(false)
  })

  it('restore reconstruye una apelacion ya resuelta sin emitir efectos', () => {
    const restored = Appeal.restore({
      id: 'appeal-3',
      sanctionId: 'sanction-2',
      accountId: 'account-2',
      statement: 'Justificacion persistida.',
      submittedAt: SUBMITTED_AT,
      decisionDueAt: new Date('2026-10-26T12:00:00.000Z'),
      status: AppealStatus.Resolved,
      decision: AppealDecision.Upheld,
      resolutionNotes: 'Motivo persistido.',
      resolvedByAccountId: 'admin-1',
      resolvedAt: new Date('2026-10-12T12:00:00.000Z'),
    })

    expect(restored.isResolved).toBe(true)
    expect(restored.currentDecision).toBe(AppealDecision.Upheld)
  })
})
