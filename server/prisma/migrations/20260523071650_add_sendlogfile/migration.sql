-- AlterTable
ALTER TABLE `sendlog` ADD COLUMN `hasAttachment` BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE `SendLogFile` (
    `sendLogId` INTEGER NOT NULL,
    `fileName` VARCHAR(255) NOT NULL,
    `mimeType` VARCHAR(127) NULL,
    `byteCount` INTEGER NOT NULL,
    `data` LONGBLOB NOT NULL,

    PRIMARY KEY (`sendLogId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `SendLogFile` ADD CONSTRAINT `SendLogFile_sendLogId_fkey` FOREIGN KEY (`sendLogId`) REFERENCES `SendLog`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
