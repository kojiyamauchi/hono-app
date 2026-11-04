-- DropIndex
DROP INDEX "Membership_organizationId_createdAt_idx";

-- CreateIndex
CREATE INDEX "Membership_organizationId_createdAt_id_idx" ON "Membership"("organizationId", "createdAt", "id");
