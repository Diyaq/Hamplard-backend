import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { CommentReviewStatus, EnrollmentStatus, UserRole } from '@prisma/client';
import { CommentModerationService } from './comment-moderation.service';
import { PrismaService } from '../../common/prisma/prisma.service';

describe('CommentModerationService (Issue #286)', () => {
  let service: CommentModerationService;

  const mockPrisma: any = {
    course: { findUnique: jest.fn() },
    enrollment: { findUnique: jest.fn() },
    discussionComment: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    },
  };

  const baseComment = {
    id: 'comment-1',
    discussionId: 'course-1',
    authorId: 'student-1',
    content: 'Great lesson!',
    hidden: false,
    flaggedCount: 0,
    reviewStatus: CommentReviewStatus.APPROVED,
    moderationNotes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommentModerationService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<CommentModerationService>(CommentModerationService);
    jest.clearAllMocks();
    mockPrisma.discussionComment.create.mockImplementation(async ({ data }: any) => data);
  });

  describe('findCommentById', () => {
    it('returns visible comments to the public without moderation notes', async () => {
      mockPrisma.discussionComment.findUnique.mockResolvedValue({
        ...baseComment,
        moderationNotes: 'internal',
      });

      const result: any = await service.findCommentById('comment-1');
      expect(result.id).toBe('comment-1');
      expect(result.moderationNotes).toBeUndefined();
    });

    it('returns 404 for hidden comments to non-admins', async () => {
      mockPrisma.discussionComment.findUnique.mockResolvedValue({ ...baseComment, hidden: true });

      await expect(service.findCommentById('comment-1')).rejects.toThrow(NotFoundException);
      await expect(
        service.findCommentById('comment-1', UserRole.STUDENT),
      ).rejects.toThrow(NotFoundException);
    });

    it('returns 404 for rejected comments to non-admins', async () => {
      mockPrisma.discussionComment.findUnique.mockResolvedValue({
        ...baseComment,
        reviewStatus: CommentReviewStatus.REJECTED,
      });

      await expect(service.findCommentById('comment-1')).rejects.toThrow(NotFoundException);
    });

    it('returns hidden comments with moderation notes to admins', async () => {
      const hidden = { ...baseComment, hidden: true, moderationNotes: 'Auto-flagged: spam' };
      mockPrisma.discussionComment.findUnique.mockResolvedValue(hidden);

      const result = await service.findCommentById('comment-1', UserRole.ADMIN);
      expect(result).toEqual(hidden);
    });

    it('returns 404 when the comment does not exist', async () => {
      mockPrisma.discussionComment.findUnique.mockResolvedValue(null);

      await expect(
        service.findCommentById('missing', UserRole.ADMIN),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('createComment', () => {
    const dto = { discussionId: 'course-1', content: 'Thanks for the lesson' };

    it('rejects comments on a discussion that does not exist', async () => {
      mockPrisma.course.findUnique.mockResolvedValue(null);

      await expect(service.createComment('student-1', dto)).rejects.toThrow(NotFoundException);
      expect(mockPrisma.discussionComment.create).not.toHaveBeenCalled();
    });

    it('rejects comments from users who are not enrolled', async () => {
      mockPrisma.course.findUnique.mockResolvedValue({ id: 'course-1', instructor: { id: 'inst-1' } });
      mockPrisma.enrollment.findUnique.mockResolvedValue(null);

      await expect(service.createComment('student-1', dto)).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.discussionComment.create).not.toHaveBeenCalled();
    });

    it('rejects comments from refunded enrollments', async () => {
      mockPrisma.course.findUnique.mockResolvedValue({ id: 'course-1', instructor: { id: 'inst-1' } });
      mockPrisma.enrollment.findUnique.mockResolvedValue({ status: EnrollmentStatus.REFUNDED });

      await expect(service.createComment('student-1', dto)).rejects.toThrow(ForbiddenException);
    });

    it('allows enrolled students to comment', async () => {
      mockPrisma.course.findUnique.mockResolvedValue({ id: 'course-1', instructor: { id: 'inst-1' } });
      mockPrisma.enrollment.findUnique.mockResolvedValue({ status: EnrollmentStatus.ACTIVE });

      const result: any = await service.createComment('student-1', dto);
      expect(result.reviewStatus).toBe(CommentReviewStatus.APPROVED);
      expect(result.hidden).toBe(false);
    });

    it('allows the course instructor and admins without enrollment', async () => {
      mockPrisma.course.findUnique.mockResolvedValue({ id: 'course-1', instructor: { id: 'inst-1' } });

      await expect(service.createComment('inst-1', dto, UserRole.INSTRUCTOR)).resolves.toBeDefined();
      await expect(service.createComment('admin-1', dto, UserRole.ADMIN)).resolves.toBeDefined();
      expect(mockPrisma.enrollment.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('banned term matching', () => {
    beforeEach(() => {
      mockPrisma.course.findUnique.mockResolvedValue({ id: 'course-1', instructor: { id: 'inst-1' } });
      mockPrisma.enrollment.findUnique.mockResolvedValue({ status: EnrollmentStatus.ACTIVE });
    });

    it.each([
      'I cooked scampi after class',
      'The lesson on spotting fakes was useful',
      'Spammers aside, this course is great',
    ])('does not flag innocent text: "%s"', async (content) => {
      const result: any = await service.createComment('student-1', { discussionId: 'course-1', content });
      expect(result.flaggedCount).toBe(0);
      expect(result.hidden).toBe(false);
    });

    it.each([
      'This is a scam',
      'Totally FAKE certificate',
      'Click   here for discounts',
    ])('flags whole banned terms: "%s"', async (content) => {
      const result: any = await service.createComment('student-1', { discussionId: 'course-1', content });
      expect(result.flaggedCount).toBe(1);
      expect(result.hidden).toBe(true);
      expect(result.reviewStatus).toBe(CommentReviewStatus.PENDING);
    });
  });
});
