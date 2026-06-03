-- 認証導入に伴い User に password を追加する。
-- 既存行（認証導入前の初期開発データ）は password を持たないため、
-- 「nullableで追加 → 既存行を削除 → NOT NULL化」の手順を踏むことで、
-- 既存行がある環境でも安全に適用できるようにする。

-- 1. passwordをnullableで追加する
ALTER TABLE "User" ADD COLUMN "password" TEXT;

-- 2. passwordを持たない既存行（初期開発データ）を破棄する
DELETE FROM "User" WHERE "password" IS NULL;

-- 3. NOT NULL制約を付与する
ALTER TABLE "User" ALTER COLUMN "password" SET NOT NULL;
