-- Issue #240: Create Payment model for txHash uniqueness
CREATE TABLE "payments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "txHash" TEXT NOT NULL UNIQUE,
    "studentId" TEXT NOT NULL,
    "amountPaid" DECIMAL(19,2) NOT NULL,
    "paymentType" TEXT NOT NULL DEFAULT 'ENROLLMENT',
    "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payments_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "users" ("id") ON DELETE CASCADE
);

-- Issue #239 & #240: Create Enrollment model
CREATE TABLE "enrollments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "studentId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "amountPaid" DECIMAL(19,2) NOT NULL,
    "txHash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "progressPercent" INTEGER NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "enrollments_studentId_courseId_key" UNIQUE("studentId", "courseId"),
    CONSTRAINT "enrollments_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "users" ("id") ON DELETE CASCADE,
    CONSTRAINT "enrollments_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses" ("id") ON DELETE CASCADE,
    CONSTRAINT "enrollments_txHash_fkey" FOREIGN KEY ("txHash") REFERENCES "payments" ("txHash") ON DELETE SET NULL
);

-- Create indexes on Enrollment
CREATE INDEX "enrollments_studentId_idx" ON "enrollments"("studentId");
CREATE INDEX "enrollments_courseId_idx" ON "enrollments"("courseId");
CREATE INDEX "enrollments_status_idx" ON "enrollments"("status");
CREATE INDEX "enrollments_txHash_idx" ON "enrollments"("txHash");

-- Create indexes on Payment
CREATE INDEX "payments_studentId_idx" ON "payments"("studentId");
CREATE INDEX "payments_txHash_idx" ON "payments"("txHash");

-- Issue #240: Create BundleEnrollment model with unique txHash
CREATE TABLE "bundle_enrollments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bundleId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "amountPaid" DECIMAL(19,2) NOT NULL,
    "txHash" TEXT UNIQUE,
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "bundle_enrollments_bundleId_studentId_key" UNIQUE("bundleId", "studentId"),
    CONSTRAINT "bundle_enrollments_bundleId_fkey" FOREIGN KEY ("bundleId") REFERENCES "bundles" ("id") ON DELETE CASCADE,
    CONSTRAINT "bundle_enrollments_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "users" ("id") ON DELETE CASCADE
);

-- Create indexes on BundleEnrollment
CREATE INDEX "bundle_enrollments_studentId_idx" ON "bundle_enrollments"("studentId");
CREATE INDEX "bundle_enrollments_txHash_idx" ON "bundle_enrollments"("txHash");

-- Create EnrollmentLessonUnlock model for drip-content
CREATE TABLE "enrollment_lesson_unlocks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "enrollmentId" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "unlockedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "enrollment_lesson_unlocks_enrollmentId_lessonId_key" UNIQUE("enrollmentId", "lessonId"),
    CONSTRAINT "enrollment_lesson_unlocks_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "enrollments" ("id") ON DELETE CASCADE,
    CONSTRAINT "enrollment_lesson_unlocks_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "lessons" ("id") ON DELETE CASCADE
);

-- Create EnrollmentFraudFlag relationships to new Enrollment table
ALTER TABLE "enrollment_fraud_flags" ADD CONSTRAINT "enrollment_fraud_flags_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "enrollments" ("id") ON DELETE SET NULL;

-- Create LessonProgress relationships to new Enrollment table  
ALTER TABLE "lesson_progress" ADD CONSTRAINT "lesson_progress_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "enrollments" ("id") ON DELETE CASCADE;

-- Update Refund to reference new Enrollment table
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "enrollments" ("id") ON DELETE CASCADE;

-- Update Invoice to reference new Enrollment table
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "enrollments" ("id") ON DELETE CASCADE;
