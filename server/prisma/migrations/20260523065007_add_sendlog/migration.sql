-- CreateTable
CREATE TABLE `SendLog` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `sendKeyId` INTEGER NOT NULL,
    `userId` INTEGER NOT NULL,
    `botId` INTEGER NULL,
    `targetQq` BIGINT NOT NULL,
    `title` VARCHAR(100) NULL,
    `content` VARCHAR(4000) NOT NULL,
    `statusCode` INTEGER NOT NULL,
    `reason` VARCHAR(64) NULL,
    `durationMs` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `SendLog_sendKeyId_createdAt_idx`(`sendKeyId`, `createdAt`),
    INDEX `SendLog_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `SendLog_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `SendLog` ADD CONSTRAINT `SendLog_sendKeyId_fkey` FOREIGN KEY (`sendKeyId`) REFERENCES `SendKey`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SendLog` ADD CONSTRAINT `SendLog_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
