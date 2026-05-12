ALTER TABLE `Profile`
  ADD COLUMN `activeSessionToken` VARCHAR(191) NULL,
  ADD COLUMN `activeSessionIssuedAt` DATETIME(3) NULL;
