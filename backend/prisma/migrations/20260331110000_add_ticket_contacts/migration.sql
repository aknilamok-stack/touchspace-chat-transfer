ALTER TABLE `Profile`
  ADD COLUMN `phone` VARCHAR(191) NULL;

CREATE TABLE `TicketContact` (
  `id` VARCHAR(191) NOT NULL,
  `ticketId` VARCHAR(191) NOT NULL,
  `type` VARCHAR(191) NOT NULL,
  `value` VARCHAR(191) NOT NULL,
  `normalizedValue` VARCHAR(191) NOT NULL,
  `label` VARCHAR(191) NULL,
  `createdByProfileId` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  INDEX `TicketContact_ticketId_type_idx`(`ticketId`, `type`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `TicketContact`
  ADD CONSTRAINT `TicketContact_ticketId_fkey`
    FOREIGN KEY (`ticketId`) REFERENCES `Ticket`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `TicketContact`
  ADD CONSTRAINT `TicketContact_createdByProfileId_fkey`
    FOREIGN KEY (`createdByProfileId`) REFERENCES `Profile`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;
