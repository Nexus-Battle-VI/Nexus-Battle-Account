/**
 * Calculo de dias habiles para el plazo de resolucion de apelaciones (HU-42,
 * PDF "Proyecto Integrador II" v1.26.10 §7.3.2: "notificacion de la decision
 * final en un plazo de 15 dias habiles").
 *
 * DECISION PROVISIONAL, PENDIENTE DE APROBACION: solo excluye sabado y
 * domingo. El documento no fija un calendario de festivos, y el prompt de
 * cierre de HU-42 prohibe explicitamente inventar uno. `decisionDueAt` es por
 * tanto una fecha de referencia para reportar si una apelacion esta vencida,
 * no una regla que el sistema haga cumplir de forma dura -nada le impide
 * tecnicamente a un panel resolver despues-. Si el equipo aprueba un
 * calendario de festivos, esta es la unica funcion que debe cambiar.
 */
export const addBusinessDays = (from: Date, businessDays: number): Date => {
  const result = new Date(from.getTime())
  let remaining = businessDays

  while (remaining > 0) {
    result.setUTCDate(result.getUTCDate() + 1)

    const dayOfWeek = result.getUTCDay()
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6

    if (!isWeekend) {
      remaining -= 1
    }
  }

  return result
}
