import * as Sentry from '@sentry/node';

const SENSITIVE_FIELD = /authorization|cookie|password|secret|token|api[-_]?key|otp|email|phone/i;

export function scrubSentryEvent<T>(event: T): T {
  return scrubValue(event) as T;
}

function scrubValue(value: unknown, key?: string): unknown {
  if (key && SENSITIVE_FIELD.test(key)) {
    return '[Filtered]';
  }

  if (key === 'query_string') {
    return undefined;
  }

  if (key === 'url' && typeof value === 'string') {
    return value.replace(/[?#].*$/, '');
  }

  if (Array.isArray(value)) {
    return value.map((item) => scrubValue(item));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).flatMap(([entryKey, entryValue]) => {
        const scrubbedValue = scrubValue(entryValue, entryKey);
        return scrubbedValue === undefined ? [] : [[entryKey, scrubbedValue]];
      }),
    );
  }

  return value;
}

export function initializeSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    return;
  }

  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
    release: process.env.SENTRY_RELEASE || `hamplard-backend@${process.env.npm_package_version || '0.1.0'}`,
    beforeSend: (event) => scrubSentryEvent(event),
  });
}// logger.module.ts
import { Module } from '@nestjs/common';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';

const VALID_LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'];

// Request/response fields that must never reach the logs verbatim.
const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'req.body.signature',
  'req.body.signedNonce',
  'req.body.totpCode',
  'req.body.code',
  'req.body.password',
  'req.body.secret',
  'req.body.twoFactorSecret',
  'req.body.recoveryCodes',
  'req.body.accessToken',
  '*.password',
  '*.secret',
  '*.accessToken',
  '*.twoFactorSecret',
  '*.twoFactorRecoveryCodes',
];

function resolveLogLevel(config: ConfigService, nodeEnv: string): string {
  const defaultLevel = nodeEnv === 'production' ? 'info' : 'debug';
  const configured = config.get<string>('LOG_LEVEL');
  if (!configured) return defaultLevel;

  if (!VALID_LOG_LEVELS.includes(configured)) {
    // eslint-disable-next-line no-console
    console.warn(
      `[LoggerModule] Invalid LOG_LEVEL "${configured}" for environment "${nodeEnv}" — falling back to "${defaultLevel}". ` +
        `Valid levels: ${VALID_LOG_LEVELS.join(', ')}.`,
    );
    return defaultLevel;
  }

  return configured;
}

@Module({
  imports: [
    PinoLoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const nodeEnv = config.get<string>('NODE_ENV', 'development');
        const level = resolveLogLevel(config, nodeEnv);

        return {
          pinoHttp: {
            level,
            genReqId: (req: any, res: any) => {
              const existing = req.headers['x-correlation-id'];
              const correlationId = (Array.isArray(existing) ? existing[0] : existing) || randomUUID();
              res.setHeader('x-correlation-id', correlationId);
              return correlationId;
            },
            customProps: (req: any) => ({ correlationId: req.id }),
            redact: {
              paths: REDACTED_PATHS,
              censor: '[REDACTED]',
            },
            // No transport is configured — pino always emits newline-delimited JSON.
          },
        };
      },
    }),
  ],
  exports: [PinoLoggerModule],
})
export class LoggerModule {}
