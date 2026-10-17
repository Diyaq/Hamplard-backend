import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth.module';
import { AuthService } from './auth.service';
import { RefreshTokenService } from './refresh-token.service';
import { TwoFactorService } from './two-factor.service';
import { TwoFactorController } from './two-factor.controller';
import { SessionsService } from './sessions.service';
import { GoogleAuthService } from './google-auth.service';
import { GoogleStrategy } from './google.strategy';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { NotificationsService } from '../notifications/notifications.service';

// Replaces the real NotificationsModule so no BullMQ/Redis connection is opened.
@Module({
  providers: [{ provide: NotificationsService, useValue: {} }],
  exports: [NotificationsService],
})
class StubNotificationsModule {}

/**
 * Composition test (#220): compiles the real AuthModule with only external
 * dependencies mocked, so a provider that is injected but never registered
 * fails here instead of at application boot.
 */
describe('AuthModule composition', () => {
  const env = { ...process.env };

  beforeAll(() => {
    process.env.JWT_SECRET = 'test-secret';
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  });

  afterAll(() => {
    process.env = env;
  });

  const compile = () =>
    Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        PrismaModule,
        AuthModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue({ user: {}, session: {}, $connect: jest.fn(), $disconnect: jest.fn() })
      .overrideModule(NotificationsModule)
      .useModule(StubNotificationsModule)
      .compile();

  it('compiles and wires AuthService with RefreshTokenService and TwoFactorService', async () => {
    const moduleRef = await compile();

    expect(moduleRef.get(AuthService)).toBeDefined();
    expect(moduleRef.get(RefreshTokenService)).toBeInstanceOf(RefreshTokenService);
    expect(moduleRef.get(TwoFactorService)).toBeInstanceOf(TwoFactorService);
    expect(moduleRef.get(SessionsService)).toBeDefined();
  });

  it('registers TwoFactorController so /auth/2fa routes exist', async () => {
    const moduleRef = await compile();

    expect(moduleRef.get(TwoFactorController)).toBeInstanceOf(TwoFactorController);
    const routes = ['setup', 'enable', 'disable', 'status'];
    for (const handler of routes) {
      expect(typeof (TwoFactorController.prototype as any)[handler]).toBe('function');
    }
  });

  it('registers the Google strategy when credentials are configured', async () => {
    const moduleRef = await compile();

    expect(moduleRef.get(GoogleAuthService).enabled).toBe(true);
    expect(moduleRef.get(GoogleStrategy)).toBeInstanceOf(GoogleStrategy);
  });

  it('boots without Google credentials and leaves Google auth disabled', async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    try {
      const moduleRef = await compile();

      expect(moduleRef.get(AuthService)).toBeDefined();
      expect(moduleRef.get(GoogleAuthService).enabled).toBe(false);
      expect(moduleRef.get(GoogleStrategy)).toBeNull();
    } finally {
      process.env.GOOGLE_CLIENT_ID = 'test-client-id';
      process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
    }
  });
});
