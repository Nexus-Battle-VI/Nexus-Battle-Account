import { migrationNames } from '../../src/infrastructure/persistence/database'

/**
 * El orden de las migraciones, que es lo que decide si el servicio arranca.
 *
 * Kysely ordena las migraciones alfabeticamente por su nombre y exige que las
 * ya ejecutadas sigan apareciendo en la misma posicion. Una migracion nueva
 * cuyo nombre quede ANTES que otra ya aplicada aborta el migrador con
 * `corrupted migrations`, y el servicio no llega a arrancar.
 *
 * Esta prueba existe porque eso paso en produccion: dos migraciones se
 * llamaron `hardening-mfa-evidence*`, y «hardening» va antes que «hu01». En
 * una base vacia -la de CI, la de un portatil recien clonado- se aplicaban sin
 * queja. Contra la base real, que ya tenia `hu01` a `hu04`, el contenedor se
 * quedaba en `Created` y Account desaparecia del despliegue.
 */
describe('Orden de las migraciones', () => {
  it('el orden declarado coincide con el alfabetico, que es el unico que Kysely respeta', async () => {
    const declaradas = await migrationNames()
    const alfabetico = [...declaradas].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))

    expect(declaradas).toEqual(alfabetico)
  })

  it('ninguna migracion nueva puede quedar antes de una ya aplicada en produccion', async () => {
    const declaradas = await migrationNames()
    const yaAplicadasEnProduccion = [
      '001-accounts',
      'hu01-registration',
      'hu02-nickname-blacklist-seed',
      'hu03-super-administrator-role',
      'hu04-recovery-challenges',
    ]

    // Las que ya corrieron deben seguir siendo el PREFIJO de la lista
    // ordenada. Si una nueva se cuela entre ellas, esta comparacion falla, que
    // es exactamente lo que Kysely comprueba al arrancar.
    expect(declaradas.slice(0, yaAplicadasEnProduccion.length)).toEqual(yaAplicadasEnProduccion)
  })

  /**
   * CONTROL de las dos anteriores. Sin el, «el orden es correcto» podria
   * cumplirse por casualidad y nadie sabria que la comprobacion detecta algo.
   * Este caso reproduce el nombre que rompio produccion y verifica que la regla
   * lo habria rechazado.
   */
  it('CONTROL: el nombre que rompio produccion habria fallado esta regla', () => {
    const conElNombreAntiguo = [
      '001-accounts',
      'hardening-mfa-evidence',
      'hu01-registration',
      'hu04-recovery-challenges',
    ]
    const yaAplicadas = ['001-accounts', 'hu01-registration']

    expect(conElNombreAntiguo.slice(0, yaAplicadas.length)).not.toEqual(yaAplicadas)
  })
})
