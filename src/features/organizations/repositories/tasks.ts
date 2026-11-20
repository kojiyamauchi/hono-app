import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/libs/prisma'
import type { Role } from '@/shared/membership/entities'

import type { Task, TaskStatus } from '../entities/tasks'
import type { LockedIdRow } from './common'

/** タスク一覧のカーソル式ページ取得の境界値（この行より後ろ、つまりより古い行を取得する）。 */
export type TaskPageBoundary = { createdAt: Date; id: number }

/** タスク書き込みrepositoryの処理結果の種別。 */
export const taskWriteResults = {
  succeeded: 'SUCCEEDED',
  organizationNotFound: 'ORGANIZATION_NOT_FOUND',
  projectNotFound: 'PROJECT_NOT_FOUND',
  taskNotFound: 'TASK_NOT_FOUND',
  rejected: 'REJECTED',
} as const

/**
 * タスク書き込み（作成・更新・削除）repositoryの処理結果。
 * `rejected` は認可コールバックが返した拒否値をそのまま運ぶ（repositoryはHTTPエラーを知らない）。
 * `organizationNotFound` は組織が存在しない、または操作者が（ロック後に）所属していないことを表す。
 * `projectNotFound` は指定組織内に親Projectがない（別組織のIDを含む）こと、`taskNotFound` は指定Project内に対象Taskがないことを表す。
 */
export type TaskWriteResult<TValue, TRejection> =
  | { status: typeof taskWriteResults.succeeded; value: TValue }
  | { status: typeof taskWriteResults.organizationNotFound }
  | { status: typeof taskWriteResults.projectNotFound }
  | { status: typeof taskWriteResults.taskNotFound }
  | { status: typeof taskWriteResults.rejected; rejection: TRejection }

/** ロック後に確定した操作者のロール。認可コールバックはこの値だけで判定する。 */
export type LockedTaskWriteState = {
  operatorRole: Role
}

/**
 * ロック後の状態で書き込みの認可を判定する同期コールバック。許可なら `null`、拒否なら拒否値を返す。
 * 親Projectの確認・ロックより前に呼ぶため、操作者の権限が足りなければ親やTaskの有無にかかわらず拒否できる。
 * ロック中に待たせないため、DBアクセスや非同期処理は行わない。
 */
export type AuthorizeTaskWrite<TRejection> = (state: LockedTaskWriteState) => TRejection | null

/** タスク作成の入力。 */
export type CreateTaskInput = {
  organizationId: number
  projectId: number
  /** 操作者（認証済みユーザー）のユーザーID。 */
  actorUserId: number
  title: string
  description: string | null
  status: TaskStatus
}

/** タスク更新の入力。`data` に含まれる項目だけを更新する。 */
export type UpdateTaskInput = {
  organizationId: number
  projectId: number
  taskId: number
  actorUserId: number
  data: { title?: string; description?: string | null; status?: TaskStatus }
}

/** タスク削除の入力。 */
export type RemoveTaskInput = {
  organizationId: number
  projectId: number
  taskId: number
  actorUserId: number
}

type LockedOperatorRow = { role: Role }

