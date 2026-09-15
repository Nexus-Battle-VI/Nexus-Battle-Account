/** Payload del contrato HeroSelectionDto de Player-Inventory (HU-07/HU-28).
 * Datos sintéticos de prueba; no constituyen estadísticas locales de producción.
 */
export const heroSelectionFixture = (name = 'Guerrera de Ana', power = 12) => ({
  selectedAt: '2026-09-02T18:45:30.000Z',
  configuration: {
    hero: {
      heroId: 'hero-warrior',
      reference: 'guerrera',
      subtype: 'WARRIOR',
      name,
      imageUrl: 'https://catalog.test/guerrera.png',
    },
    equipment: {
      weapons: [
        {
          slot: 'WEAPON_1',
          itemId: 'espada',
          productId: 'product-sword',
          name: 'Espada',
          imageUrl: 'https://catalog.test/espada.png',
          type: 'ARMA',
          lifecycleStatus: 'ACTIVE',
        },
      ],
      armor: {},
      items: [],
    },
    baseStats: {
      power,
      health: 100,
      defense: 8,
      attack: 15,
      damage: { mode: 'DICE' as const, count: 2, sides: 6 },
      healing: { mode: 'FIXED' as const, amount: 3 },
    },
    effectiveStats: {
      power: power + 4,
      health: 100,
      defense: 8,
      attack: 15,
      damage: { mode: 'DICE' as const, count: 2, sides: 6 },
      healing: { mode: 'FIXED' as const, amount: 3 },
    },
    deltas: [{ statistic: 'POWER', base: power, effective: power + 4, delta: 4 }],
    activeEffects: [
      {
        sourceSlot: 'WEAPON_1',
        sourceProductId: 'product-sword',
        sourceProductReference: 'espada',
        kind: 'STAT_MODIFIER',
        target: 'SELF',
        statistic: 'POWER',
        operation: 'INCREASE',
        magnitude: { mode: 'FIXED', amount: 4 },
        hasActivationCondition: false,
        appliedToStats: true,
        raw: {
          kind: 'STAT_MODIFIER',
          target: 'SELF',
          statistic: 'POWER',
          operation: 'INCREASE',
          magnitude: { mode: 'FIXED', amount: 4 },
        },
      },
    ],
  },
  readiness: { ready: true, blockers: [] },
  capacity: {
    weapons: { used: 1, max: 2 },
    armor: { used: 0, max: 6 },
    items: { used: 0, max: 2 },
  },
})

export const preparedStatisticsFixture = (name = 'Guerrera de Ana', power = 12) => {
  const { configuration, readiness } = heroSelectionFixture(name, power)
  return {
    hero: { name: configuration.hero.name, reference: configuration.hero.reference },
    baseStats: configuration.baseStats,
    effectiveStats: configuration.effectiveStats,
    deltas: configuration.deltas,
    ready: readiness.ready,
  }
}
