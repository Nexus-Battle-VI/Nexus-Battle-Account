/**
 * Tokens de inyeccion de los casos de uso.
 *
 * Los casos de uso son clases sin decoradores: no conocen NestJS. Se registran
 * mediante proveedores explicitos en el modulo, y estos simbolos son la unica
 * conexion entre el contenedor y la capa de aplicacion.
 */
export const REGISTER_ACCOUNT = Symbol('RegisterAccount')
export const GET_ACCOUNT = Symbol('GetAccount')
export const GET_OWN_ACCOUNT = Symbol('GetOwnAccount')
export const VERIFY_ACCOUNT = Symbol('VerifyAccount')
