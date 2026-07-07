// 環境変数の型宣言。process.env 経由でアクセスする値に型を付ける。
declare namespace NodeJS {
  interface ProcessEnv {
    /** OpenAPI JSON(/open-api/doc) と Scalar UI(/open-api/scalar) の公開フラグ。'true' のときだけ登録する。 */
    ENABLE_API_DOCS?: string
  }
}
