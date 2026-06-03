/**
 * アプリケーション共通のエラークラス。
 * HTTPステータスコードとメッセージを保持し、onErrorで統一レスポンスに変換する。
 */
export class AppError extends Error {
  public readonly statusCode: number

  public constructor(statusCode: number, message: string) {
    super(message)
    this.name = 'AppError'
    this.statusCode = statusCode
  }
}
