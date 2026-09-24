import { DomainError } from '../errors/DomainError'

/**
 * Idiomas de interfaz que la Web sabe presentar (HU-05, CA-04).
 *
 * Es una lista cerrada, no un BCP-47 libre: guardar `es-ES`, `EN` o cualquier
 * otra cadena obligaria a la Web a adivinar que significa, y un valor que
 * ningun cliente reconoce no es una preferencia sino ruido persistido.
 */
export const PREFERRED_LANGUAGES = ['es', 'en', 'fr', 'pt'] as const

export type PreferredLanguageCode = (typeof PREFERRED_LANGUAGES)[number]

const isPreferredLanguageCode = (value: string): value is PreferredLanguageCode =>
  (PREFERRED_LANGUAGES as readonly string[]).includes(value)

export class PreferredLanguage {
  private constructor(readonly value: PreferredLanguageCode) {}

  /**
   * Sin normalizacion a proposito: ni recorte ni minusculas. `' EN '` no es una
   * forma de escribir `en`, es un cliente que envia algo distinto a lo acordado.
   */
  static create(input: string): PreferredLanguage {
    if (!isPreferredLanguageCode(input)) {
      throw new DomainError(
        `El idioma preferido debe ser uno de: ${PREFERRED_LANGUAGES.join(', ')}.`,
      )
    }

    return new PreferredLanguage(input)
  }
}
