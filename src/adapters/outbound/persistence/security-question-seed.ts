/**
 * Catalogo inicial de preguntas de seguridad (HU-01).
 *
 * Vive en el adaptador de persistencia, no en el dominio: una migracion no
 * puede importar el dominio, y el texto es dato de semilla, no una regla.
 */
export const SECURITY_QUESTION_SEED = [
  { id: 'sq-01', statement: '¿Cuál era el nombre de tu primera mascota?' },
  { id: 'sq-02', statement: '¿Cuál es el nombre de la ciudad donde naciste?' },
  { id: 'sq-03', statement: '¿Cuál era tu apodo de la infancia?' },
  { id: 'sq-04', statement: '¿Cuál es el nombre de la ciudad donde se conocieron tus padres?' },
] as const
