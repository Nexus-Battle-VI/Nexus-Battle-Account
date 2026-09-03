import type { AdminAccountExportFileDto } from '../../../application/dto/AdminAccountExportFileDto'
import type { AdminAccountSummaryDto } from '../../../application/dto/AdminAccountSummaryDto'
import type { AdminAccountExportPort } from '../../../application/ports/AdminAccountExportPort'

type ExportableAdminAccount = Pick<
  AdminAccountSummaryDto,
  | 'id'
  | 'email'
  | 'displayName'
  | 'countryCode'
  | 'firstNames'
  | 'lastNames'
  | 'status'
  | 'roles'
  | 'registeredAt'
>

const FILENAME = 'nexus-battles-users.json'
const MEDIA_TYPE = 'application/json; charset=utf-8'

export class JsonAdminAccountExportAdapter implements AdminAccountExportPort {
  generate(accounts: readonly AdminAccountSummaryDto[]): Promise<AdminAccountExportFileDto> {
    const exportable = accounts.map(toExportableAccount)

    return Promise.resolve({
      filename: FILENAME,
      mediaType: MEDIA_TYPE,
      content: JSON.stringify(exportable, null, 2),
    })
  }
}

const toExportableAccount = (account: AdminAccountSummaryDto): ExportableAdminAccount => ({
  id: account.id,
  email: account.email,
  displayName: account.displayName,
  countryCode: account.countryCode,
  firstNames: account.firstNames,
  lastNames: account.lastNames,
  status: account.status,
  roles: [...account.roles],
  registeredAt: account.registeredAt,
})