/** 生SQL・Prismaの結果から、必要な項目だけのTaskを作る。 */
const toTask = (row: Task): Task => ({
  id: row.id,
  projectId: row.projectId,
  title: row.title,
  description: row.description,
  status: row.status,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

/**
 * 書き込みの共通ロックを、組織 → 操作者のMembership → 親Projectの順に取得する。
 * - Organization行は `FOR KEY SHARE`。所有権移譲・組織削除の `FOR UPDATE` とは直列化し、ロール変更の `FOR NO KEY UPDATE` とは競合しない。
 * - 操作者のMembership行は `FOR SHARE`。ロール変更・メンバー削除・自主脱退・アカウント削除（Membershipのcascade削除）と直列化する。
 * - 親Project行は `FOR KEY SHARE`。Project更新・削除の `FOR UPDATE` とは直列化し、Task同士のロックとは互換性がある。
 * いずれも `OF` を使うJOINではなく段階ごとの単独SELECTで取得し、ロック対象と強度の昇格を避ける。User行はロックしない。
 * Membershipのロック後、親Projectの確認より先に `authorize` で最新ロールを判定する。
 * 組織／所属がなければ `organizationNotFound`、認可が拒否なら `rejected`、親Projectがなければ `projectNotFound`、すべて通れば `null` を返す。
 */
const lockOrganizationAndProject = async <TRejection>(
  tx: Prisma.TransactionClient,
  organizationId: number,
  projectId: number,
  actorUserId: number,
  authorize: AuthorizeTaskWrite<TRejection>,
): Promise<
  | { status: typeof taskWriteResults.organizationNotFound }
  | { status: typeof taskWriteResults.projectNotFound }
  | { status: typeof taskWriteResults.rejected; rejection: TRejection }
  | null
> => {
  const lockedOrganizations = await tx.$queryRaw<LockedIdRow[]>`
    SELECT id
    FROM "Organization"
    WHERE id = ${organizationId}
    FOR KEY SHARE
  `
  if (lockedOrganizations.length === 0) {
    return { status: taskWriteResults.organizationNotFound }
  }

  // 組織で絞り込み、別組織のMembership行をロック対象に含めない。
  const lockedMemberships = await tx.$queryRaw<LockedOperatorRow[]>`
    SELECT role::text AS role
    FROM "Membership"
    WHERE "organizationId" = ${organizationId} AND "userId" = ${actorUserId}
    FOR SHARE
  `
  const operator = lockedMemberships[0]
  if (!operator) {
    return { status: taskWriteResults.organizationNotFound }
  }

  // 親Projectのロックより前に認可する。権限が足りなければ親やTaskの有無を確認せずに拒否できる。
  const rejection = authorize({ operatorRole: operator.role })
  if (rejection !== null) {
    return { status: taskWriteResults.rejected, rejection }
  }

  // 親Projectは組織IDも条件に含めて確認し、別組織のProject IDでは対象にならないようにする。
  const lockedProjects = await tx.$queryRaw<LockedIdRow[]>`
    SELECT id
    FROM "Project"
    WHERE id = ${projectId} AND "organizationId" = ${organizationId}
    FOR KEY SHARE
  `
  if (lockedProjects.length === 0) {
    return { status: taskWriteResults.projectNotFound }
  }

  return null
}

/**
 * 対象Taskを `projectId` と `taskId` の両方で絞って `FOR UPDATE` でロックする（親Projectは組織IDで確認・ロック済みの前提）。
 * 同じTaskへの更新・削除だけを直列化し、同じProject内の別Taskの書き込みは待たせない。
 * 存在しない（別Projectのタスクを含む）場合はfalseを返す。
 */
const lockTask = async (tx: Prisma.TransactionClient, projectId: number, taskId: number): Promise<boolean> => {
  const lockedTasks = await tx.$queryRaw<LockedIdRow[]>`
    SELECT id
    FROM "Task"
    WHERE id = ${taskId} AND "projectId" = ${projectId}
    FOR UPDATE
  `
  return lockedTasks.length > 0
}

/**
 * organizations feature固有のTaskデータアクセスを提供するリポジトリ。
 * TaskにはorganizationIdがないため、取得のDB条件には親Projectの `organizationId` を含める。
 */
export const tasksRepository = {
  /**
   * 親Projectが指定組織内に存在するかを返す（別組織のProject IDは存在しない扱い）。
   * 読み取りのみで、トランザクションや行ロックは使わない。
   */
  projectExists: async (organizationId: number, projectId: number): Promise<boolean> => {
    const project = await prisma.project.findFirst({ where: { id: projectId, organizationId }, select: { id: true } })
    return project !== null
  },

  /**
   * プロジェクトのタスクを、作成日時・IDの降順（新しい順）でカーソル式に1ページ分取得する。
   * ProjectへのJOINで組織条件を取得SQLに含める。`status` が指定された場合は同じSQLのWHEREで絞り込む。
   * `boundary` が指定された場合は、その行より後ろ（`("createdAt", id) < (境界値)`）だけを返す。
   * `take` はそのまま `LIMIT` に使う（次ページ判定のための `limit + 1` は呼び出し側が渡す）。
   *
   * 行値比較にすると境界条件が `[projectId, createdAt, id]`（状態指定時は `[projectId, status, createdAt, id]`）の
   * indexの `Index Cond` へ入る。降順の並びはindexの逆方向スキャンで満たす。境界行そのものが存在するかには依存しない。
   * 読み取りのみで、トランザクションや行ロックは使わない。
   */
  list: async (organizationId: number, projectId: number, status: TaskStatus | null, take: number, boundary: TaskPageBoundary | null): Promise<Task[]> => {
    const statusCondition = status !== null ? Prisma.sql`AND t."status" = ${status}::"TaskStatus"` : Prisma.empty
    const boundaryCondition = boundary ? Prisma.sql`AND (t."createdAt", t.id) < (${boundary.createdAt}, ${boundary.id})` : Prisma.empty

    const rows = await prisma.$queryRaw<Task[]>(Prisma.sql`
      SELECT t.id, t."projectId", t.title, t.description, t.status::text AS status, t."createdAt", t."updatedAt"
      FROM "Task" t
      JOIN "Project" p ON p.id = t."projectId"
      WHERE t."projectId" = ${projectId} AND p."organizationId" = ${organizationId}
      ${statusCondition}
      ${boundaryCondition}
      ORDER BY t."createdAt" DESC, t.id DESC
      LIMIT ${take}
    `)

    return rows.map(toTask)
  },

  /**
   * 組織・プロジェクト・タスクIDの全てでタスクを1件取得する。存在しない（別組織・別Projectのタスクを含む）場合はnullを返す。
   * 読み取りのみで、トランザクションや行ロックは使わない。
   */
  getById: async (organizationId: number, projectId: number, taskId: number): Promise<Task | null> => {
    const task = await prisma.task.findFirst({ where: { id: taskId, projectId, project: { organizationId } } })
    return task ? toTask(task) : null
  },

  /**
   * Organization → 操作者のMembership → 親Projectの順でロックし、最新ロールで認可したうえでタスクを作成する。
   */
  create: async <TRejection>(input: CreateTaskInput, authorize: AuthorizeTaskWrite<TRejection>): Promise<TaskWriteResult<Task, TRejection>> => {
    const { organizationId, projectId, actorUserId, title, description, status } = input

    return prisma.$transaction(
      async (tx): Promise<TaskWriteResult<Task, TRejection>> => {
        const denied = await lockOrganizationAndProject(tx, organizationId, projectId, actorUserId, authorize)
        if (denied) {
          return denied
        }

        const created = await tx.task.create({ data: { projectId, title, description, status } })
        return { status: taskWriteResults.succeeded, value: toTask(created) }
      },
      // 明示的にREAD COMMITTEDで実行する（行ロックで直列化し、ロック後に最新の状態を読む前提）
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    )
  },

  /**
   * Organization → 操作者のMembership → 親Project → 対象Taskの順でロックし、最新ロールで認可したうえで指定項目だけを更新する。
   * 同値の指定でも更新操作として扱い、`updatedAt` を更新する。
   */
  update: async <TRejection>(input: UpdateTaskInput, authorize: AuthorizeTaskWrite<TRejection>): Promise<TaskWriteResult<Task, TRejection>> => {
    const { organizationId, projectId, taskId, actorUserId, data } = input

    return prisma.$transaction(
      async (tx): Promise<TaskWriteResult<Task, TRejection>> => {
        const denied = await lockOrganizationAndProject(tx, organizationId, projectId, actorUserId, authorize)
        if (denied) {
          return denied
        }
        if (!(await lockTask(tx, projectId, taskId))) {
          return { status: taskWriteResults.taskNotFound }
        }

        // 指定された項目だけを更新する。updatedAtはPrismaの@updatedAtが更新操作ごとに設定する。
        const updated = await tx.task.update({
          where: { id: taskId, projectId },
          data: {
            ...(data.title !== undefined ? { title: data.title } : {}),
            ...(data.description !== undefined ? { description: data.description } : {}),
            ...(data.status !== undefined ? { status: data.status } : {}),
          },
        })
        return { status: taskWriteResults.succeeded, value: toTask(updated) }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    )
  },

  /**
   * Organization → 操作者のMembership → 親Project → 対象Taskの順でロックし、最新ロールで認可したうえでタスクを完全削除する。
   * 権限が足りなければ親Projectや対象の有無にかかわらず拒否する（認可を親Projectのロックより先に行う）。
   */
  remove: async <TRejection>(input: RemoveTaskInput, authorize: AuthorizeTaskWrite<TRejection>): Promise<TaskWriteResult<null, TRejection>> => {
    const { organizationId, projectId, taskId, actorUserId } = input

    return prisma.$transaction(
      async (tx): Promise<TaskWriteResult<null, TRejection>> => {
        const denied = await lockOrganizationAndProject(tx, organizationId, projectId, actorUserId, authorize)
        if (denied) {
          return denied
        }
        if (!(await lockTask(tx, projectId, taskId))) {
          return { status: taskWriteResults.taskNotFound }
        }

        // ロック済みのため削除は必ず1件になるが、0件なら対象なしとして扱う。
        const deleted = await tx.task.deleteMany({ where: { id: taskId, projectId } })
        if (deleted.count !== 1) {
          return { status: taskWriteResults.taskNotFound }
        }
        return { status: taskWriteResults.succeeded, value: null }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    )
  },
}
