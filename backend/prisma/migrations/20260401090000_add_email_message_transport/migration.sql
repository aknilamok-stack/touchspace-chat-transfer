ALTER TABLE `Message`
    ADD COLUMN `transport` VARCHAR(191) NOT NULL DEFAULT 'chat',
    ADD COLUMN `toEmail` VARCHAR(191) NULL,
    ADD COLUMN `fromEmail` VARCHAR(191) NULL,
    ADD COLUMN `subject` VARCHAR(191) NULL,
    ADD COLUMN `messageId` VARCHAR(191) NULL,
    ADD COLUMN `inReplyTo` TEXT NULL,
    ADD COLUMN `references` TEXT NULL;

CREATE UNIQUE INDEX `Message_messageId_key` ON `Message`(`messageId`);
