import type { AdminAccountQueryCriteria } from '../dto/AdminAccountQueryCriteria'
import type { AdminAccountSummaryDto } from '../dto/AdminAccountSummaryDto'

export interface AdminAccountQueryPort {
  query(criteria: AdminAccountQueryCriteria): Promise<readonly AdminAccountSummaryDto[]>
}

export const ADMIN_ACCOUNT_QUERY = Symbol('AdminAccountQueryPort')
