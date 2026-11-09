BEGIN;

-- AlterTable
-- メンバー削除には変更後ロールが存在しないため、newRoleをnullableにする。
ALTER TABLE "AuditLog" ALTER COLUMN "newRole" DROP NOT NULL;

-- AddConstraint
-- newRoleがnullになるのはMEMBER_REMOVEDのときだけに限定する（既存2種はロール値必須）。
-- ADD VALUEで追加したenum値は同一transactionでは使えないため、値の追加は前のmigrationに分けている。
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_newRole_matches_action_check"
  CHECK (("action" = 'MEMBER_REMOVED') = ("newRole" IS NULL));

COMMIT;
