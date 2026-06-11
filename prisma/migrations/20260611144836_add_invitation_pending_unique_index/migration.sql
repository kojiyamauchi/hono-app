-- PENDING状態の招待に対して、同一組織・同一メールアドレスの重複を防ぐ部分ユニークインデックス
CREATE UNIQUE INDEX "Invitation_organizationId_email_pending_unique"
ON "Invitation"("organizationId", "email")
WHERE ("status" = 'PENDING');
