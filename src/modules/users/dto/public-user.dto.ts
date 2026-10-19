// public-user.dto.ts — issue #233: whitelisted shape for GET /users/:address/public
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Prisma, UserRole } from '@prisma/client';

/**
 * Explicit Prisma projection for public profiles. Anything not listed here
 * (email, phone, googleId, 2FA secrets, moderation fields, internal id) is
 * never read from the database for a public request.
 */
export const PUBLIC_USER_SELECT = {
  stellarAddress: true,
  name: true,
  bio: true,
  avatarUrl: true,
  role: true,
  isVerified: true,
  createdAt: true,
  _count: { select: { coursesCreated: true, certificates: true } },
} satisfies Prisma.UserSelect;

export type PublicUserRecord = Prisma.UserGetPayload<{ select: typeof PUBLIC_USER_SELECT }>;

export class PublicUserStatsDto {
  @ApiProperty({ example: 4 })
  coursesCreated: number;

  @ApiProperty({ example: 2 })
  certificatesEarned: number;
}

export class PublicUserDto {
  @ApiPropertyOptional({ example: 'GABC...' })
  stellarAddress: string | null;

  @ApiPropertyOptional({ example: 'Ada Lovelace' })
  name: string | null;

  @ApiPropertyOptional()
  bio: string | null;

  @ApiPropertyOptional()
  avatarUrl: string | null;

  @ApiProperty({ enum: UserRole })
  role: UserRole;

  @ApiProperty()
  isVerified: boolean;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({ type: PublicUserStatsDto })
  stats: PublicUserStatsDto;

  static fromRecord(record: PublicUserRecord): PublicUserDto {
    return {
      stellarAddress: record.stellarAddress,
      name: record.name,
      bio: record.bio,
      avatarUrl: record.avatarUrl,
      role: record.role,
      isVerified: record.isVerified,
      createdAt: record.createdAt,
      stats: {
        coursesCreated: record._count.coursesCreated,
        certificatesEarned: record._count.certificates,
      },
    };
  }
}
