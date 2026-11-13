BEGIN;

-- DropConstraint
-- newRoleだけを対象にした旧CHECK制約を、プロジェクトイベントを含む新しい制約へ置き換える。
ALTER TABLE "AuditLog" DROP CONSTRAINT "AuditLog_newRole_matches_action_check";

-- AlterTable
-- プロジェクトイベントではメンバー向け項目が存在しないため、nullableにする。
-- 既存3イベントの必須条件は、下のCHECK制約で維持する。
ALTER TABLE "AuditLog"
  ALTER COLUMN "targetUserId" DROP NOT NULL,
  ALTER COLUMN "targetMembershipId" DROP NOT NULL,
  ALTER COLUMN "previousRole" DROP NOT NULL;

-- AlterTable
-- projectIdは外部キーを設定しない（Project完全削除後もIDと当時の内容を残す）。既存行はSQL NULLになる。
ALTER TABLE "AuditLog"
  ADD COLUMN "projectId" INTEGER,
  ADD COLUMN "projectBefore" JSONB,
  ADD COLUMN "projectAfter" JSONB;

-- AddConstraint
-- イベントと項目の組み合わせ、およびスナップショットの形状を担保する。
-- CHECKは式がNULLになると通過するため、必須項目は IS NOT NULL、スナップショットはCASEとCOALESCEで
-- NULL・JSON null・キー欠落・余分キー・型違いをすべてfalseに倒し、最後のCOALESCEで全体のNULLもfalseにする。
-- スナップショットの形状は { name: string, description: string | JSON null } の2キーのみ（文字数制約・trimは設けない）。
-- jsonb_typeofで先にobjectを確認してから '-' 演算子を使う（スカラーに対する '-' はエラーになるためCASEで評価順を固定する）。
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_fields_match_action_check" CHECK (
  COALESCE(
    CASE "action"
      WHEN 'MEMBER_ROLE_CHANGED' THEN
        "targetUserId" IS NOT NULL AND "targetMembershipId" IS NOT NULL AND "previousRole" IS NOT NULL AND "newRole" IS NOT NULL
        AND "projectId" IS NULL AND "projectBefore" IS NULL AND "projectAfter" IS NULL
      WHEN 'OWNERSHIP_TRANSFERRED' THEN
        "targetUserId" IS NOT NULL AND "targetMembershipId" IS NOT NULL AND "previousRole" IS NOT NULL AND "newRole" IS NOT NULL
        AND "projectId" IS NULL AND "projectBefore" IS NULL AND "projectAfter" IS NULL
      WHEN 'MEMBER_REMOVED' THEN
        "targetUserId" IS NOT NULL AND "targetMembershipId" IS NOT NULL AND "previousRole" IS NOT NULL AND "newRole" IS NULL
        AND "projectId" IS NULL AND "projectBefore" IS NULL AND "projectAfter" IS NULL
      WHEN 'PROJECT_CREATED' THEN
        "targetUserId" IS NULL AND "targetMembershipId" IS NULL AND "previousRole" IS NULL AND "newRole" IS NULL
        AND "projectId" IS NOT NULL
        AND "projectBefore" IS NULL
        AND CASE WHEN jsonb_typeof("projectAfter") = 'object' THEN
          "projectAfter" ? 'name' AND "projectAfter" ? 'description'
          AND ("projectAfter" - 'name' - 'description') = '{}'::jsonb
          AND jsonb_typeof("projectAfter" -> 'name') = 'string'
          AND jsonb_typeof("projectAfter" -> 'description') IN ('string', 'null')
        ELSE false END
      WHEN 'PROJECT_UPDATED' THEN
        "targetUserId" IS NULL AND "targetMembershipId" IS NULL AND "previousRole" IS NULL AND "newRole" IS NULL
        AND "projectId" IS NOT NULL
        AND CASE WHEN jsonb_typeof("projectBefore") = 'object' THEN
          "projectBefore" ? 'name' AND "projectBefore" ? 'description'
          AND ("projectBefore" - 'name' - 'description') = '{}'::jsonb
          AND jsonb_typeof("projectBefore" -> 'name') = 'string'
          AND jsonb_typeof("projectBefore" -> 'description') IN ('string', 'null')
        ELSE false END
        AND CASE WHEN jsonb_typeof("projectAfter") = 'object' THEN
          "projectAfter" ? 'name' AND "projectAfter" ? 'description'
          AND ("projectAfter" - 'name' - 'description') = '{}'::jsonb
          AND jsonb_typeof("projectAfter" -> 'name') = 'string'
          AND jsonb_typeof("projectAfter" -> 'description') IN ('string', 'null')
        ELSE false END
        -- 更新は実変更があるときだけ記録する（beforeとafterが同値のログは作れない）。
        AND "projectBefore" <> "projectAfter"
      WHEN 'PROJECT_DELETED' THEN
        "targetUserId" IS NULL AND "targetMembershipId" IS NULL AND "previousRole" IS NULL AND "newRole" IS NULL
        AND "projectId" IS NOT NULL
        AND CASE WHEN jsonb_typeof("projectBefore") = 'object' THEN
          "projectBefore" ? 'name' AND "projectBefore" ? 'description'
          AND ("projectBefore" - 'name' - 'description') = '{}'::jsonb
          AND jsonb_typeof("projectBefore" -> 'name') = 'string'
          AND jsonb_typeof("projectBefore" -> 'description') IN ('string', 'null')
        ELSE false END
        AND "projectAfter" IS NULL
      ELSE false
    END,
    false
  )
);

COMMIT;
