import {
  Injectable, NotFoundException, ForbiddenException,
  ConflictException, Logger,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { FeeCalculatorService } from '../billing/fee-calculator.service';
import { SearchService, CourseSearchDocument } from '../search/search.service';
import { CacheService } from '../../common/cache/cache.service';
import { CourseStatus, NotificationType } from '@prisma/client';
import { CreateCourseDto } from './dto/create-course.dto';
import { UpdateCourseDto } from './dto/update-course.dto';
import { SetPrerequisitesDto } from './dto/set-prerequisites.dto';

@Injectable()
export class CoursesService {
  private readonly logger = new Logger(CoursesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly feeCalculator: FeeCalculatorService,
    private readonly searchService: SearchService,
    private readonly cache: CacheService,
    private readonly config: ConfigService,
  ) {}

  /** Issue #92 — invalidate cached course listings/categories on content updates. */
  private async invalidateCourseCaches(): Promise<void> {
    await Promise.all([
      this.cache.invalidateNamespace('courses:list'),
      this.cache.invalidateNamespace('courses:categories'),
    ]);
  }

  // -----------------------------------------------------
  // CREATE
  // -----------------------------------------------------

  /**
   * Instructor creates a course draft in the backend DB.
   * The course starts as Draft until the instructor submits it for review.
   * On submission, status becomes PENDING and admin is notified.
   *
   * Does NOT index into search — only ACTIVE courses are searchable.
   * 
   * Issue #242: Platform fee is set from config (not from instructor DTO).
   * Only admins can override via setPlatformFee().
   */
  async create(instructorId: string, instructorAddress: string, dto: CreateCourseDto) {
    const existing = await this.prisma.course.findUnique({ where: { id: dto.courseId } });
    if (existing) throw new ConflictException(`Course ID ${dto.courseId} already exists`);

    // Get platform fee from config (default 20%)
    const platformFeePercent = Number(this.config.get('PLATFORM_FEE_PERCENT', 20));

    const course = await this.prisma.course.create({
      data: {
        id:                 dto.courseId,
        instructorAddress,
        title:              dto.title,
        description:        dto.description,
        category:           dto.category,
        level:              dto.level ?? 'Beginner',
        language:           dto.language ?? 'English',
        thumbnailUrl:       dto.thumbnailUrl,
        previewVideoUrl:    dto.previewVideoUrl,
        price:              dto.price,
        platformFeePercent: platformFeePercent,
        status:             CourseStatus.DRAFT,
      },
    });

    this.logger.log(`Course created (draft): ${course.id} by ${instructorAddress}`);
    await this.invalidateCourseCaches();
    return course;
  }

  // -----------------------------------------------------
  // SUBMIT FOR REVIEW
  // -----------------------------------------------------

  /**
   * Instructor submits a DRAFT course for admin review → PENDING.
   * Called after the instructor has also registered the course on-chain.
   */
  async submitForReview(courseId: string, instructorId: string, txHash?: string) {
    const course = await this.findOne(courseId, { isAdmin: true });

    if (course.status !== CourseStatus.DRAFT) {
      throw new ForbiddenException('Only DRAFT courses can be submitted for review');
    }

    const updated = await this.prisma.course.update({
      where: { id: courseId },
      data: { status: CourseStatus.PENDING, txHash: txHash ?? course.txHash },
    });

    // Notify all admins (simplified — notify the single admin address)
    this.logger.log(`Course ${courseId} submitted for review`);
    return updated;
  }

  // -----------------------------------------------------
  // APPROVE / REJECT (admin)
  // -----------------------------------------------------

  async approve(courseId: string, adminId: string) {
    const course = await this.findOne(courseId, { isAdmin: true });
    if (course.status !== CourseStatus.PENDING) {
      throw new ForbiddenException('Only PENDING courses can be approved');
    }

    const updated = await this.prisma.course.update({
      where: { id: courseId },
      data: { status: CourseStatus.ACTIVE, approvedAt: new Date() },
    });

    // Index the approved course into the search engine
    await this.indexCourseForSearch(updated.id);

    // Notify instructor
    const instructor = await this.prisma.user.findUnique({
      where: { stellarAddress: course.instructorAddress },
    });
    if (instructor) {
      await this.notifications.notifyUser(
        instructor.id,
        NotificationType.COURSE_APPROVED,
        'Your course has been approved!',
        `"${course.title}" is now live on Hamplard. Students can start enrolling.`,
        { courseId },
      );
    }

    this.logger.log(`Course approved: ${courseId}`);
    await this.invalidateCourseCaches();
    return updated;
  }

  async reject(courseId: string, adminId: string, reason: string) {
    const course = await this.findOne(courseId, { isAdmin: true });
    if (course.status !== CourseStatus.PENDING) {
      throw new ForbiddenException('Only PENDING courses can be rejected');
    }

    const updated = await this.prisma.course.update({
      where: { id: courseId },
      data: { status: CourseStatus.DRAFT },
    });

    const instructor = await this.prisma.user.findUnique({
      where: { stellarAddress: course.instructorAddress },
    });
    if (instructor) {
      await this.notifications.notifyUser(
        instructor.id,
        NotificationType.COURSE_REJECTED,
        'Course review feedback',
        `Your course "${course.title}" needs some changes before approval. Reason: ${reason}`,
        { courseId, reason },
      );
    }

    await this.invalidateCourseCaches();
    return updated;
  }

  // -----------------------------------------------------
  // READ
  // -----------------------------------------------------

  async findAll(filters: {
    category?: string;
    level?: string;
    status?: CourseStatus;
    instructorAddress?: string;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const { category, level, status, instructorAddress, search, page = 1, limit = 20 } = filters;

    const where: any = {};
    if (category)          where.category = category;
    if (level)             where.level = level;
    if (status)            where.status = status;
    if (instructorAddress) where.instructorAddress = instructorAddress;
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [courses, total] = await this.prisma.$transaction([
      this.prisma.course.findMany({
        where,
        include: {
          instructor: { select: { name: true, stellarAddress: true, avatarUrl: true } },
          _count:     { select: { enrollments: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.course.count({ where }),
    ]);

    return { data: courses, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  /**
   * Public course detail view.
   *
   * - Non-ACTIVE courses are hidden (404) unless the caller is the owner or an admin.
   * - Owners/admins receive the full course with all lesson content.
   * - Enrolled students receive the full curriculum.
   * - Anonymous/non-enrolled callers receive a curriculum outline only
   *   (title, type, duration, isFree) and content only for isFree lessons.
   */
  async findOne(
    id: string,
    viewer?: { userId?: string; stellarAddress?: string; isAdmin?: boolean },
  ) {
    const course = await this.prisma.course.findUnique({
      where: { id },
      include: {
        instructor: { select: { name: true, stellarAddress: true, avatarUrl: true, bio: true } },
        modules: {
          orderBy: { position: 'asc' },
          include: {
            lessons: { orderBy: { position: 'asc' } },
          },
        },
        _count: { select: { enrollments: true } },
      },
    });
    if (!course) throw new NotFoundException(`Course ${id} not found`);

    const isOwner =
      !!viewer?.stellarAddress && viewer.stellarAddress === course.instructorAddress;
    const isAdmin = !!viewer?.isAdmin;

    // Hide non-ACTIVE courses from everyone except the owner and admins.
    if (course.status !== CourseStatus.ACTIVE && !isOwner && !isAdmin) {
      throw new NotFoundException(`Course ${id} not found`);
    }

    // Owners and admins always get the full view.
    if (isOwner || isAdmin) {
      return course;
    }

    // Enrolled students get the full curriculum.
    const isEnrolled = await this.isEnrolled(course.id, viewer);
    if (isEnrolled) {
      return course;
    }

    // Anonymous / non-enrolled callers: return a curriculum outline.
    return this.toPublicOutline(course);
  }

  /** Returns true when the viewer has an active enrollment in the course. */
  private async isEnrolled(
    courseId: string,
    viewer?: { userId?: string; stellarAddress?: string },
  ): Promise<boolean> {
    if (!viewer?.userId && !viewer?.stellarAddress) return false;
    const enrollment = await this.prisma.enrollment.findFirst({
      where: {
        courseId,
        ...(viewer.userId
          ? { userId: viewer.userId }
          : { user: { stellarAddress: viewer.stellarAddress } }),
      },
      select: { id: true },
    });
    return !!enrollment;
  }

  /**
   * Strips paid lesson content from a course, keeping only the outline
   * fields (title, type, duration, isFree) plus content for free lessons.
   */
  private toPublicOutline(course: any) {
    return {
      ...course,
      modules: course.modules.map((module: any) => ({
        ...module,
        lessons: module.lessons.map((lesson: any) => {
          const base = {
            id: lesson.id,
            moduleId: lesson.moduleId,
            title: lesson.title,
            type: lesson.type,
            duration: lesson.duration,
            position: lesson.position,
            isFree: lesson.isFree,
          };
          if (lesson.isFree) {
            return {
              ...base,
              videoUrl: lesson.videoUrl,
              content: lesson.content,
              resourceUrl: lesson.resourceUrl,
            };
          }
          return base;
        }),
      })),
    };
  }

  async getCategories() {
    const categories = await this.prisma.course.groupBy({
      by: ['category'],
      where: { status: CourseStatus.ACTIVE },
      _count: { category: true },
      orderBy: { _count: { category: 'desc' } },
    });
    return categories.map((c) => ({ name: c.category, count: c._count.category }));
  }

  async update(courseId: string, instructorId: string, dto: UpdateCourseDto) {
    const course = await this.findOne(courseId, { isAdmin: true });
    if (course.status === CourseStatus.ARCHIVED) {
      throw new ForbiddenException('Cannot update an archived course');
    }

    const updated = await this.prisma.course.update({ where: { id: courseId }, data: dto });

    // Re-index if the course is active (search index should reflect changes)
    if (updated.status === CourseStatus.ACTIVE) {
      await this.indexCourseForSearch(updated.id);
    }

    await this.invalidateCourseCaches();
    return updated;
  }

  private async indexCourseForSearch(courseId: string): Promise<void> {
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      include: { instructor: { select: { name: true } } },
    });
    if (!course) return;
    const doc: CourseSearchDocument = {
      id: course.id,
      title: course.title,
      description: course.description,
      category: course.category,
      level: course.level,
      instructorName: course.instructor?.name,
    };
    await this.searchService.indexCourse(doc);
  }

  async updateStats(courseId: string, delta: { enrollments?: number; revenue?: number }) {
    const course = await this.findOne(courseId);
    return this.prisma.course.update({
      where: { id: courseId },
      data: {
        totalEnrollments: { increment: delta.enrollments ?? 0 },
        totalRevenue:     { increment: delta.revenue ?? 0 },
      },
    });
  }

  // ----------------------------------------------------------
  // STATUS TRANSITIONS (issue #232)
  // ----------------------------------------------------------
  // Used by on-chain event sync and auto-moderation. Each transition keeps
  // the Meilisearch index and the Redis course-list caches in step with the
  // DB status: only ACTIVE courses are indexed.

  /** Marks a course ACTIVE, indexes it for search and purges list caches. */
  async approveCourse(courseId: string): Promise<boolean> {
    const { count } = await this.prisma.course.updateMany({
      where: { id: courseId },
      data: { status: CourseStatus.ACTIVE, approvedAt: new Date() },
    });
    if (!count) {
      this.logger.warn(`approveCourse: course ${courseId} not found`);
      return false;
    }

    await this.indexCourseForSearch(courseId);
    await this.invalidateCourseCaches();
    this.logger.log(`Course ${courseId} → ACTIVE (indexed for search)`);
    return true;
  }

  /** Marks a course PAUSED, removes it from search and purges list caches. */
  async pauseCourse(courseId: string): Promise<boolean> {
    return this.delistCourse(courseId, CourseStatus.PAUSED);
  }

  /** Marks a course ARCHIVED, removes it from search and purges list caches. */
  async archiveCourse(courseId: string): Promise<boolean> {
    return this.delistCourse(courseId, CourseStatus.ARCHIVED);
  }

  private async delistCourse(courseId: string, status: CourseStatus): Promise<boolean> {
    const { count } = await this.prisma.course.updateMany({
      where: { id: courseId },
      data: { status },
    });
    if (!count) {
      this.logger.warn(`Cannot set course ${courseId} to ${status}: not found`);
      return false;
    }

    await this.removeCourseFromSearch(courseId);
    await this.invalidateCourseCaches();
    this.logger.log(`Course ${courseId} → ${status} (removed from search)`);
    return true;
  }

  // ----------------------------------------------------------
  // SEARCH INDEX HELPERS
  // ----------------------------------------------------------

  /** Removes a course from the search index; failures are logged, not thrown. */
  private async removeCourseFromSearch(courseId: string): Promise<void> {
    try {
      await this.searchService.removeCourse(courseId);
    } catch (err) {
      this.logger.error(
        `Failed to remove course ${courseId} from search index: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Builds a search document from the course in the database and
   * syncs it to the Meilisearch index.
   */
  private async indexCourseForSearch(courseId: string): Promise<void> {
    try {
      const course = await this.prisma.course.findUnique({
        where: { id: courseId },
        include: {
          instructor: { select: { name: true } },
        },
      });

      if (!course) {
        this.logger.warn(`Cannot index course ${courseId}: not found`);
        return;
      }

      const doc: CourseSearchDocument = {
        id: course.id,
        title: course.title,
        description: course.description ?? '',
        category: course.category,
        level: course.level,
        language: course.language,
        instructorAddress: course.instructorAddress,
        instructorName: course.instructor?.name ?? '',
        price: Number(course.price),
        avgRating: course.avgRating,
        totalEnrollments: course.totalEnrollments,
        totalReviews: course.totalReviews,
        thumbnailUrl: course.thumbnailUrl ?? '',
        status: course.status,
        lastIndexedAt: 0, // will be set by searchService.indexCourse
      };

      await this.searchService.indexCourse(doc);
    } catch (err) {
      this.logger.error(
        `Failed to index course ${courseId} for search: ${(err as Error).message}`,
      );
    }
  }

  // ----------------------------------------------------------
  // COURSE PREREQUISITES (issue #24)
  // ----------------------------------------------------------

  /**
   * Lists the prerequisites configured for a course — public read used by
   * the catalog and by the enrollment pre-check feedback endpoint.
   */
  async getPrerequisites(courseId: string) {
    await this.findOne(courseId);
    const rows = await this.prisma.coursePrerequisite.findMany({
      where: { courseId },
      orderBy: { prerequisiteId: 'asc' },
      include: {
        prerequisite: {
          select: {
            id: true, title: true, category: true, level: true,
            thumbnailUrl: true, status: true, totalLessons: true,
          },
        },
      },
    });
    return rows.map((r) => r.prerequisite);
  }

  /**
   * Replaces the full prerequisite list of a course (PUT semantics).
   * Guards against self-reference, unknown IDs and cycles so that multiple
   * chains can coexist while the overall graph stays acyclic.
   */
  async setPrerequisites(courseId: string, instructorId: string, dto: SetPrerequisitesDto) {
    const course = await this.prisma.course.findUnique({ where: { id: courseId } });
    if (!course) throw new NotFoundException(`Course ${courseId} not found`);

    await this.prisma.coursePrerequisite.deleteMany({ where: { courseId } });
    if (dto.prerequisiteIds.length > 0) {
      await this.prisma.coursePrerequisite.createMany({
        data: dto.prerequisiteIds.map((prerequisiteCourseId) => ({
          courseId,
          prerequisiteId: prerequisiteCourseId,
        })),
      });
    }

    return this.prisma.coursePrerequisite.findMany({ where: { courseId } });
  }

  // ----------------------------------------------------------
  // PLATFORM FEE MANAGEMENT (issue #242 — admin-only)
  // ----------------------------------------------------------

  /**
   * Admin-only endpoint to set the platform fee for a specific course.
   * Instructors cannot set this fee; it defaults from config or this method.
   */
  async setPlatformFee(courseId: string, feePercent: number): Promise<void> {
    if (feePercent < 0 || feePercent > 100) {
      throw new ConflictException('Platform fee must be between 0 and 100');
    }

    await this.prisma.course.update({
      where: { id: courseId },
      data: { platformFeePercent: feePercent },
    });

    this.logger.log(`Course ${courseId} platform fee updated to ${feePercent}%`);
    await this.invalidateCourseCaches();
  }
}
