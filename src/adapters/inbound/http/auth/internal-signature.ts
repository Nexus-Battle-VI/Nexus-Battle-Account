import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

export const INTERNAL_SERVICE_HEADER = 'x-internal-service'
export const INTERNAL_TIMESTAMP_HEADER = 'x-internal-timestamp'
export const INTERNAL_SIGNATURE_HEADER = 'x-internal-signature'

/** Ventana de aceptacion del sello de tiempo, en milisegundos. */
export const INTERNAL_CLOCK_SKEW_MS = 30_000

export interface CanonicalRequest {
  readonly service: string
  readonly method: string
  readonly path: string
  readonly timestamp: string
  /** Cuerpo ya interpretado. Se canonicaliza aqui, no antes. */
  readonly body: unknown
}

/**
 * Serializacion determinista del cuerpo, con las claves ordenadas.
 *
 * POR QUE NO SE FIRMAN LOS BYTES CRUDOS. Seria lo mas directo, pero obligaria a
 * capturar el cuerpo sin interpretar en el arranque de Nest y a que las dos
 * partes coincidieran hasta en los espacios. Con una forma canonica, quien
 * firma y quien verifica llegan al mismo texto partiendo del mismo objeto, sin
 * importar el orden de las claves ni el formato del JSON que viajo por el cable.
 *
 * Las claves se ordenan porque `JSON.stringify` respeta el orden de insercion:
 * dos objetos equivalentes con las claves en distinto orden produzirian firmas
 * distintas, y el rechazo no tendria ninguna explicacion visible.
 */
export const canonicalBody = (value: unknown): string => {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value ?? null)
  }

  if (Array.isArray(value)) {
    return `[${value.map(canonicalBody).join(',')}]`
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalBody(v)}`)

  return `{${entries.join(',')}}`
}

/**
 * Cadena canonica que se firma.
 *
 * SE FIRMA MAS QUE EL CUERPO, Y ESO ES EL PUNTO. Un secreto compartido enviado
 * tal cual en una cabecera demuestra que quien llama lo conoce, pero no ata la
 * peticion: interceptada una, sirve para cualquier otra ruta o metodo. Al
 * incluir metodo, ruta y resumen del cuerpo, una firma vale para UNA peticion
 * concreta y para ninguna otra.
 *
 * EL SEPARADOR ES `\n` Y CADA CAMPO VA EN SU LINEA. Concatenar sin separador
 * permitiria que dos peticiones distintas produjeran la misma cadena
 * -«/a» + «bc» y «/ab» + «c»-, y con ella la misma firma.
 *
 * El cuerpo entra como resumen SHA-256 de su forma canonica, no en claro: la
 * cadena queda de tamano fijo y no hay que decidir que hacer con cuerpos
 * grandes.
 */
export const canonicalString = (request: CanonicalRequest): string =>
  [
    request.service,
    request.method.toUpperCase(),
    request.path,
    request.timestamp,
    createHash('sha256').update(canonicalBody(request.body), 'utf8').digest('hex'),
  ].join('\n')

/** Firma HMAC-SHA256 en hexadecimal de la cadena canonica. */
export const signInternalRequest = (secret: string, request: CanonicalRequest): string =>
  createHmac('sha256', secret).update(canonicalString(request), 'utf8').digest('hex')

/**
 * Comparacion en tiempo constante.
 *
 * Un `===` sobre la firma se detiene en el primer caracter distinto, y ese
 * tiempo es medible: permite reconstruir la firma esperada byte a byte. La
 * longitud se compara antes porque `timingSafeEqual` la exige igual, y revelar
 * la longitud de un resumen de tamano fijo no revela nada.
 */
export const signatureMatches = (expected: string, received: string | undefined): boolean => {
  if (received === undefined) {
    return false
  }

  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(received, 'utf8')

  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * El sello de tiempo debe caer dentro de una ventana estrecha alrededor de
 * ahora. Es la defensa minima contra reenvio: sin ella, una peticion firmada
 * capturada valdria para siempre.
 *
 * La ventana es simetrica a proposito. Aceptar solo el pasado obligaria a que
 * los relojes de los dos servicios estuvieran perfectamente sincronizados, y un
 * adelanto de un segundo en quien llama rechazaria todas sus peticiones.
 */
export const timestampWithinWindow = (timestamp: string, now: Date, skewMs: number): boolean => {
  const sent = Number(timestamp)

  if (!Number.isFinite(sent)) {
    return false
  }

  return Math.abs(now.getTime() - sent) <= skewMs
}
