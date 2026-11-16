/**
 * Projectドメインエンティティ。
 * 組織の資産として扱い、作成したユーザーへの参照は持たない（作成者の脱退・アカウント削除後も残る）。
 */
export type Project = {
  id: number
  organizationId: number
  name: string
  /** 説明。未設定はnull。空文字も有効な値として扱う。 */
  description: string | null
  createdAt: Date
  updatedAt: Date
}
