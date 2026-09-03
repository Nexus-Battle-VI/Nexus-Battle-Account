import type { Config } from 'jest'

/**
 * Jest sobre CommonJS, que es el formato de salida del Nest CLI 11.
 * La transformacion la realiza ts-jest con TypeScript 5.9.
 */
const shared = {
  rootDir: '.',
  testEnvironment: 'node',
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
} as const

const config: Config = {
  projects: [
    {
      ...shared,
      displayName: 'unit',
      testMatch: ['<rootDir>/test/unit/**/*.spec.ts'],
    },
    {
      ...shared,
      displayName: 'integration',
      testMatch: ['<rootDir>/test/integration/**/*.spec.ts'],
    },
  ],
  // El adaptador de PostgreSQL y su infraestructura NO los ejercita esta suite:
  // los cubre `npm run test:db`, que mide su propia cobertura con su propio
  // umbral. Se excluyen aqui para que el porcentaje describa lo que esta suite
  // realmente puede ver, en lugar de penalizar codigo que si esta probado.
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.module.ts',
    '!src/**/index.ts',
    '!src/main.ts',
    '!src/adapters/outbound/persistence/Postgres*.ts',
    '!src/adapters/outbound/persistence/migrations/hu01-registration.ts',
    '!src/adapters/outbound/persistence/migrations/hu02-nickname-blacklist-seed.ts',
    '!src/infrastructure/persistence/**',
    // `process-account-deletions.ts` es un punto de entrada de CLI (HU-43.3),
    // igual que `migrate.ts`: no hay nada que una prueba unitaria/de
    // integracion pueda ejercitar sin una base de datos real.
    '!src/infrastructure/jobs/**',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text-summary', 'lcov', 'json-summary'],
  coverageThreshold: {
    global: { branches: 80, functions: 80, lines: 80, statements: 80 },
  },
}

export default config
