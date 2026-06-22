-- DropIndex
DROP INDEX "PasswordResetToken_userId_idx";

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_userId_key" ON "PasswordResetToken"("userId");
