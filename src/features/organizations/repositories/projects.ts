import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/libs/prisma'
import type { Role } from '@/shared/membership/entities'

import type { Project } from '../entities/projects'

/** プロジェクト一覧のカーソル式ページ取得の境界値（この行より後ろ、つまりより古い行を取得する）。 */
export type ProjectPageBoundary = { createdAt: Date; id: number }

/** プロジェクト書き込みrepositoryの処理結果の種別。 */
export const projectWriteResults = {
  succeeded: 'SUCCEEDED',
  organizationNotFound: 'ORGANIZATION_NOT_FOUND',
  projectNotFound: 'PROJECT_NOT_FOUND',
  rejected: 'REJECTED',
} as const

/**
 * プロジェクト書き込み（作成・更新・削除）repositoryの処理結果。
 * `rejected` は認可コールバックが返した拒否値をそのまま運ぶ（repositoryはHTTPエラーを知らない）。
 * `organizationNotFound` は組織が存在しない、または操作者が（ロック後に）所属していないことを表す。
 */
export type ProjectWriteResult<TValue, TRejection> =
  | { status: typeof projectWriteResults.succeeded; value: TValue }
  | { status: typeof projectWriteResults.organizationNotFound }
  | { status: typeof projectWriteResults.projectNotFound }
  | { status: typeof projectWriteResults.rejected; rejection: TRejection }

/** ロック後に確定した操作者のロール。認可コールバックはこの値だけで判定する。 */
export type LockedProjectWriteState = {
  operatorRole: Role
}

/**
 * ロック後の状態で書き込みの認可を判定する同期コールバック。許可なら `null`、拒否なら拒否値を返す。
 * 対象Projectのロックより前に呼ぶため、操作者がMEMBERなら対象の有無にかかわらず拒否できる。
 * ロック中に待たせないため、DBアクセスや非同期処理は行わない。
 */
export type AuthorizeProjectWrite<TRejection> = (state: LockedProjectWriteState) => TRejection | null

/** プロジェクト作成の入力。 */
export type CreateProjectInput = {
  organizationId: number
  /** 操作者（認証済みユーザー）のユーザーID。 */
  actorUserId: number
  name: string
  description: string | null
}

/** プロジェクト更新の入力。`data` に含まれる項目だけを更新する。 */
export type UpdateProjectInput = {
  organizationId: number
  projectId: number
  actorUserId: number
  data: { name?: string; description?: string | null }
}

/** プロジェクト削除の入力。 */
export type RemoveProjectInput = {
  organizationId: number
  projectId: number
  actorUserId: number
}

type LockedIdRow = { id: number }
type LockedOperatorRow = { id: number; role: Role }
type ProjectRow = Project

