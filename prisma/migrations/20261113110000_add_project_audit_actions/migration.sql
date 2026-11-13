-- AlterEnum
-- プロジェクト操作の監査ログ用のイベント種別を追加する。
-- ADD VALUEで追加したenum値は同一transactionでは使えないため、値を参照するnullable化・列追加・CHECK制約は次のmigrationに分けている。
ALTER TYPE "AuditAction" ADD VALUE 'PROJECT_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'PROJECT_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'PROJECT_DELETED';
