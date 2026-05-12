ALTER TABLE `Ticket`
  ADD COLUMN `claimRequiredAt` DATETIME(3) NULL,
  ADD COLUMN `claimedAt` DATETIME(3) NULL,
  ADD COLUMN `claimMissedAt` DATETIME(3) NULL,
  ADD COLUMN `returnedToQueueAt` DATETIME(3) NULL,
  ADD COLUMN `lastClientMessageAt` DATETIME(3) NULL,
  ADD COLUMN `lastManagerReplyAt` DATETIME(3) NULL,
  ADD COLUMN `rescueQueuedAt` DATETIME(3) NULL;

ALTER TABLE `SupplierRequest`
  ADD COLUMN `claimRequiredAt` DATETIME(3) NULL,
  ADD COLUMN `claimMissedAt` DATETIME(3) NULL,
  ADD COLUMN `returnedToQueueAt` DATETIME(3) NULL,
  ADD COLUMN `lastManagerMessageAt` DATETIME(3) NULL,
  ADD COLUMN `lastSupplierReplyAt` DATETIME(3) NULL;
