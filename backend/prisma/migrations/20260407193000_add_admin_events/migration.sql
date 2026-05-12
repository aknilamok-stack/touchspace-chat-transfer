CREATE TABLE `AdminEvent` (
  `id` VARCHAR(191) NOT NULL,
  `type` VARCHAR(191) NOT NULL,
  `title` VARCHAR(191) NOT NULL,
  `description` TEXT NULL,
  `actorProfileId` VARCHAR(191) NULL,
  `targetProfileId` VARCHAR(191) NULL,
  `metadata` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `AdminEvent_createdAt_idx`(`createdAt`),
  INDEX `AdminEvent_type_createdAt_idx`(`type`, `createdAt`),
  INDEX `AdminEvent_actorProfileId_createdAt_idx`(`actorProfileId`, `createdAt`),
  INDEX `AdminEvent_targetProfileId_createdAt_idx`(`targetProfileId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `AdminEvent`
  ADD CONSTRAINT `AdminEvent_actorProfileId_fkey`
  FOREIGN KEY (`actorProfileId`) REFERENCES `Profile`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `AdminEvent`
  ADD CONSTRAINT `AdminEvent_targetProfileId_fkey`
  FOREIGN KEY (`targetProfileId`) REFERENCES `Profile`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;
