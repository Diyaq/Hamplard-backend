import {
  Injectable, BadRequestException, Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuid } from 'uuid';
import { CdnAssetVisibility, CdnService, MediaDeliveryUrls } from './cdn.service';
import { VirusScanService } from './virus-scan.service';
import { VideoTranscodeService } from './video-transcode.service';
import { VideoThumbnailService, ThumbnailResult } from './video-thumbnail.service';

/** Allowed MIME types for KYC identity documents */
const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
];

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

export interface UploadResult extends MediaDeliveryUrls {
  /** @deprecated Prefer cdnUrl — kept for backward compatibility */
  url: string;
}

export interface VideoUploadResult {
  jobId: string;
  originUrl: string;
  thumbnail: ThumbnailResult;
}

@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);
  private readonly uploadDir: string;

  constructor(
    private readonly config: ConfigService,
    private readonly cdn: CdnService,
    private readonly virusScan: VirusScanService,
    private readonly videoTranscode: VideoTranscodeService,
    private readonly videoThumbnail: VideoThumbnailService,
  ) {
    this.uploadDir = this.config.get<string>('UPLOAD_DIR', './uploads');
    this.ensureDir(this.uploadDir);
    this.ensureDir(path.join(this.uploadDir, 'kyc'));
  }

  // ----------------------------------------------------------
  // KYC DOCUMENT UPLOAD
  // ----------------------------------------------------------

  /**
   * Validates and persists a KYC document file.
   * Returns CDN delivery URLs (private signed) plus origin path.
   */
  async saveKycDocument(
    file: Express.Multer.File,
    instructorId: string,
  ): Promise<UploadResult> {
    this.validateFile(file);

    const ext = path.extname(file.originalname).toLowerCase();
    const filename = `kyc-${instructorId}-${uuid()}${ext}`;

    await this.virusScan.scanFile(filename, file.buffer);

    const filePath = path.join(this.uploadDir, 'kyc', filename);

    fs.writeFileSync(filePath, file.buffer);
    this.logger.log(`KYC document saved: ${filePath}`);

    const originUrl = `/uploads/kyc/${filename}`;
    return this.toUploadResult(originUrl, 'private');
  }

  // ----------------------------------------------------------
  // GENERAL FILE UPLOAD (course thumbnails, resources, etc.)
  // ----------------------------------------------------------

  async saveFile(
    file: Express.Multer.File,
    subfolder: string,
    visibility: CdnAssetVisibility = 'public',
  ): Promise<UploadResult> {
    this.ensureDir(path.join(this.uploadDir, subfolder));

    const ext = path.extname(file.originalname).toLowerCase();
    const filename = `${uuid()}${ext}`;

    await this.virusScan.scanFile(filename, file.buffer);

    const filePath = path.join(this.uploadDir, subfolder, filename);

    fs.writeFileSync(filePath, file.buffer);
    this.logger.log(`File saved: ${filePath}`);

    const originUrl = `/uploads/${subfolder}/${filename}`;
    return this.toUploadResult(originUrl, visibility);
  }

  // ----------------------------------------------------------
  // SERVER-GENERATED FILES (certificate PDFs, etc.) — issue #245
  // ----------------------------------------------------------

  /**
   * Persists a server-generated buffer under a deterministic filename.
   * Defaults to private visibility — callers stream it back through an
   * authorised endpoint via readStoredFile().
   */
  async saveBuffer(
    buffer: Buffer,
    subfolder: string,
    filename: string,
    visibility: CdnAssetVisibility = 'private',
  ): Promise<UploadResult> {
    this.ensureDir(path.join(this.uploadDir, subfolder));

    const safeName = path.basename(filename);
    const filePath = path.join(this.uploadDir, subfolder, safeName);

    fs.writeFileSync(filePath, buffer);
    this.logger.log(`Generated file saved: ${filePath}`);

    const originUrl = `/uploads/${subfolder}/${safeName}`;
    return this.toUploadResult(originUrl, visibility);
  }

  /**
   * Reads a stored file by its origin path (e.g. /uploads/certificates/x.pdf).
   * Returns null when the file does not exist; rejects paths that escape the
   * upload directory.
   */
  readStoredFile(originPath: string): Buffer | null {
    const root = path.resolve(this.uploadDir);
    const relative = originPath.replace(/^\/?uploads\//, '');
    const filePath = path.resolve(root, relative);

    if (!filePath.startsWith(root + path.sep)) {
      throw new BadRequestException('Invalid storage path');
    }
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath);
  }

  // ----------------------------------------------------------
  // VIDEO UPLOAD AND TRANSCODING
  // ----------------------------------------------------------

  /**
   * Saves a video file to disk, kicks off transcoding, and auto-generates
   * a thumbnail frame from the video.
   *
   * @param file            Uploaded video file
   * @param subfolder       Storage subfolder (e.g. 'lessons/videos')
   * @param videoId         Lesson or video ID — used for job and thumbnail naming
   * @param thumbnailAtSecs Frame timestamp for thumbnail extraction (default: 5 s)
   */
  async saveVideo(
    file: Express.Multer.File,
    subfolder: string,
    videoId: string,
    thumbnailAtSecs: number = 5,
  ): Promise<VideoUploadResult> {
    if (!file) throw new BadRequestException('No file provided');
    this.videoTranscode.validateVideoFormat(file.mimetype);

    this.ensureDir(path.join(this.uploadDir, subfolder));

    const ext = path.extname(file.originalname).toLowerCase();
    const filename = `${uuid()}${ext}`;

    await this.virusScan.scanFile(filename, file.buffer);

    const filePath = path.join(this.uploadDir, subfolder, filename);
    fs.writeFileSync(filePath, file.buffer);
    this.logger.log(`Video saved: ${filePath}`);

    // Kick off background transcode job
    const jobId = await this.videoTranscode.addTranscodeJob({
      videoId,
      sourcePath: filePath,
      filename,
      subfolder,
    });

    // Auto-generate thumbnail from the saved video file
    const thumbnail = await this.videoThumbnail.extractThumbnail(
      filePath,
      videoId,
      thumbnailAtSecs,
    );

    const originUrl = `/uploads/${subfolder}/${filename}`;
    return { jobId, originUrl, thumbnail };
  }

  /**
   * Convert a stored origin path into a full CDN-aware media response.
   */
  getDeliveryUrls(
    originPath: string,
    visibility: CdnAssetVisibility = 'public',
  ): UploadResult {
    return this.toUploadResult(originPath, visibility);
  }

  // ----------------------------------------------------------
  // HELPERS
  // ----------------------------------------------------------

  private toUploadResult(
    originPath: string,
    visibility: CdnAssetVisibility,
  ): UploadResult {
    const delivery = this.cdn.attachCdnUrls(originPath, { visibility });
    return {
      ...delivery,
      url: delivery.cdnUrl,
    };
  }

  private validateFile(file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file provided');

    if (file.size > MAX_FILE_SIZE_BYTES) {
      throw new BadRequestException(
        `File size exceeds maximum allowed size of ${MAX_FILE_SIZE_BYTES / 1024 / 1024} MB`,
      );
    }

    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException(
        `File type "${file.mimetype}" is not allowed. Accepted types: JPEG, PNG, WebP, PDF`,
      );
    }
  }

  private ensureDir(dirPath: string) {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }
}
