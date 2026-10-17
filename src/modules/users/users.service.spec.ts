import { NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { UsersService } from './users.service';
import { PUBLIC_USER_SELECT } from './dto/public-user.dto';
import { toSafeUser } from './user-serializer';

const SENSITIVE_PUBLIC_FIELDS = [
  'id',
  'email',
  'phoneNumber',
  'phoneCountryCode',
  'googleId',
  'twoFactorSecret',
  'twoFactorRecoveryCodes',
  'banReason',
  'isBanned',
  'suspensionReason',
  'isSuspended',
];

/** A full user row as Prisma would return it without a projection. */
const FULL_USER = {
  id: 'user-1',
  stellarAddress: 'GABC',
  googleId: 'google-123',
  email: 'jane@example.com',
  name: 'Jane',
  bio: 'Tailor and teacher',
  avatarUrl: 'https://example.com/jane.png',
  role: UserRole.INSTRUCTOR,
  isVerified: true,
  phoneNumber: '+2348000000000',
  phoneCountryCode: 'NG',
  isBanned: false,
  banReason: 'old ban note',
  isSuspended: false,
  suspensionReason: 'old suspension note',
  twoFactorSecret: 'JBSWY3DPEHPK3PXP',
  twoFactorEnabled: true,
  twoFactorRecoveryCodes: ['$2b$10$hash1', '$2b$10$hash2'],
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-02T00:00:00Z'),
};

describe('UsersService', () => {
  const prisma = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    adminAuditLog: { create: jest.fn() },
  };

  let service: UsersService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new UsersService(prisma as any);
  });

  describe('toSafeUser() (issue #234)', () => {
    it('removes twoFactorSecret and twoFactorRecoveryCodes and keeps other fields', () => {
      const safe = service.toSafeUser(FULL_USER);

      expect(safe).not.toHaveProperty('twoFactorSecret');
      expect(safe).not.toHaveProperty('twoFactorRecoveryCodes');
      expect(safe).toMatchObject({ id: 'user-1', email: 'jane@example.com', twoFactorEnabled: true });
    });

    it('does not mutate the source record', () => {
      const source = { ...FULL_USER };
      toSafeUser(source);

      expect(source.twoFactorSecret).toBe(FULL_USER.twoFactorSecret);
    });
  });

  describe('getPublicProfile() (issue #233)', () => {
    it('queries with the explicit public projection only', async () => {
      prisma.user.findUnique.mockResolvedValue({
        stellarAddress: 'GABC',
        name: 'Jane',
        bio: 'Tailor and teacher',
        avatarUrl: 'https://example.com/jane.png',
        role: UserRole.INSTRUCTOR,
        isVerified: true,
        createdAt: FULL_USER.createdAt,
        _count: { coursesCreated: 4, certificates: 2 },
      });

      await service.getPublicProfile('GABC');

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { stellarAddress: 'GABC' },
        select: PUBLIC_USER_SELECT,
      });
      for (const field of SENSITIVE_PUBLIC_FIELDS) {
        expect(PUBLIC_USER_SELECT).not.toHaveProperty(field);
      }
    });

    it('returns only whitelisted fields even if the DB layer returns extra columns', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...FULL_USER,
        _count: { coursesCreated: 4, certificates: 2 },
      });

      const profile = await service.getPublicProfile('GABC');

      expect(profile).toEqual({
        stellarAddress: 'GABC',
        name: 'Jane',
        bio: 'Tailor and teacher',
        avatarUrl: 'https://example.com/jane.png',
        role: UserRole.INSTRUCTOR,
        isVerified: true,
        createdAt: FULL_USER.createdAt,
        stats: { coursesCreated: 4, certificatesEarned: 2 },
      });
      for (const field of SENSITIVE_PUBLIC_FIELDS) {
        expect(profile).not.toHaveProperty(field);
      }
    });

    it('throws NotFoundException for an unknown address', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.getPublicProfile('GUNKNOWN')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('getMe / updateMe payloads (issue #234)', () => {
    it('findById() omits 2FA secrets', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...FULL_USER,
        enrollments: [],
        certificates: [],
        coursesCreated: [],
      });

      const me = await service.findById('user-1');

      expect(me).not.toHaveProperty('twoFactorSecret');
      expect(me).not.toHaveProperty('twoFactorRecoveryCodes');
      expect(me.twoFactorEnabled).toBe(true);
    });

    it('updateProfile() omits 2FA secrets', async () => {
      prisma.user.update.mockResolvedValue({ ...FULL_USER, name: 'Jane Updated' });

      const updated = await service.updateProfile('user-1', { name: 'Jane Updated' });

      expect(updated.name).toBe('Jane Updated');
      expect(updated).not.toHaveProperty('twoFactorSecret');
      expect(updated).not.toHaveProperty('twoFactorRecoveryCodes');
    });

    it('admin moderation responses omit 2FA secrets', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...FULL_USER, role: UserRole.STUDENT });
      prisma.user.update.mockResolvedValue({ ...FULL_USER, isBanned: true });

      const banned = await service.banUser('user-1', 'admin-1', 'spam');

      expect(banned).not.toHaveProperty('twoFactorSecret');
      expect(banned).not.toHaveProperty('twoFactorRecoveryCodes');
    });
  });
});
