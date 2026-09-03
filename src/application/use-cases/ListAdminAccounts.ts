import { AccountStatus } from '../../domain/entities/AccountStatus'
import type { AdminAccountQueryCriteria } from '../dto/AdminAccountQueryCriteria'
import type {
  AdminAccountListDto,
  AdminAccountSummaryDto,
  AdminAccountStatusCountsDto,
} from '../dto/AdminAccountSummaryDto'
import type { AdminAccountQueryPort } from '../ports/AdminAccountQueryPort'
import { AccountId } from '../../domain/value-objects/AccountId'
import { DisplayName } from '../../domain/value-objects/DisplayName'
import { EmailAddress } from '../../domain/value-objects/EmailAddress'
import { PersonName } from '../../domain/value-objects/PersonName'

export class ListAdminAccounts {
  constructor(private readonly accounts: AdminAccountQueryPort) {}

  async execute(criteria: AdminAccountQueryCriteria = {}): Promise<AdminAccountListDto> {
    const items = (await this.accounts.query(normalizeCriteria(criteria))).map(cloneSummary)

    return {
      items,
      statusCounts: countStatuses(items),
    }
  }
}

const normalizeCriteria = (criteria: AdminAccountQueryCriteria): AdminAccountQueryCriteria => ({
  ...(criteria.id === undefined ? {} : { id: AccountId.create(criteria.id).value }),
  ...(criteria.email === undefined ? {} : { email: EmailAddress.create(criteria.email).value }),
  ...(criteria.firstNames === undefined
    ? {}
    : { firstNames: PersonName.create(criteria.firstNames, 'Los nombres').value }),
  ...(criteria.lastNames === undefined
    ? {}
    : { lastNames: PersonName.create(criteria.lastNames, 'Los apellidos').value }),
  ...(criteria.displayName === undefined
    ? {}
    : { displayName: DisplayName.create(criteria.displayName).value }),
  ...(criteria.role === undefined ? {} : { role: criteria.role }),
  ...(criteria.status === undefined ? {} : { status: criteria.status }),
})

const cloneSummary = (item: AdminAccountSummaryDto): AdminAccountSummaryDto => ({
  ...item,
  roles: [...item.roles],
})

const countStatuses = (items: readonly AdminAccountSummaryDto[]): AdminAccountStatusCountsDto => ({
  pendingVerification: items.filter((item) => item.status === AccountStatus.PendingVerification)
    .length,
  active: items.filter((item) => item.status === AccountStatus.Active).length,
  suspended: items.filter((item) => item.status === AccountStatus.Suspended).length,
})
