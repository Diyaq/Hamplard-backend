import {
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { OAuth2Client, TokenPayload } from 'google-auth-library';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RefreshTokenService } from './refresh-token.service';
import { SessionsService, DeviceMetadata } from './sessions.service';
import { toSafeUser } from '../users/user-serializer';

export interface GoogleIdentity {
  googleId: string;
  email: string;
  emailVerified: boolean;
  name?: string;
  avatarUrl?: string;
}

@Injectable()
export class GoogleAuthService {
  private readonly logger = new Logger(GoogleAuthService.name);
  private readonly googleClient?: OAuth2Client;
  private readonly clientId?: string;
  private readonly oauthStates = new Map<string, number>();
  readonly enabled: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly sessions: SessionsService,
    private readonly refreshTokens: RefreshTokenService,
    config: ConfigService,
  ) {
    this.clientId = config.get<string>('GOOGLE_CLIENT_ID');
    this.enabled = Boolean(this.clientId && config.get<string>('GOOGLE_CLIENT_SECRET'));
    if (!this.enabled) {
      this.logger.warn(
        'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set — Google authentication is disabled',
      );
      return;
    }
    this.googleClient = new OAuth2Client(this.clientId);
  }

  /** Throws 503 when Google credentials are not configured. */
  assertEnabled(): void {
    if (!this.enabled) {
      throw new ServiceUnavailableException('Google authentication is not configured');
    }
  }

  createOAuthState(): string {
    const state = randomBytes(32).toString('hex');
    this.oauthStates.set(state, Date.now() + 5 * 60 * 1000);
    return state;
  }

  consumeOAuthState(state: string): boolean {
    const expiresAt = this.oauthStates.get(state);
    this.oauthStates.delete(state);
    return Boolean(expiresAt && Date.now() <= expiresAt);
  }

  async verifyIdToken(idToken: string): Promise<GoogleIdentity> {
    this.assertEnabled();

    let payload: TokenPayload | undefined;
    try {
      const ticket = await this.googleClient!.verifyIdToken({ idToken, audience: this.clientId });
      payload = ticket.getPayload();
    } catch {
      throw new UnauthorizedException('Invalid Google ID token');
    }

    const validIssuer = payload?.iss === 'accounts.google.com' || payload?.iss === 'https://accounts.google.com';
    if (!payload?.sub || !payload.email || !payload.email_verified || !validIssuer) {
      throw new UnauthorizedException('Invalid Google identity');
    }

    return {
      googleId: payload.sub,
      email: payload.email.toLowerCase(),
      emailVerified: payload.email_verified,
      name: payload.name,
      avatarUrl: payload.picture,
    };
  }

  async loginWithIdToken(idToken: string, deviceMeta?: DeviceMetadata) {
    return this.login(await this.verifyIdToken(idToken), deviceMeta);
  }

  async login(identity: GoogleIdentity, deviceMeta?: DeviceMetadata) {
    if (!identity.emailVerified) {
      throw new UnauthorizedException('A verified Google email is required');
    }

    const existingByGoogle = await this.prisma.user.findUnique({
      where: { googleId: identity.googleId },
    });
    const existingByEmail = existingByGoogle
      ? null
      : await this.prisma.user.findUnique({ where: { email: identity.email } });
    const existing = existingByGoogle ?? existingByEmail;

    try {
      const user = existing
        ? await this.prisma.user.update({
            where: { id: existing.id },
            data: {
              googleId: identity.googleId,
              email: existing.email ?? identity.email,
              name: existing.name ?? identity.name,
              avatarUrl: existing.avatarUrl ?? identity.avatarUrl,
            },
          })
        : await this.prisma.user.create({
            data: {
              googleId: identity.googleId,
              email: identity.email,
              name: identity.name,
              avatarUrl: identity.avatarUrl,
              role: 'STUDENT',
            },
          });

      const tokens = await this.refreshTokens.issueTokenPair(user);
      const decoded = this.jwt.decode(tokens.accessToken) as { exp?: number; jti?: string } | null;
      if (decoded?.jti) {
        const expiresAt = decoded.exp
          ? new Date(decoded.exp * 1000)
          : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        await this.sessions.createSession({
          userId: user.id,
          jti: decoded.jti,
          expiresAt,
          meta: deviceMeta,
        });
      }

      // Issue #234 — never return the TOTP secret or recovery-code hashes
      return { ...tokens, user: toSafeUser(user) };
    } catch (error) {
      if (error?.code === 'P2002') {
        throw new ConflictException('Google account is already linked to another user');
      }
      throw error;
    }
  }
}
