ALTER TABLE "SupplierRequest"
ADD COLUMN "supplierId" TEXT,
ADD COLUMN "slaMinutes" INTEGER,
ADD COLUMN "createdByManagerId" TEXT,
ADD COLUMN "closedAt" TIMESTAMP(3);

ALTER TABLE "SupplierRequest"
ALTER COLUMN "status" SET DEFAULT 'pending';

ALTER TABLE "SupplierRequest"
DROP COLUMN "sla";
