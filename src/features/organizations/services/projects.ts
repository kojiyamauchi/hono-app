import type { Role } from '@/shared/membership/entities'
import { AppError } from '@/utils/errors'

import type { ProjectDtoType, ProjectListDtoType } from '../dtos/projects'
import { decodeProjectCursor, encodeProjectCursor, toProjectListResponse, toProjectResponse } from '../mappers/projects'
import { type ProjectPageBoundary, projectRepository, projectWriteResults } from '../repositories/projects'

/** プロジェクト作成の入力。`description` を省略した場合はnullとして保存する。 */
export type CreateProjectInput = {
  name: string
  description?: string | null
}

/** プロジェクト更新の入力。指定された項目だけを更新し、`description: null` は説明の削除を表す。 */
export type UpdateProjectInput = {
  name?: string
  description?: string | null
}

/**
 * ロック後に確定した操作者のロールに対して、プロジェクト書き込みの認可規則を適用する。
 * OWNER / ADMIN だけを許可し、それ以外（MEMBERや未知のロール）は拒否する。
 * 許可なら `null`、拒否ならステータス付きの `AppError` を返す（repositoryはHTTPエラーを知らないため、返却値を呼び出し側でthrowする）。
 */
const authorizeProjectWrite = (operatorRole: Role): AppError | null => {
  if (operatorRole === 'OWNER' || operatorRole === 'ADMIN') {
    return null
  }
  return new AppError(403, 'この操作には管理者以上の権限が必要です')
}

/**
 * 書き込み系repositoryの失敗結果（成功以外）をAppErrorへ変換する。
 * 未知の結果は暗黙の成功にせず、想定外の失敗（500）として扱う。
 */
const failWriteResult = (result: { status: string; rejection?: unknown }, messages: { notFound: string }): never => {
  if (result.status === projectWriteResults.organizationNotFound) {
    throw new AppError(404, '組織が見つかりません')
  }
  if (result.status === projectWriteResults.projectNotFound) {
    throw new AppError(404, messages.notFound)
  }
  if (result.status === projectWriteResults.rejected && result.rejection instanceof AppError) {
    throw result.rejection
  }
  throw new Error('プロジェクト操作の結果が不明です')
}

/**
 * 組織配下のプロジェクトのユースケースを提供するサービス。
 * 書き込みの認可は、middlewareが読んだロールではなく、repositoryがロックした後の最新ロールに対して判定する。
 * そのため書き込み系は操作者のロールを引数で受け取らず、認証済みユーザーIDだけを受け取る。
 */
export const projectsService = {
  /**
   * 組織のプロジェクト一覧を新しい順にカーソル式で1ページ分返す。組織メンバーなら閲覧可（ミドルウェアで確認済み）。
   * カーソルは境界値としてのみ使い、基準行が削除されても続きが取得できる（行の存在に依存しない）。
   * 次ページの有無は `limit + 1` 件の取得で判定し、レスポンスのitemsは `limit` 件以下にする。
   * 形式が不正なカーソル、別APIで発行されたカーソル（kind不一致）、未対応バージョン、別組織で発行されたカーソルはいずれも400とする。
   */
  list: async (organizationId: number, limit: number, cursor?: string): Promise<ProjectListDtoType> => {
    let boundary: ProjectPageBoundary | null = null
    if (cursor !== undefined) {
      const decoded = decodeProjectCursor(cursor)
      if (decoded === null || decoded.organizationId !== organizationId) {
        throw new AppError(400, 'カーソルが不正です')
      }
      boundary = { createdAt: decoded.createdAt, id: decoded.id }
    }

    // 認可はカーソル内の組織情報ではなく、引数で渡された認可済みのorganizationIdで毎回適用する
    const projects = await projectRepository.findPageByOrganization(organizationId, limit + 1, boundary)
    const items = projects.slice(0, limit)
    const last = items.at(-1)
    const nextCursor = projects.length > limit && last !== undefined ? encodeProjectCursor({ organizationId, createdAt: last.createdAt, id: last.id }) : null

    return toProjectListResponse(items, nextCursor)
  },

  /**
   * 組織内のプロジェクトを1件返す。指定組織内に存在しない（別組織のIDを含む）場合は404。
   */
  getById: async (organizationId: number, projectId: number): Promise<ProjectDtoType> => {
    const project = await projectRepository.findByOrganizationAndId(organizationId, projectId)
    if (!project) {
      throw new AppError(404, 'プロジェクトが見つかりません')
    }
    return toProjectResponse(project)
  },

  /**
   * プロジェクトを作成する。OWNER / ADMINのみ可。省略された説明はnullとして保存する。
   */
  create: async (organizationId: number, actorUserId: number, input: CreateProjectInput): Promise<ProjectDtoType> => {
    const result = await projectRepository.createWithAuthorization<AppError>(
      { organizationId, actorUserId, name: input.name, description: input.description ?? null },
      (locked) => authorizeProjectWrite(locked.operatorRole),
    )

    if (result.status === projectWriteResults.succeeded) {
      return toProjectResponse(result.value)
    }
    return failWriteResult(result, { notFound: 'プロジェクトが見つかりません' })
  },

  /**
   * プロジェクトを部分更新する。OWNER / ADMINのみ可。指定された項目だけを更新する。
   * MEMBERは対象の有無にかかわらず403（対象の存在を漏らさない）。
   */
  update: async (organizationId: number, projectId: number, actorUserId: number, input: UpdateProjectInput): Promise<ProjectDtoType> => {
    const result = await projectRepository.updateWithAuthorization<AppError>(
      {
        organizationId,
        projectId,
        actorUserId,
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
        },
      },
      (locked) => authorizeProjectWrite(locked.operatorRole),
    )

    if (result.status === projectWriteResults.succeeded) {
      return toProjectResponse(result.value)
    }
    return failWriteResult(result, { notFound: 'プロジェクトが見つかりません' })
  },

  /**
   * プロジェクトを完全削除する。OWNER / ADMINのみ可。削除済みへの再削除は404。
   * MEMBERは対象の有無にかかわらず403（対象の存在を漏らさない）。
   */
  remove: async (organizationId: number, projectId: number, actorUserId: number): Promise<void> => {
    const result = await projectRepository.removeWithAuthorization<AppError>({ organizationId, projectId, actorUserId }, (locked) =>
      authorizeProjectWrite(locked.operatorRole),
    )

    if (result.status === projectWriteResults.succeeded) {
      return
    }
    return failWriteResult(result, { notFound: 'プロジェクトが見つかりません' })
  },
}
