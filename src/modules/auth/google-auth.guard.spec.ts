import { ExecutionContext, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { GoogleAuthGuard } from './google-auth.guard';

describe('GoogleAuthGuard', () => {
  const buildContext = (path: string, query: Record<string, string> = {}, cookie?: string) => {
    const response = { cookie: jest.fn(), clearCookie: jest.fn() };
    const request = { path, query, headers: { cookie } };
    return {
      switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
    } as unknown as ExecutionContext;
  };

  describe('when Google auth is disabled', () => {
    const googleAuth = {
      assertEnabled: jest.fn(() => {
        throw new ServiceUnavailableException('Google authentication is not configured');
      }),
      consumeOAuthState: jest.fn(),
    };
    const guard = new GoogleAuthGuard(googleAuth as any);

    it.each(['/api/v1/auth/google', '/api/v1/auth/google/callback'])(
      'rejects %s with 503 before invoking Passport',
      (path) => {
        expect(() => guard.canActivate(buildContext(path, { state: 's' }, 'google_oauth_state=s'))).toThrow(
          new ServiceUnavailableException('Google authentication is not configured'),
        );
        expect(googleAuth.consumeOAuthState).not.toHaveBeenCalled();
      },
    );
  });

  describe('when Google auth is enabled', () => {
    const googleAuth = {
      assertEnabled: jest.fn(),
      consumeOAuthState: jest.fn().mockReturnValue(false),
    };
    const guard = new GoogleAuthGuard(googleAuth as any);

    it('still validates the OAuth state on the callback', () => {
      expect(() =>
        guard.canActivate(buildContext('/api/v1/auth/google/callback', { state: 's' }, 'google_oauth_state=other')),
      ).toThrow(UnauthorizedException);
      expect(googleAuth.assertEnabled).toHaveBeenCalled();
    });
  });
});
