-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('MEMBER_ROLE_CHANGED');

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "action" "AuditAction" NOT NULL,
    "actorUserId" INTEGER NOT NULL,
    "targetUserId" INTEGER NOT NULL,
    "targetMembershipId" INTEGER NOT NULL,
    "previousRole" "Role" NOT NULL,
    "newRole" "Role" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditLog_organizationId_createdAt_id_idx" ON "AuditLog"("organizationId", "createdAt", "id");

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
