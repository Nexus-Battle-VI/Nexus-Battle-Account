import type { AdminAccountExportFileDto } from '../dto/AdminAccountExportFileDto'
import type { AdminAccountSummaryDto } from '../dto/AdminAccountSummaryDto'

export interface AdminAccountExportPort {
  generate(accounts: readonly AdminAccountSummaryDto[]): Promise<AdminAccountExportFileDto>
}

export const ADMIN_ACCOUNT_EXPORT = Symbol('AdminAccountExportPort')
