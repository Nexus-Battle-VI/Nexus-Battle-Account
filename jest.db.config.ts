import type { Config } from 'jest'

/**
 * Pruebas que necesitan una base de datos real, en su propia configuracion.
 *
 * Estan separadas de `jest.config.ts` a proposito: levantan PostgreSQL en un
 * contenedor con Testcontainers, y meterlas en la suite por defecto obligaria a
 * tener Docker a cualquiera que ejecute `npm test`. Quien trabaje en el dominio
 * o en los casos de uso no deberia necesitarlo.
 *
 * El CI ejecuta ambas: `npm test` y `npm run test:db`.
 */
const config: Config = {
  rootDir: '.',
  displayName: 'db',
  testEnvironment: 'node',
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
  testMatch: ['<rootDir>/test/db/**/*.spec.ts'],
  // Arrancar la imagen de PostgreSQL la primera vez puede tardar bastante mas
  // que el limite por defecto de Jest.
  testTimeout: 120_000,
}

export default config
