import type { ItemDtoType, ListDtoType } from '../dtos/tasks'
import type { Task, TaskStatus } from '../entities/tasks'
import { cursorPayloadSchema, TASK_CURSOR_KIND, TASK_CURSOR_VERSION } from '../schemas/tasks'

/**
 * タスク一覧カーソルが指す境界値（この行より後ろ、つまりより古い行を取得する）。
 * `organizationId`・`projectId`・`status` はカーソルを発行した条件で、別組織・別プロジェクト・別状態フィルターへの
 * 使い回しを検出するために含める。`status` は状態フィルター未指定ならnull。
 */
export type TaskCursorBoundary = {
  organizationId: number
  projectId: number
  status: TaskStatus | null
  createdAt: Date
  id: number
}

/**
 * 境界値をタスク一覧用の不透明なカーソル文字列へ変換する（JSONをbase64urlで包む）。
 * 他APIのカーソルと区別するため `kind` を含める。
 * 署名・暗号化は行わない。デコードすれば内容を読めて改変もできる前提のため、機密情報を含めないこと。
 */
export const encodeTaskCursor = (boundary: TaskCursorBoundary): string => {
  const json = JSON.stringify({
    kind: TASK_CURSOR_KIND,
    version: TASK_CURSOR_VERSION,
    organizationId: boundary.organizationId,
    projectId: boundary.projectId,
    status: boundary.status,
    createdAt: boundary.createdAt.toISOString(),
    id: boundary.id,
  })
  return Buffer.from(json, 'utf8').toString('base64url')
}

/**
 * タスク一覧用のカーソル文字列を境界値へ戻す。
 * 形式・値が不正、または `kind` が一致しない（別APIのカーソル）なら `null` を返し、呼び出し側で400へ変換する。
 * 発行時と同じ正規のbase64url文字列だけを受け付ける（不正な文字の付加や `=` パディングは不正として扱う）。
 * 対象の組織・プロジェクト・状態の一致はservice層が認可済みの値と突き合わせて確認する。
 */
export const decodeTaskCursor = (raw: string): TaskCursorBoundary | null => {
  let parsed: unknown
  try {
    const decoded = Buffer.from(raw, 'base64url')
    // `Buffer.from(raw, 'base64url')` は不正な文字を黙って無視するため、再エンコード結果が入力と一致しない
    // （発行時と異なる形式に改変された）カーソルは不正にする。
    if (decoded.toString('base64url') !== raw) {
      return null
    }
    parsed = JSON.parse(decoded.toString('utf8'))
  } catch {
    return null
  }

  const result = cursorPayloadSchema.safeParse(parsed)
  if (!result.success) {
    return null
  }

  return {
    organizationId: result.data.organizationId,
    projectId: result.data.projectId,
    status: result.data.status,
    createdAt: new Date(result.data.createdAt),
    id: result.data.id,
  }
}

/**
 * タスクをレスポンス用DTO（7項目）へ変換する。`description` は未設定でもnullで返し、日時はISO 8601文字列にする。
 */
export const toTaskResponse = (task: Task): ItemDtoType => {
  return {
    id: task.id,
    projectId: task.projectId,
    title: task.title,
    description: task.description,
    status: task.status,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  }
}

/**
 * タスクのページをカーソル式ページネーションの応答DTOへ変換する。
 * `nextCursor` が `null` なら後続のページは存在しない。
 */
export const toTaskListResponse = (tasks: Task[], nextCursor: string | null): ListDtoType => {
  return {
    items: tasks.map(toTaskResponse),
    nextCursor,
  }
}
