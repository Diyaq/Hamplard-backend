// user-serializer.ts — issue #234: strip 2FA secrets from every user payload
import { User } from '@prisma/client';

/** Fields that must never leave the server in any user response. */
export const USER_SECRET_FIELDS = ['twoFactorSecret', 'twoFactorRecoveryCodes'] as const;

export type UserSecretField = (typeof USER_SECRET_FIELDS)[number];

export type SafeUser<T extends Partial<User> = User> = Omit<T, UserSecretField>;

/**
 * Returns a shallow copy of `user` without the TOTP secret or the hashed
 * recovery codes. Safe to call on partial selects and on records that carry
 * included relations.
 */
export function toSafeUser<T extends Partial<User>>(user: T): SafeUser<T> {
  const safe: Record<string, unknown> = { ...user };
  for (const field of USER_SECRET_FIELDS) {
    delete safe[field];
  }
  return safe as SafeUser<T>;
}
