import { z } from '@hono/zod-openapi'

import { memberDto } from '@/shared/membership/dtos'
import { roleValues } from '@/shared/membership/entities'
import { organizationDto } from '@/shared/organization/dtos'

/**
 * GET /organizations/{id}/members の応答DTO（カーソル式ページネーション）。
 * 次ページの有無は `nextCursor !== null` で表すため、limitのエコーとhasNextは持たない。
 * OpenAPI response schemaとして参照するため、`.openapi()` でcomponent名を付与する。
 */
export const memberListDto = z.object({ items: z.array(memberDto), nextCursor: z.string().nullable() }).openapi('MemberList')

/**
 * GET /organizations の応答DTO（オフセット式ページネーション）。
 * 数値による位置（limit・offset）と後続の有無（hasNext）を返す。
 * OpenAPI response schemaとして参照するため、`.openapi()` でcomponent名を付与する。
 */
export const organizationListDto = z
  .object({ items: z.array(organizationDto), limit: z.number().int(), offset: z.number().int(), hasNext: z.boolean() })
  .openapi('OrganizationList')

/** 全イベント共通のフィールド（action以外）。氏名・メールアドレスなどは含めず、記録時点のIDだけを返す。 */
const auditLogCommonShape = {
  id: z.number().int(),
  organizationId: z.number().int(),
  actorUserId: z.number().int(),
  createdAt: z.iso.datetime(),
}

/** メンバー操作イベント共通のフィールド（action・newRole以外）。 */
const memberAuditLogShape = {
  targetUserId: z.number().int().openapi({ description: '対象ユーザーのID。OWNERSHIP_TRANSFERREDでは移譲先、MEMBER_REMOVEDでは削除されたユーザー。' }),
  targetMembershipId: z.number().int().openapi({
    description: '対象メンバーシップのID。OWNERSHIP_TRANSFERREDでは移譲先のメンバーシップ、MEMBER_REMOVEDでは削除されたメンバーシップ（記録時点の値）。',
  }),
  previousRole: z.enum(roleValues).openapi({
    description:
      '対象の変更前ロール。MEMBER_ROLE_CHANGEDでは対象メンバーの変更前、OWNERSHIP_TRANSFERREDでは移譲先の変更前（ADMINまたはMEMBER）、MEMBER_REMOVEDでは削除前のロール（ADMINまたはMEMBER）。',
  }),
}

/** メンバー操作イベントの `actorUserId` の説明。 */
const memberActorDescription =
  'イベントを実行したユーザーのID。MEMBER_ROLE_CHANGEDとMEMBER_REMOVEDでは操作者。OWNERSHIP_TRANSFERREDでは移譲元のOWNER（移譲後はADMINになる）。'

/** プロジェクト操作イベントの `actorUserId` の説明。 */
const projectActorDescription = 'プロジェクトを操作したユーザーのID（記録時点の値）。'

/**
 * 監査ログに記録するProjectのスナップショットDTO。名前と説明の2キーを必ず返し、それ以外は返さない。
 * 文字数制約は設けない（Projectテーブルに保存された値をそのまま返す）。
 */
export const projectAuditSnapshotDto = z
  .object({
    name: z.string(),
    description: z
      .string()
      .nullable()
      .openapi({
        // OpenAPI 3.1ではnullableが無効なため、JSON Schemaの書き方でnull許容を明示する（Zod定義と実行時挙動は変えない）
        type: ['string', 'null'],
        description: 'プロジェクトの説明。未設定はnull。空文字も有効な値としてnullと区別する。',
      }),
  })
  .openapi('ProjectAuditSnapshot')

/** メンバーのロール変更イベントの応答DTO。 */
export const memberRoleChangedAuditLogDto = z
  .object({
    ...auditLogCommonShape,
    action: z.literal('MEMBER_ROLE_CHANGED').openapi({ description: 'メンバーのロール変更。' }),
    actorUserId: auditLogCommonShape.actorUserId.openapi({ description: memberActorDescription }),
    ...memberAuditLogShape,
    newRole: z.enum(roleValues).openapi({ description: '対象の変更後ロール。' }),
  })
  .openapi('MemberRoleChangedAuditLog')

/** 組織の所有権移譲イベントの応答DTO。 */
export const ownershipTransferredAuditLogDto = z
  .object({
    ...auditLogCommonShape,
    action: z.literal('OWNERSHIP_TRANSFERRED').openapi({ description: '組織の所有権移譲。' }),
    actorUserId: auditLogCommonShape.actorUserId.openapi({ description: memberActorDescription }),
    ...memberAuditLogShape,
    newRole: z.enum(roleValues).openapi({ description: '移譲先の変更後ロール。常にOWNER（移譲元がOWNERからADMINになったことも表す）。' }),
  })
  .openapi('OwnershipTransferredAuditLog')

