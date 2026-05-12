ALTER TABLE `SupplierRequest`
  ADD COLUMN `assignedSupplierProfileId` VARCHAR(191) NULL,
  ADD COLUMN `assignedSupplierProfileName` VARCHAR(191) NULL,
  ADD COLUMN `claimedAt` DATETIME(3) NULL;

ALTER TABLE `SupplierRequest`
  ADD CONSTRAINT `SupplierRequest_assignedSupplierProfileId_fkey`
  FOREIGN KEY (`assignedSupplierProfileId`) REFERENCES `Profile`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;
