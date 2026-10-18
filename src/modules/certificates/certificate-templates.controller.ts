import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  Header,
  StreamableFile,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam, ApiProduces } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CertificateTemplatesService } from './certificate-templates.service';
import {
  CreateCertificateTemplateDto,
  PreviewCertificateTemplateDto,
  QueryCertificateTemplatesDto,
  UpdateCertificateTemplateDto,
} from './dto/certificate-template.dto';

@ApiTags('certificate-templates')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('certificate-templates')
export class CertificateTemplatesController {
  constructor(private readonly templatesService: CertificateTemplatesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a certificate template (draft until activated)' })
  create(
    @CurrentUser('id') adminId: string,
    @Body() dto: CreateCertificateTemplateDto,
  ) {
    return this.templatesService.create(adminId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List certificate templates, optionally filtered by category or active status' })
  findAll(@Query() query: QueryCertificateTemplatesDto) {
    return this.templatesService.findAll(query);
  }

  @Get('active/:category')
  @ApiOperation({ summary: 'Get the active validated template for a course category' })
  @ApiParam({ name: 'category', example: 'Tailoring' })
  getActive(@Param('category') category: string) {
    return this.templatesService.getActiveTemplateForCategory(category);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a certificate template by ID' })
  findOne(@Param('id') id: string) {
    return this.templatesService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update branding, layout, or signature fields on a template' })
  update(@Param('id') id: string, @Body() dto: UpdateCertificateTemplateDto) {
    return this.templatesService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a non-active certificate template' })
  remove(@Param('id') id: string) {
    return this.templatesService.remove(id);
  }

  @Post(':id/preview')
  @HttpCode(HttpStatus.OK)
  @Header('Content-Type', 'application/pdf')
  @ApiProduces('application/pdf')
  @ApiOperation({
    summary: 'Render a PDF preview of a template before activation',
    description: 'Draft templates can be previewed. Missing copy uses placeholders.',
  })
  async preview(
    @Param('id') id: string,
    @Body() dto: PreviewCertificateTemplateDto,
  ) {
    const buffer = await this.templatesService.preview(id, dto);
    return new StreamableFile(buffer, {
      type: 'application/pdf',
      disposition: 'inline; filename="certificate-preview.pdf"',
    });
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Activate a template for its course category',
    description:
      'Required branding, layout, and signature fields must be present. ' +
      'The previously active template for the same category is deactivated.',
  })
  activate(@Param('id') id: string) {
    return this.templatesService.activate(id);
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deactivate a template without deleting it' })
  deactivate(@Param('id') id: string) {
    return this.templatesService.deactivate(id);
  }
}
export type CertificateOrientation = 'PORTRAIT' | 'LANDSCAPE';

export interface CertificateBranding {
  organizationName?: string;
  primaryColor?: string;
  secondaryColor?: string;
  logoUrl?: string;
  backgroundImageUrl?: string;
  fontFamily?: string;
  footerText?: string;
}

export interface CertificateLayout {
  orientation?: CertificateOrientation;
  titleText?: string;
  subtitleText?: string;
  bodyText?: string;
  showQrCode?: boolean;
  showIssueDate?: boolean;
  showCertificateId?: boolean;
  margin?: number;
}

export interface CertificateSignature {
  name?: string;
  label?: string;
  title?: string;
  imageUrl?: string;
}

export interface CertificateTemplateConfig {
  id: string;
  name: string;
  category: string;
  branding: CertificateBranding;
  layout: CertificateLayout;
  signatures: CertificateSignature[];
  isActive: boolean;
  createdById: string;
  activatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CertificateRenderData {
  studentName: string;
  courseTitle: string;
  certificateId: string;
  issuedAt: Date;
  category?: string;
}

export interface TemplateValidationResult {
  valid: boolean;
  missing: string[];
}

export const REQUIRED_BRANDING_FIELDS = ['organizationName', 'primaryColor'] as const;
export const REQUIRED_LAYOUT_FIELDS = ['orientation', 'titleText', 'bodyText'] as const;
export const REQUIRED_SIGNATURE_FIELDS = ['name', 'label'] as const;
export const VALID_ORIENTATIONS: CertificateOrientation[] = ['PORTRAIT', 'LANDSCAPE'];
export const HEX_COLOR_PATTERN = /^#([0-9A-Fa-f]{6})$/;