/** 管理者によるメンバー削除イベントの応答DTO。変更後ロールは常にnull。 */
export const memberRemovedAuditLogDto = z
  .object({
    ...auditLogCommonShape,
    action: z.literal('MEMBER_REMOVED').openapi({ description: '管理者によるメンバー削除。' }),
    actorUserId: auditLogCommonShape.actorUserId.openapi({ description: memberActorDescription }),
    ...memberAuditLogShape,
    newRole: z.null().openapi({
      // OpenAPI 3.1ではnullableが無効なため、JSON Schemaの書き方でnullを明示する（Zod定義と実行時挙動は変えない）
      type: 'null',
      description: '変更後が存在しないMEMBER_REMOVEDでは常にnull。',
    }),
  })
  .openapi('MemberRemovedAuditLog')

/** プロジェクト作成イベントの応答DTO。`before` は常にnull。 */
export const projectCreatedAuditLogDto = z
  .object({
    ...auditLogCommonShape,
    action: z.literal('PROJECT_CREATED').openapi({ description: 'プロジェクトの作成。beforeは常にnull、afterは作成した名前と説明。' }),
    actorUserId: auditLogCommonShape.actorUserId.openapi({ description: projectActorDescription }),
    projectId: z.number().int().openapi({ description: '対象プロジェクトの記録時点のID。プロジェクト削除後も残る。' }),
    before: z.null().openapi({ type: 'null', description: '変更前。作成では常にnull。' }),
    // 登録済みcomponentへ説明を上書きしないよう、参照だけを使う（afterは作成したプロジェクトの内容）
    after: projectAuditSnapshotDto,
  })
  .openapi('ProjectCreatedAuditLog')

/** プロジェクト更新イベントの応答DTO。`before` / `after` の両方を返す。 */
export const projectUpdatedAuditLogDto = z
  .object({
    ...auditLogCommonShape,
    action: z
      .literal('PROJECT_UPDATED')
      .openapi({ description: 'プロジェクトの更新（名前または説明が実際に変化した場合のみ記録）。beforeは更新直前、afterは更新後の名前と説明。' }),
    actorUserId: auditLogCommonShape.actorUserId.openapi({ description: projectActorDescription }),
    projectId: z.number().int().openapi({ description: '対象プロジェクトの記録時点のID。プロジェクト削除後も残る。' }),
    // beforeは更新直前、afterは更新後の名前と説明
    before: projectAuditSnapshotDto,
    after: projectAuditSnapshotDto,
  })
  .openapi('ProjectUpdatedAuditLog')

/** プロジェクト削除イベントの応答DTO。`after` は常にnull。 */
export const projectDeletedAuditLogDto = z
  .object({
    ...auditLogCommonShape,
    action: z
      .literal('PROJECT_DELETED')
      .openapi({ description: 'プロジェクトの個別削除（組織削除のcascadeでは記録しない）。beforeは削除直前の名前と説明、afterは常にnull。' }),
    actorUserId: auditLogCommonShape.actorUserId.openapi({ description: projectActorDescription }),
    projectId: z.number().int().openapi({ description: '対象プロジェクトの記録時点のID。プロジェクト削除後も残る。' }),
    // beforeは削除直前の名前と説明
    before: projectAuditSnapshotDto,
    after: z.null().openapi({ type: 'null', description: '変更後。削除では常にnull。' }),
  })
  .openapi('ProjectDeletedAuditLog')

/**
 * APIレスポンス用の監査ログDTO。`action` を判別子とする6イベントのunionで、イベントごとの必須項目を表す。
 * 既存3イベントはプロジェクト向けキーを持たず、プロジェクトイベントはメンバー向けキーを持たない。
 * OpenAPI response schemaとして参照するため、`.openapi()` でcomponent名を付与する。
 */
export const auditLogDto = z
  .discriminatedUnion('action', [
    memberRoleChangedAuditLogDto,
    ownershipTransferredAuditLogDto,
    memberRemovedAuditLogDto,
    projectCreatedAuditLogDto,
    projectUpdatedAuditLogDto,
    projectDeletedAuditLogDto,
  ])
  .openapi('AuditLog')

/**
 * GET /organizations/{id}/audit-logs の応答DTO（カーソル式ページネーション）。
 * 次ページの有無は `nextCursor !== null` で表す。
 * OpenAPI response schemaとして参照するため、`.openapi()` でcomponent名を付与する。
 */
export const auditLogListDto = z.object({ items: z.array(auditLogDto), nextCursor: z.string().nullable() }).openapi('AuditLogList')

export type AuditLogDtoType = z.infer<typeof auditLogDto>
export type AuditLogListDtoType = z.infer<typeof auditLogListDto>
export type MemberListDtoType = z.infer<typeof memberListDto>
export type OrganizationListDtoType = z.infer<typeof organizationListDto>
