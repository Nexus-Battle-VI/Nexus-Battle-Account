import { Account, type AccountSnapshot } from '../../../domain/entities/Account'
import { AccountId } from '../../../domain/value-objects/AccountId'
import { AvatarMetadata } from '../../../domain/value-objects/AvatarMetadata'
import { DisplayName } from '../../../domain/value-objects/DisplayName'
import { EmailAddress } from '../../../domain/value-objects/EmailAddress'
import { PersonName } from '../../../domain/value-objects/PersonName'

export const hydrateAccount = (snapshot: AccountSnapshot): Account =>
  Account.restore({
    id: AccountId.create(snapshot.id),
    subject: snapshot.subject,
    email: EmailAddress.create(snapshot.email),
    displayName: DisplayName.create(snapshot.displayName),
    firstNames: PersonName.create(snapshot.firstNames, 'Los nombres'),
    lastNames: PersonName.create(snapshot.lastNames, 'Los apellidos'),
    termsAccepted: snapshot.termsAccepted,
    avatar: AvatarMetadata.create({
      storageKey: snapshot.avatarStorageKey,
      mimeType: snapshot.avatarMimeType,
      sizeBytes: snapshot.avatarSizeBytes,
      originalName: snapshot.avatarOriginalName,
    }),
    status: snapshot.status,
    roles: snapshot.roles,
  })
