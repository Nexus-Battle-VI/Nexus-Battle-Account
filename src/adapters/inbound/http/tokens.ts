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
export const UPDATE_OWN_ACCOUNT = Symbol('UpdateOwnAccount')
export const CHANGE_OWN_PASSWORD = Symbol('ChangeOwnPassword')
export const VERIFY_ACCOUNT = Symbol('VerifyAccount')
export const CONFIRM_REGISTRATION = Symbol('ConfirmRegistration')
export const LOGIN_ACCOUNT = Symbol('LoginAccount')
export const COMPLETE_SECOND_FACTOR = Symbol('CompleteSecondFactor')
export const CHOOSE_SECOND_FACTOR = Symbol('ChooseSecondFactor')
export const ENROLL_TOTP = Symbol('EnrollTotp')
export const CONFIRM_TOTP_ENROLLMENT = Symbol('ConfirmTotpEnrollment')
export const FIND_ACCOUNT_BY_EMAIL = Symbol('FindAccountByEmail')
export const ASSIGN_ROLE = Symbol('AssignRole')
export const REVOKE_ROLE = Symbol('RevokeRole')
export const LOGOUT_ACCOUNT = Symbol('LogoutAccount')
export const START_PASSWORD_RECOVERY = Symbol('StartPasswordRecovery')
export const VERIFY_RECOVERY_ANSWERS = Symbol('VerifyRecoveryAnswers')
export const VERIFY_RECOVERY_CODE = Symbol('VerifyRecoveryCode')
export const RESET_RECOVERY_PASSWORD = Symbol('ResetRecoveryPassword')
export const VERIFY_MFA_EVIDENCE = Symbol('VerifyMfaEvidence')
export const LIST_ADMIN_ACCOUNTS = Symbol('ListAdminAccounts')
export const EXPORT_ADMIN_ACCOUNTS = Symbol('ExportAdminAccounts')
export const REQUEST_ACCOUNT_DELETION = Symbol('RequestAccountDeletion')
/** Sin ruta HTTP propia: lo invoca `AccountDeletionProcessingScheduler` (HU-43.3). */
export const PROCESS_ACCOUNT_DELETION = Symbol('ProcessAccountDeletion')
