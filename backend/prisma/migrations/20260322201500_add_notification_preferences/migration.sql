ALTER TABLE "Profile"
ADD COLUMN "notificationPushEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "notifyClientChats" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "notifySupplierChats" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "notifySupplierRequests" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "notifyAiHandoffs" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "notifyAdminAlerts" BOOLEAN NOT NULL DEFAULT true;
