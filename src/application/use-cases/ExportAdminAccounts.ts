import type { AdminAccountExportFileDto } from '../dto/AdminAccountExportFileDto'
import type { AdminAccountQueryCriteria } from '../dto/AdminAccountQueryCriteria'
import type { AdminAccountExportPort } from '../ports/AdminAccountExportPort'
import type { ListAdminAccounts } from './ListAdminAccounts'

export class ExportAdminAccounts {
  constructor(
    private readonly listAdminAccounts: ListAdminAccounts,
    private readonly exporter: AdminAccountExportPort,
  ) {}

  async execute(criteria: AdminAccountQueryCriteria = {}): Promise<AdminAccountExportFileDto> {
    const list = await this.listAdminAccounts.execute(criteria)

    return this.exporter.generate(list.items)
  }
}
