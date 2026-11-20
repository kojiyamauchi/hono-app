/** タスクの状態の定義（DBのTaskStatus enumと同じ値）。表示順は未着手 → 進行中 → 完了。 */
export const taskStatuses = ['TODO', 'IN_PROGRESS', 'DONE'] as const

/** タスクの状態。3状態の間は自由に変更できる。 */
export type TaskStatus = (typeof taskStatuses)[number]

/** 作成時に状態を省略した場合の既定の状態。 */
export const DEFAULT_TASK_STATUS: TaskStatus = 'TODO'

/**
 * Taskドメインエンティティ。
 * プロジェクトの資産として扱い、所属組織は親Projectから確定する（organizationIdや作成者への参照は持たない）。
 */
export type Task = {
  id: number
  projectId: number
  title: string
  /** 説明。未設定はnull。空文字も有効な値として扱う。 */
  description: string | null
  status: TaskStatus
  createdAt: Date
  updatedAt: Date
}
