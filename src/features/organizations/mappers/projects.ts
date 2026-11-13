import type { ProjectDtoType, ProjectListDtoType } from '../dtos/projects'
import type { Project } from '../entities/projects'
import { PROJECT_CURSOR_KIND, PROJECT_CURSOR_VERSION, projectCursorPayloadSchema } from '../schemas/projects'

/**
 * プロジェクト一覧カーソルが指す境界値（この行より後ろ、つまりより古い行を取得する）。
 * `organizationId` はカーソルを発行した組織で、別組織への使い回しを検出するために含める。
 */
export type ProjectCursorBoundary = { organizationId: number; createdAt: Date; id: number }

/**
 * 境界値をプロジェクト一覧用の不透明なカーソル文字列へ変換する（JSONをbase64urlで包む）。
 * 他APIのカーソルと区別するため `kind` を含める。
 * 署名・暗号化は行わない。デコードすれば内容を読めて改変もできる前提のため、機密情報を含めないこと。
 */
export const encodeProjectCursor = (boundary: ProjectCursorBoundary): string => {
  const json = JSON.stringify({
    kind: PROJECT_CURSOR_KIND,
    version: PROJECT_CURSOR_VERSION,
    organizationId: boundary.organizationId,
    createdAt: boundary.createdAt.toISOString(),
    id: boundary.id,
  })
  return Buffer.from(json, 'utf8').toString('base64url')
}

/**
 * プロジェクト一覧用のカーソル文字列を境界値へ戻す。
 * 形式・値が不正、または `kind` が一致しない（別APIのカーソル）なら `null` を返し、呼び出し側で400へ変換する。
 * 発行時と同じ正規のbase64url文字列だけを受け付ける（不正な文字の付加や `=` パディングは不正として扱う）。
 * 対象組織の一致はservice層が認可済みのorganizationIdと突き合わせて確認する。
 */
export const decodeProjectCursor = (raw: string): ProjectCursorBoundary | null => {
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

  const result = projectCursorPayloadSchema.safeParse(parsed)
  if (!result.success) {
    return null
  }

  return {
    organizationId: result.data.organizationId,
    createdAt: new Date(result.data.createdAt),
    id: result.data.id,
  }
}

/**
 * プロジェクトをレスポンス用DTOへ変換する。`description` は未設定でもnullで返し、日時はISO 8601文字列にする。
 */
export const toProjectResponse = (project: Project): ProjectDtoType => {
  return {
    id: project.id,
    organizationId: project.organizationId,
    name: project.name,
    description: project.description,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  }
}

/**
 * プロジェクトのページをカーソル式ページネーションの応答DTOへ変換する。
 * `nextCursor` が `null` なら後続のページは存在しない。
 */
export const toProjectListResponse = (projects: Project[], nextCursor: string | null): ProjectListDtoType => {
  return {
    items: projects.map(toProjectResponse),
    nextCursor,
  }
}
