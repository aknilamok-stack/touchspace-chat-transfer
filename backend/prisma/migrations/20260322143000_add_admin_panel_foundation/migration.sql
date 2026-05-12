ALTER TABLE "Profile"
ADD COLUMN "status" TEXT NOT NULL DEFAULT 'active',
ADD COLUMN "approvalStatus" TEXT NOT NULL DEFAULT 'approved',
ADD COLUMN "companyName" TEXT,
ADD COLUMN "approvalComment" TEXT,
ADD COLUMN "lastLoginAt" TIMESTAMP(3),
ADD COLUMN "createdByAdminId" TEXT,
ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "Ticket"
ADD COLUMN "resolvedAt" TIMESTAMP(3),
ADD COLUMN "slaBreached" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "supplierEscalatedAt" TIMESTAMP(3),
ADD COLUMN "topicCategory" TEXT,
ADD COLUMN "sentiment" TEXT,
ADD COLUMN "aiSummary" TEXT,
ADD COLUMN "aiTags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "insightFlags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "SupplierRequest"
ADD COLUMN "requestedAt" TIMESTAMP(3),
ADD COLUMN "respondedAt" TIMESTAMP(3);

UPDATE "SupplierRequest"
SET
  "requestedAt" = COALESCE("requestedAt", "createdAt"),
  "respondedAt" = COALESCE("respondedAt", "firstResponseAt");

UPDATE "Ticket"
SET
  "resolvedAt" = COALESCE("resolvedAt", "closedAt"),
  "supplierEscalatedAt" = COALESCE(
    "supplierEscalatedAt",
    (
      SELECT MIN(sr."createdAt")
      FROM "SupplierRequest" sr
      WHERE sr."ticketId" = "Ticket"."id"
    )
  ),
  "slaBreached" = COALESCE(
    "slaBreached",
    "firstResponseBreached"
  );

CREATE TABLE "RegistrationRequest" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "fullName" TEXT NOT NULL,
  "companyName" TEXT,
  "role" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "comment" TEXT,
  "profileId" TEXT,
  "reviewedByAdminId" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "RegistrationRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RegistrationRequest_status_role_createdAt_idx"
ON "RegistrationRequest"("status", "role", "createdAt");

ALTER TABLE "RegistrationRequest"
ADD CONSTRAINT "RegistrationRequest_profileId_fkey"
FOREIGN KEY ("profileId") REFERENCES "Profile"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;

ALTER TABLE "RegistrationRequest"
ADD CONSTRAINT "RegistrationRequest_reviewedByAdminId_fkey"
FOREIGN KEY ("reviewedByAdminId") REFERENCES "Profile"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;