/** ロック済みの行・Prismaの結果から、必要な項目だけのProjectを作る。 */
const toProject = (row: ProjectRow): Project => ({
  id: row.id,
  organizationId: row.organizationId,
  name: row.name,
  description: row.description,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

/**
 * 書き込みの共通ロックを取得する。
 * Organization行を `FOR NO KEY UPDATE`、操作者のMembership行を `FOR UPDATE` の順でロックし、
 * ロック後の最新ロールで `authorize` を判定する。User行はロックしない。
 * ロール変更・メンバー削除・所有権移譲・組織削除とはOrganization行で、
 * Organizationをロックしない自主脱退・アカウント削除（Membershipのcascade削除）とはMembership行で直列化される。
 * 組織／所属がなければ `organizationNotFound`、認可が拒否なら `rejected`、許可なら `null` を返す。
 */
const lockOrganizationAndAuthorize = async <TRejection>(
  tx: Prisma.TransactionClient,
  organizationId: number,
  actorUserId: number,
  authorize: AuthorizeProjectWrite<TRejection>,
): Promise<{ status: typeof projectWriteResults.organizationNotFound } | { status: typeof projectWriteResults.rejected; rejection: TRejection } | null> => {
  const lockedOrganizations = await tx.$queryRaw<LockedIdRow[]>`
    SELECT id
    FROM "Organization"
    WHERE id = ${organizationId}
    FOR NO KEY UPDATE
  `
  if (lockedOrganizations.length === 0) {
    return { status: projectWriteResults.organizationNotFound }
  }

  // 組織で絞り込み、別組織のMembership行をロック対象に含めない。
  const lockedMemberships = await tx.$queryRaw<LockedOperatorRow[]>`
    SELECT id, role::text AS role
    FROM "Membership"
    WHERE "organizationId" = ${organizationId} AND "userId" = ${actorUserId}
    FOR UPDATE
  `
  const operator = lockedMemberships[0]
  if (!operator) {
    return { status: projectWriteResults.organizationNotFound }
  }

  // 対象Projectのロックより前に認可する。MEMBERなら対象の有無を確認せずに拒否できる。
  const rejection = authorize({ operatorRole: operator.role })
  if (rejection !== null) {
    return { status: projectWriteResults.rejected, rejection }
  }

  return null
}

/**
 * 対象Projectを `organizationId` と `projectId` の両方で絞って `FOR UPDATE` でロックする。
 * 存在しない（別組織のIDを含む）場合は `false` を返す。
 */
const lockProject = async (tx: Prisma.TransactionClient, organizationId: number, projectId: number): Promise<boolean> => {
  const lockedProjects = await tx.$queryRaw<LockedIdRow[]>`
    SELECT id
    FROM "Project"
    WHERE id = ${projectId} AND "organizationId" = ${organizationId}
    FOR UPDATE
  `
  return lockedProjects.length > 0
}

/**
 * organizations feature固有のProjectデータアクセスを提供するリポジトリ。
 * 詳細・更新・削除のDB条件には必ず `organizationId` と `projectId` の両方を含める。
 */
export const projectRepository = {
  /**
   * 組織IDに紐づくプロジェクトを、作成日時・IDの降順（新しい順）でカーソル式に1ページ分取得する。
   * `boundary` が指定された場合は、その行より後ろ（`("createdAt", id) < (境界値)`）だけを返す。
   * `take` はそのまま `LIMIT` に使う（次ページ判定のための `limit + 1` は呼び出し側が渡す）。
   *
   * 行値比較にすると境界条件が `[organizationId, createdAt, id]` のindexの `Index Cond` へ入り、
   * 深いページでも読み捨てが発生しない。降順の並びはindexの逆方向スキャンで満たす。
   * 境界行そのものが存在するかには依存しない。
   */
  findPageByOrganization: async (organizationId: number, take: number, boundary: ProjectPageBoundary | null): Promise<Project[]> => {
    const boundaryCondition = boundary ? Prisma.sql`AND ("createdAt", id) < (${boundary.createdAt}, ${boundary.id})` : Prisma.empty

    const rows = await prisma.$queryRaw<ProjectRow[]>(Prisma.sql`
      SELECT id, "organizationId", name, description, "createdAt", "updatedAt"
      FROM "Project"
      WHERE "organizationId" = ${organizationId}
      ${boundaryCondition}
      ORDER BY "createdAt" DESC, id DESC
      LIMIT ${take}
    `)

    return rows.map(toProject)
  },

  /**
   * 組織IDとプロジェクトIDの両方でプロジェクトを1件取得する。存在しない（別組織のIDを含む）場合はnullを返す。
   */
  findByOrganizationAndId: async (organizationId: number, projectId: number): Promise<Project | null> => {
    const project = await prisma.project.findFirst({ where: { id: projectId, organizationId } })
    return project ? toProject(project) : null
  },

  /**
   * Organization行、操作者のMembership行の順でロックし、最新ロールで認可したうえでプロジェクトを作成する。
   */
  createWithAuthorization: async <TRejection>(
    input: CreateProjectInput,
    authorize: AuthorizeProjectWrite<TRejection>,
  ): Promise<ProjectWriteResult<Project, TRejection>> => {
    const { organizationId, actorUserId, name, description } = input

    return prisma.$transaction(async (tx): Promise<ProjectWriteResult<Project, TRejection>> => {
      const denied = await lockOrganizationAndAuthorize(tx, organizationId, actorUserId, authorize)
      if (denied) {
        return denied
      }

      const created = await tx.project.create({ data: { organizationId, name, description } })
      return { status: projectWriteResults.succeeded, value: toProject(created) }
    })
  },

  /**
   * Organization → 操作者のMembership → 対象Projectの順でロックし、最新ロールで認可したうえで指定項目だけを更新する。
   * 同値の指定でも更新操作として扱い、`updatedAt` を更新する。
   */
  updateWithAuthorization: async <TRejection>(
    input: UpdateProjectInput,
    authorize: AuthorizeProjectWrite<TRejection>,
  ): Promise<ProjectWriteResult<Project, TRejection>> => {
    const { organizationId, projectId, actorUserId, data } = input

    return prisma.$transaction(async (tx): Promise<ProjectWriteResult<Project, TRejection>> => {
      const denied = await lockOrganizationAndAuthorize(tx, organizationId, actorUserId, authorize)
      if (denied) {
        return denied
      }
      if (!(await lockProject(tx, organizationId, projectId))) {
        return { status: projectWriteResults.projectNotFound }
      }

      // 指定された項目だけを更新する。updatedAtはPrismaの@updatedAtが更新操作ごとに設定する。
      const updated = await tx.project.update({
        where: { id: projectId, organizationId },
        data: {
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.description !== undefined ? { description: data.description } : {}),
        },
      })
      return { status: projectWriteResults.succeeded, value: toProject(updated) }
    })
  },

  /**
   * Organization → 操作者のMembership → 対象Projectの順でロックし、最新ロールで認可したうえでプロジェクトを完全削除する。
   * 操作者がMEMBERなら対象の有無にかかわらず拒否する（認可を対象のロックより先に行う）。
   */
  removeWithAuthorization: async <TRejection>(
    input: RemoveProjectInput,
    authorize: AuthorizeProjectWrite<TRejection>,
  ): Promise<ProjectWriteResult<null, TRejection>> => {
    const { organizationId, projectId, actorUserId } = input

    return prisma.$transaction(async (tx): Promise<ProjectWriteResult<null, TRejection>> => {
      const denied = await lockOrganizationAndAuthorize(tx, organizationId, actorUserId, authorize)
      if (denied) {
        return denied
      }
      if (!(await lockProject(tx, organizationId, projectId))) {
        return { status: projectWriteResults.projectNotFound }
      }

      // ロック済みのため削除は必ず1件になるが、0件なら対象なしとして扱う。
      const deleted = await tx.project.deleteMany({ where: { id: projectId, organizationId } })
      if (deleted.count !== 1) {
        return { status: projectWriteResults.projectNotFound }
      }
      return { status: projectWriteResults.succeeded, value: null }
    })
  },
}
