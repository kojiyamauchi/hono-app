-- CreateIndex
CREATE INDEX "Membership_organizationId_createdAt_idx" ON "Membership"("organizationId", "createdAt");

-- 未失効のリフレッシュセッション取得を支援する部分インデックス
-- Prisma schemaでは部分インデックスの条件を表現できないため、migration履歴を正本として手書きで定義する
CREATE INDEX "RefreshToken_userId_expiresAt_active_idx"
ON "RefreshToken"("userId", "expiresAt")
WHERE "revokedAt" IS NULL;
