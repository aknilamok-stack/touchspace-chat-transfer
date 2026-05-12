ALTER TABLE `Profile`
  ADD COLUMN `supplierStatus` VARCHAR(191) NULL,
  ADD COLUMN `supplierPresenceHeartbeatAt` DATETIME(3) NULL;
