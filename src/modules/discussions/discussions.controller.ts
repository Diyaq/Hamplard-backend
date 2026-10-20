import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { CommentModerationService } from './comment-moderation.service';
import { CreateCommentDto } from './dto/create-comment.dto';
import { ReviewCommentDto } from './dto/review-comment.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../../common/guards/optional-jwt-auth.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';

@ApiTags('discussions')
@Controller('discussions')
export class DiscussionsController {
  constructor(private readonly commentModerationService: CommentModerationService) {}

  @Post('comments')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a discussion comment and automatically scan it for banned content' })
  @HttpCode(HttpStatus.CREATED)
  createComment(
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: UserRole,
    @Body() dto: CreateCommentDto,
  ) {
    return this.commentModerationService.createComment(userId, dto, role);
  }

  @Get('comments/discussion/:discussionId')
  @ApiOperation({ summary: 'List visible comments for a discussion thread' })
  findCommentsForDiscussion(@Param('discussionId') discussionId: string) {
    return this.commentModerationService.findCommentsForDiscussion(discussionId);
  }

  @Get('comments/:id')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'Get a single discussion comment by ID (hidden/rejected comments are admin-only)' })
  findComment(
    @Param('id') id: string,
    @CurrentUser('role') role?: UserRole,
  ) {
    return this.commentModerationService.findCommentById(id, role);
  }

  @Get('moderation/flagged')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List flagged discussion comments awaiting moderation' })
  findFlaggedComments() {
    return this.commentModerationService.findFlaggedComments();
  }

  @Get('moderation/summary')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get discussion comment moderation summary' })
  getModerationSummary() {
    return this.commentModerationService.getModerationSummary();
  }

  @Patch('comments/:id/review')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Review a flagged discussion comment and update moderation status' })
  moderateComment(@Param('id') id: string, @Body() dto: ReviewCommentDto) {
    return this.commentModerationService.moderateComment(id, dto);
  }
}
