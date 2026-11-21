import type { Role } from '@/shared/membership/entities'
import { AppError } from '@/utils/errors'

import type { ItemDtoType as TaskDtoType, ListDtoType as TaskListDtoType } from '../dtos/tasks'
import { DEFAULT_TASK_STATUS, type TaskStatus } from '../entities/tasks'
import { decodeTaskCursor, encodeTaskCursor, toTaskListResponse, toTaskResponse } from '../mappers/tasks'
import { type TaskPageBoundary, tasksRepository, taskWriteResults } from '../repositories/tasks'

/** タスク作成の入力。`description` を省略した場合はnull、`status` を省略した場合はTODOとして保存する。 */
export type CreateTaskInput = {
  title: string
  description?: string | null
  status?: TaskStatus
}

/** タスク更新の入力。指定された項目だけを更新し、`description: null` は説明の削除を表す。 */
export type UpdateTaskInput = {
  title?: string
  description?: string | null
  status?: TaskStatus
}

/**
 * ロック後に確定した操作者のロールに対して、タスクの作成・更新の認可規則を適用する。
 * OWNER / ADMIN / MEMBER を明示的に許可し、それ以外（未知のロール）は拒否する。
 * 許可なら `null`、拒否ならステータス付きの `AppError` を返す（repositoryはHTTPエラーを知らないため、返却値を呼び出し側でthrowする）。
 */
const authorizeTaskWrite = (operatorRole: Role): AppError | null => {
  if (operatorRole === 'OWNER' || operatorRole === 'ADMIN' || operatorRole === 'MEMBER') {
    return null
  }
  return new AppError(403, 'この操作を行う権限がありません')
}

/**
 * ロック後に確定した操作者のロールに対して、タスクの完全削除の認可規則を適用する。
 * OWNER / ADMIN だけを許可し、それ以外（MEMBERや未知のロール）は拒否する。
 */
const authorizeTaskRemove = (operatorRole: Role): AppError | null => {
  if (operatorRole === 'OWNER' || operatorRole === 'ADMIN') {
    return null
  }
  return new AppError(403, 'この操作には管理者以上の権限が必要です')
}

/**
 * 書き込み系repositoryの失敗結果（成功以外）をAppErrorへ変換する。
 * 未知の結果は暗黙の成功にせず、想定外の失敗（500）として扱う。
 */
const failWriteResult = (result: { status: string; rejection?: unknown }): never => {
  if (result.status === taskWriteResults.organizationNotFound) {
    throw new AppError(404, '組織が見つかりません')
  }
  if (result.status === taskWriteResults.projectNotFound) {
    throw new AppError(404, 'プロジェクトが見つかりません')
  }
  if (result.status === taskWriteResults.taskNotFound) {
    throw new AppError(404, 'タスクが見つかりません')
  }
  if (result.status === taskWriteResults.rejected && result.rejection instanceof AppError) {
    throw result.rejection
  }
  throw new Error('タスク操作の結果が不明です')
}

/**
 * プロジェクト配下のタスクのユースケースを提供するサービス。
 * 書き込みの認可は、middlewareが読んだロールではなく、repositoryがロックした後の最新ロールに対して判定する。
 * そのため書き込み系は操作者のロールを引数で受け取らず、認証済みユーザーIDだけを受け取る。
 */
