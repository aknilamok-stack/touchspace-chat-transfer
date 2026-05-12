ALTER TABLE `Profile`
  ADD COLUMN `supervisorProfileId` VARCHAR(191) NULL;

CREATE INDEX `Profile_supervisorProfileId_idx`
  ON `Profile`(`supervisorProfileId`);

ALTER TABLE `Profile`
  ADD CONSTRAINT `Profile_supervisorProfileId_fkey`
  FOREIGN KEY (`supervisorProfileId`) REFERENCES `Profile`(`id`)
  ON DELETE SET NULL
  ON UPDATE CASCADE;
