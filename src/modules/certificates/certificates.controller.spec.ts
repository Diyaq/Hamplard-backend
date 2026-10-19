import { Test, TestingModule } from '@nestjs/testing';
import {
  ExecutionContext,
  ForbiddenException,
  INestApplication,
  UnauthorizedException,
} from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import * as request from 'supertest';
import { UserRole } from '@prisma/client';
import { CertificatesController } from './certificates.controller';
import { CertificatesService } from './certificates.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';

/** Issue #245 — PDF streaming, owner restriction and public verification. */
describe('CertificatesController (HTTP)', () => {
  let app: INestApplication;

  const mockService = {
    getPdfForDownload: jest.fn(),
    verify: jest.fn(),
    findById: jest.fn(),
  };

  const STUDENT = { id: 'student-1', stellarAddress: 'GABC', role: UserRole.STUDENT };

  // Stand-in for JwtAuthGuard: no bearer token → 401, otherwise attach a user.
  const mockJwtGuard = {
    canActivate: jest.fn((context: ExecutionContext) => {
      const req = context.switchToHttp().getRequest();
      if (!req.headers.authorization) throw new UnauthorizedException();
      req.user = STUDENT;
      return true;
    }),
  };

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [CertificatesController],
      providers: [{ provide: CertificatesService, useValue: mockService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(mockJwtGuard)
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /certificates/:id/download', () => {
    it('streams the PDF with attachment headers to the certificate owner', async () => {
      const pdf = Buffer.from('%PDF-1.4 certificate body');
      mockService.getPdfForDownload.mockResolvedValue({
        buffer: pdf,
        filename: 'certificate-CERT-ABC123.pdf',
      });

      const res = await request(app.getHttpServer())
        .get('/certificates/CERT-ABC123/download')
        .set('Authorization', 'Bearer token')
        .buffer(true)
        .parse((response, callback) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('end', () => callback(null, Buffer.concat(chunks)));
        })
        .expect(200);

      expect(res.headers['content-type']).toContain('application/pdf');
      expect(res.headers['content-disposition']).toBe(
        'attachment; filename="certificate-CERT-ABC123.pdf"',
      );
      expect(Buffer.compare(res.body, pdf)).toBe(0);
      expect(mockService.getPdfForDownload).toHaveBeenCalledWith('CERT-ABC123', STUDENT);
    });

    it('returns 403 when the caller is not the holder or an admin', async () => {
      mockService.getPdfForDownload.mockRejectedValue(
        new ForbiddenException('Only the certificate holder or an admin can download this certificate'),
      );

      const res = await request(app.getHttpServer())
        .get('/certificates/CERT-ABC123/download')
        .set('Authorization', 'Bearer token')
        .expect(403);

      expect(res.headers['content-type']).not.toContain('application/pdf');
    });

    it('returns 401 for anonymous callers', async () => {
      await request(app.getHttpServer()).get('/certificates/CERT-ABC123/download').expect(401);
      expect(mockService.getPdfForDownload).not.toHaveBeenCalled();
    });
  });

  describe('public verification', () => {
    it('GET /certificates/verify/:id needs no authentication', async () => {
      mockService.verify.mockResolvedValue({ valid: true, certificate: { id: 'CERT-ABC123' } });

      const res = await request(app.getHttpServer())
        .get('/certificates/verify/CERT-ABC123')
        .expect(200);

      expect(res.body.valid).toBe(true);
      expect(mockJwtGuard.canActivate).not.toHaveBeenCalled();
    });

    it('has no guards on the verify handler', () => {
      expect(
        Reflect.getMetadata(GUARDS_METADATA, CertificatesController.prototype.verify),
      ).toBeUndefined();
    });
  });
});