export const tasksService = {
  /**
   * プロジェクトのタスク一覧を新しい順にカーソル式で1ページ分返す。組織メンバーなら閲覧可（ミドルウェアで確認済み）。
   * `status` が指定された場合はその状態のタスクだけを返す（DBの取得条件で絞り込む）。
   * 次ページの有無は `limit + 1` 件の取得で判定し、レスポンスのitemsは `limit` 件以下にする。
   * 形式が不正なカーソル、別APIで発行されたカーソル（kind不一致）、未対応バージョン、
   * 別組織・別プロジェクト・別の状態フィルターで発行されたカーソルはいずれも400とする（親Projectの確認より先に判定する）。
   * 認可はカーソル内のIDではなく、引数で渡された認可済みの組織・プロジェクトで毎回適用し、基準行の存在にも依存しない。
   * 親Projectが指定組織内に存在しない場合は404、存在してタスクが0件なら空配列を返す。
   */
  list: async (organizationId: number, projectId: number, limit: number, status?: TaskStatus, cursor?: string): Promise<TaskListDtoType> => {
    const statusFilter = status ?? null

    let boundary: TaskPageBoundary | null = null
    if (cursor !== undefined) {
      const decoded = decodeTaskCursor(cursor)
      if (decoded === null || decoded.organizationId !== organizationId || decoded.projectId !== projectId || decoded.status !== statusFilter) {
        throw new AppError(400, 'カーソルが不正です')
      }
      boundary = { createdAt: decoded.createdAt, id: decoded.id }
    }

    if (!(await tasksRepository.projectExists(organizationId, projectId))) {
      throw new AppError(404, 'プロジェクトが見つかりません')
    }

    const tasks = await tasksRepository.list(organizationId, projectId, statusFilter, limit + 1, boundary)
    const items = tasks.slice(0, limit)
    const last = items.at(-1)
    const nextCursor =
      tasks.length > limit && last !== undefined
        ? encodeTaskCursor({ organizationId, projectId, status: statusFilter, createdAt: last.createdAt, id: last.id })
        : null

    return toTaskListResponse(items, nextCursor)
  },

  /**
   * プロジェクト内のタスクを1件返す。指定組織・プロジェクト内に存在しない（別組織・別プロジェクトのIDを含む）場合は404。
   */
  getById: async (organizationId: number, projectId: number, taskId: number): Promise<TaskDtoType> => {
    const task = await tasksRepository.getById(organizationId, projectId, taskId)
    if (!task) {
      throw new AppError(404, 'タスクが見つかりません')
    }
    return toTaskResponse(task)
  },

  /**
   * タスクを作成する。OWNER / ADMIN / MEMBERが可。省略された説明はnull、状態はTODOとして保存する。
   */
  create: async (organizationId: number, projectId: number, actorUserId: number, input: CreateTaskInput): Promise<TaskDtoType> => {
    const result = await tasksRepository.create<AppError>(
      {
        organizationId,
        projectId,
        actorUserId,
        title: input.title,
        description: input.description ?? null,
        status: input.status ?? DEFAULT_TASK_STATUS,
      },
      (locked) => authorizeTaskWrite(locked.operatorRole),
    )

    if (result.status === taskWriteResults.succeeded) {
      return toTaskResponse(result.value)
    }
    return failWriteResult(result)
  },

  /**
   * タスクを部分更新する（状態変更を含む）。OWNER / ADMIN / MEMBERが可。指定された項目だけを更新する。
   */
  update: async (organizationId: number, projectId: number, taskId: number, actorUserId: number, input: UpdateTaskInput): Promise<TaskDtoType> => {
    const result = await tasksRepository.update<AppError>(
      {
        organizationId,
        projectId,
        taskId,
        actorUserId,
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
        },
      },
      (locked) => authorizeTaskWrite(locked.operatorRole),
    )

    if (result.status === taskWriteResults.succeeded) {
      return toTaskResponse(result.value)
    }
    return failWriteResult(result)
  },

  /**
   * タスクを完全削除する。OWNER / ADMINのみ可。削除済みへの再削除は404。
   * MEMBERは親ProjectやTaskの有無にかかわらず403（対象の存在を漏らさない）。
   */
  remove: async (organizationId: number, projectId: number, taskId: number, actorUserId: number): Promise<void> => {
    const result = await tasksRepository.remove<AppError>({ organizationId, projectId, taskId, actorUserId }, (locked) =>
      authorizeTaskRemove(locked.operatorRole),
    )

    if (result.status === taskWriteResults.succeeded) {
      return
    }
    return failWriteResult(result)
  },
}
