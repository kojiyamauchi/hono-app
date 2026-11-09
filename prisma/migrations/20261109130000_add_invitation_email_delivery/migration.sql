CREATE TYPE "InvitationEmailDeliveryStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'UNKNOWN', 'SKIPPED');

CREATE TABLE "InvitationEmailDelivery" (
    "id" TEXT NOT NULL,
    "invitationId" INTEGER NOT NULL,
    "fromEmail" TEXT NOT NULL,
    "scalarUrl" TEXT NOT NULL,
    "organizationName" TEXT NOT NULL,
    "templateVersion" INTEGER NOT NULL,
    "status" "InvitationEmailDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "hasUnknownOutcome" BOOLEAN NOT NULL DEFAULT false,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deadline" TIMESTAMP(3) NOT NULL,
    "leaseToken" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "resendEmailId" TEXT,
    "lastError" TEXT,

    CONSTRAINT "InvitationEmailDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InvitationEmailDelivery_invitationId_key" ON "InvitationEmailDelivery"("invitationId");
CREATE INDEX "InvitationEmailDelivery_status_nextAttemptAt_id_idx" ON "InvitationEmailDelivery"("status", "nextAttemptAt", "id");

ALTER TABLE "InvitationEmailDelivery" ADD CONSTRAINT "InvitationEmailDelivery_invitationId_fkey"
    FOREIGN KEY ("invitationId") REFERENCES "Invitation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
