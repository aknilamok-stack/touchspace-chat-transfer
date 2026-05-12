CREATE TABLE "Profile" (
  "id" TEXT NOT NULL,
  "authUserId" TEXT,
  "email" TEXT,
  "fullName" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "companyId" TEXT,
  "supplierId" TEXT,
  "managerStatus" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Profile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Profile_authUserId_key" ON "Profile"("authUserId");
CREATE UNIQUE INDEX "Profile_email_key" ON "Profile"("email");

ALTER TABLE "Ticket"
ADD COLUMN "invitedManagerIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "clientName" TEXT,
ADD COLUMN "supplierId" TEXT,
ADD COLUMN "supplierName" TEXT,
ADD COLUMN "lastMessageAt" TIMESTAMP(3);

ALTER TABLE "Message"
ADD COLUMN "senderRole" TEXT,
ADD COLUMN "deliveryStatus" TEXT NOT NULL DEFAULT 'sent',
ADD COLUMN "messageType" TEXT NOT NULL DEFAULT 'text',
ADD COLUMN "isInternal" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "senderProfileId" TEXT,
ADD COLUMN "readAt" TIMESTAMP(3);

UPDATE "Message"
SET
  "senderRole" = COALESCE("senderRole", "senderType"),
  "deliveryStatus" = COALESCE(NULLIF("status", ''), "deliveryStatus"),
  "messageType" = CASE
    WHEN "senderType" = 'system' THEN 'system'
    ELSE 'text'
  END,
  "readAt" = CASE
    WHEN "status" = 'read' THEN COALESCE("readAt", "createdAt")
    ELSE "readAt"
  END;

UPDATE "Ticket" t
SET "lastMessageAt" = latest_message."createdAt"
FROM (
  SELECT "ticketId", MAX("createdAt") AS "createdAt"
  FROM "Message"
  GROUP BY "ticketId"
) latest_message
WHERE latest_message."ticketId" = t."id";

INSERT INTO "Profile" ("id", "fullName", "role", "createdAt", "updatedAt")
SELECT DISTINCT "clientId", COALESCE(NULLIF("clientName", ''), 'Клиент'), 'client', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Ticket"
WHERE "clientId" IS NOT NULL
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "Profile" ("id", "fullName", "role", "createdAt", "updatedAt")
SELECT DISTINCT "assignedManagerId", COALESCE(NULLIF("assignedManagerName", ''), 'Менеджер'), 'manager', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Ticket"
WHERE "assignedManagerId" IS NOT NULL
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "Profile" ("id", "fullName", "role", "createdAt", "updatedAt")
SELECT DISTINCT "lastResolvedByManagerId", COALESCE(NULLIF("lastResolvedByManagerName", ''), 'Менеджер'), 'manager', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Ticket"
WHERE "lastResolvedByManagerId" IS NOT NULL
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "Profile" ("id", "fullName", "role", "supplierId", "createdAt", "updatedAt")
SELECT DISTINCT "supplierId", COALESCE(NULLIF("supplierName", ''), 'Поставщик'), 'supplier', "supplierId", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "SupplierRequest"
WHERE "supplierId" IS NOT NULL
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "Profile" ("id", "fullName", "role", "createdAt", "updatedAt")
SELECT DISTINCT "createdByManagerId", 'Менеджер', 'manager', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "SupplierRequest"
WHERE "createdByManagerId" IS NOT NULL
ON CONFLICT ("id") DO NOTHING;

ALTER TABLE "Ticket"
ADD CONSTRAINT "Ticket_clientId_fkey"
FOREIGN KEY ("clientId") REFERENCES "Profile"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;

ALTER TABLE "Ticket"
ADD CONSTRAINT "Ticket_assignedManagerId_fkey"
FOREIGN KEY ("assignedManagerId") REFERENCES "Profile"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;

ALTER TABLE "Ticket"
ADD CONSTRAINT "Ticket_supplierId_fkey"
FOREIGN KEY ("supplierId") REFERENCES "Profile"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;

ALTER TABLE "Ticket"
ADD CONSTRAINT "Ticket_lastResolvedByManagerId_fkey"
FOREIGN KEY ("lastResolvedByManagerId") REFERENCES "Profile"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;

ALTER TABLE "Message"
ADD CONSTRAINT "Message_senderProfileId_fkey"
FOREIGN KEY ("senderProfileId") REFERENCES "Profile"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;

ALTER TABLE "SupplierRequest"
ADD CONSTRAINT "SupplierRequest_supplierId_fkey"
FOREIGN KEY ("supplierId") REFERENCES "Profile"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;

ALTER TABLE "SupplierRequest"
ADD CONSTRAINT "SupplierRequest_createdByManagerId_fkey"
FOREIGN KEY ("createdByManagerId") REFERENCES "Profile"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;
