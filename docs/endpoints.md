# エンドポイント一覧

このドキュメントは、公開APIエンドポイント一覧の正本です。

APIの追加・変更・削除を行う場合は、実装と同じPRでこのドキュメントも更新してください。

## 共通

| Method | Path               | 認証 | 概要                                                        |
| ------ | ------------------ | ---- | ----------------------------------------------------------- |
| GET    | `/`                | 不要 | 動作確認用のテキストを返す                                  |
| GET    | `/health`          | 不要 | ヘルスチェック結果を返す                                    |
| GET    | `/open-api/doc`    | 不要 | OpenAPI JSONを返す（`ENABLE_API_DOCS=true` のときのみ登録） |
| GET    | `/open-api/scalar` | 不要 | Scalar UIを返す（`ENABLE_API_DOCS=true` のときのみ登録）    |

## Auth

リフレッシュトークンは `HttpOnly Cookie`（`Path=/auth`）で管理する。`/auth/refresh` と `/auth/logout` はリクエストbodyでリフレッシュトークンを受け取らない。

IP単位のレート制限は、ALBからだけタスクへ接続できる1段のプロキシ構成を前提に、ALBが `X-Forwarded-For` の末尾へ追記した有効なIPを使う。クライアントが指定できる先頭値と `X-Real-IP` は信用しない。ALBの手前へCDN等を追加する場合は、信頼するプロキシ構成とIPの取得方法を見直すこと。

| Method | Path                               | 認証                           | 概要                                                                                              |
| ------ | ---------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------- |
| POST   | `/auth/signup`                     | 不要                           | ユーザーを登録する（IP単位制限時は429）                                                           |
| POST   | `/auth/login`                      | 不要                           | ログインして認証トークンを取得する（IP単位・email単位制限時は429）                                |
| POST   | `/auth/refresh`                    | Cookie（リフレッシュトークン） | Cookieのリフレッシュトークンをローテーションしてアクセストークンを再発行する                      |
| POST   | `/auth/logout`                     | Cookie（リフレッシュトークン） | Cookieのリフレッシュトークンに対応するログインセッションを失効する                                |
| GET    | `/auth/me`                         | 必要                           | 認証トークンに紐づくユーザー情報を取得する                                                        |
| POST   | `/auth/change-password`            | 必要                           | 現在のパスワードを検証して新しいパスワードへ変更し、全リフレッシュセッションを失効する            |
| POST   | `/auth/logout-all`                 | 必要                           | 認証済みユーザーの全リフレッシュセッションを失効する                                              |
| GET    | `/auth/sessions`                   | 必要                           | 認証済みユーザーのリフレッシュセッション一覧を取得する                                            |
| DELETE | `/auth/sessions/:id`               | 必要                           | 認証済みユーザー自身の指定リフレッシュセッションを失効する                                        |
| POST   | `/auth/password-reset/request`     | 不要                           | パスワードリセット用トークンを発行し通知する（登録有無・email単位制限時は202、IP単位制限時は429） |
| POST   | `/auth/password-reset/confirm`     | 不要                           | リセットトークンを使い新しいパスワードを設定する                                                  |
| POST   | `/auth/email-verification/request` | 必要                           | メールアドレス検証用トークンを発行し通知する（検証済みは409、ユーザー単位制限時は429）            |
| POST   | `/auth/email-verification/confirm` | 不要                           | 検証トークンを使いメールアドレスを検証済みにする                                                  |

## Supabase Auth

GCPのdev環境では、以下を含む全エンドポイントへのアクセスをIAPで制限します。表の認証欄はアプリ側の認証を示します。Supabase Authの確認メールはSupabase側で検証し、独自認証の確認APIとは分けて扱います。

| Method | Path                    | 認証 | 概要                                                  |
| ------ | ----------------------- | ---- | ----------------------------------------------------- |
| POST   | `/supabase-auth/signup` | 不要 | Supabase Authでユーザーを登録する                     |
| POST   | `/supabase-auth/login`  | 不要 | Supabase Authでログインする                           |
| GET    | `/supabase-auth/me`     | 必要 | Supabase Authの認証情報に紐づくユーザー情報を取得する |

## Users

| Method | Path         | 認証 | 概要                                               |
| ------ | ------------ | ---- | -------------------------------------------------- |
| GET    | `/users/me`  | 必要 | 認証トークンに紐づくユーザー情報を取得する         |
| PATCH  | `/users/me`  | 必要 | 認証トークンに紐づくユーザー情報を更新する         |
| DELETE | `/users/me`  | 必要 | 現在のパスワードで本人確認し、アカウントを削除する |
| GET    | `/users/:id` | 必要 | 指定したユーザーの公開情報を取得する               |

## Organizations

一覧APIのページネーション仕様・利用例・カーソル式とオフセット式の使い分けは [pagination.md](pagination.md) を参照してください。

| Method | Path                                    | 認証 | 概要                                                                                                                        |
| ------ | --------------------------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/organizations`                        | 必要 | 組織を作成する                                                                                                              |
| GET    | `/organizations`                        | 必要 | 自分が所属する組織一覧をオフセット式ページネーションで取得する（`limit` / `offset`、詳細は [pagination.md](pagination.md)） |
| GET    | `/organizations/:id`                    | 必要 | 所属している組織の詳細を取得する                                                                                            |
| PATCH  | `/organizations/:id`                    | 必要 | OWNERまたはADMINが組織情報を更新する                                                                                        |
| DELETE | `/organizations/:id`                    | 必要 | OWNERのみ、組織を削除する                                                                                                   |
| POST   | `/organizations/:id/transfer-ownership` | 必要 | OWNERが既存のADMINまたはMEMBERへ組織の所有権を移譲する（成立時は監査ログ `OWNERSHIP_TRANSFERRED` を記録する）               |

## Organization Members

| Method | Path                                       | 認証 | 概要                                                                                                                              |
| ------ | ------------------------------------------ | ---- | --------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/organizations/:id/members`               | 必要 | 所属している組織のメンバー一覧をカーソル式ページネーションで取得する（`limit` / `cursor`、詳細は [pagination.md](pagination.md)） |
| POST   | `/organizations/:id/members`               | 必要 | OWNERまたはADMINがメンバーを追加する                                                                                              |
| DELETE | `/organizations/:id/members/me`            | 必要 | ADMINまたはMEMBERが自分自身を組織から脱退させる                                                                                   |
| PATCH  | `/organizations/:id/members/:membershipId` | 必要 | OWNERまたはADMINがメンバーのロールを更新する（実際にロールが変わったときは監査ログを記録する）                                    |
| DELETE | `/organizations/:id/members/:membershipId` | 必要 | OWNERまたはADMINがメンバーを削除する（204を返したときは監査ログ `MEMBER_REMOVED` を記録する。記録に失敗した場合は削除も取り消され500） |

## Organization Audit Logs

| Method | Path                            | 認証 | 概要                                                                                                                                          |
| ------ | ------------------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/organizations/:id/audit-logs` | 必要 | OWNERまたはADMINが組織の監査ログを新しい順にカーソル式ページネーションで取得する（`limit` / `cursor`、詳細は [pagination.md](pagination.md)） |

監査ログの記録対象と閲覧の仕様は次のとおりです。

- 記録するのは次の3種類のイベントだけです。
  - `MEMBER_ROLE_CHANGED`: `PATCH /organizations/:id/members/:membershipId` で**実際にロールが変わったとき**。同じロールを指定した場合（200）や、権限不足・OWNER対象などで拒否された場合は記録しません。
  - `OWNERSHIP_TRANSFERRED`: `POST /organizations/:id/transfer-ownership` で**移譲が成立したとき**（204）。移譲先の昇格と移譲元の降格をまとめて1回の操作として1件記録します。認可・入力・対象・競合のエラーでは記録しません。
  - `MEMBER_REMOVED`: `DELETE /organizations/:id/members/:membershipId` で**管理者による削除が成立したとき**（204）。入力・認可・対象のエラー（400・401・403・404・409）では記録しません。同時に自主脱退と競合した場合は、先に確定した側だけが成立し、管理者による削除が先に成立したときだけ1件記録します（後続の自主脱退は404）。
  - メンバーの追加、自主脱退（`DELETE /organizations/:id/members/me`）、アカウント削除に伴うメンバーシップの消滅、招待は記録対象外です。過去の移譲・削除は遡って記録しません。
- イベント種別ごとの項目の意味は次のとおりです。

  | 項目                 | `MEMBER_ROLE_CHANGED`        | `OWNERSHIP_TRANSFERRED`                                                 | `MEMBER_REMOVED`                                   |
  | -------------------- | ---------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------- |
  | `actorUserId`        | ロールを変更した操作者       | 移譲元のOWNER（移譲後はADMINになる）                                    | メンバーを削除した操作者                           |
  | `targetUserId`       | ロールが変わった対象ユーザー | 移譲先のユーザー                                                        | 削除されたユーザー                                 |
  | `targetMembershipId` | 対象のメンバーシップ         | 移譲先のメンバーシップ                                                  | 削除されたメンバーシップ（記録時点の値）           |
  | `previousRole`       | 対象の変更前のロール         | ロック取得後に確認した移譲先の変更前のロール（`ADMIN` または `MEMBER`） | ロック取得後に確認した削除前のロール（`ADMIN` または `MEMBER`） |
  | `newRole`            | 対象の変更後のロール         | 常に `OWNER`（移譲元がOWNERからADMINになったことも表す）                | 常に `null`（変更後のロールが存在しない）          |

- ロールの更新・メンバーの削除と記録は同じトランザクションで確定します。記録に失敗した場合はロールの更新（所有権移譲では移譲先と移譲元の両方の更新）やメンバーの削除も取り消され、500を返します。メンバー削除は、ロール変更・所有権移譲・自主脱退と行ロックで直列化され、確定後の最新のロールで認可と記録を行います。
- 3種のイベントは同じ一覧に混在して返り、並び順（`createdAt DESC, id DESC`）・カーソル・閲覧権限はイベント種別によらず共通です。
- レスポンスは `{ items, nextCursor }` です。各itemは `id`・`organizationId`・`action`・`actorUserId`・`targetUserId`・`targetMembershipId`・`previousRole`・`newRole`・`createdAt`（ISO 8601）を持ちます。`newRole` は常にキーを返し、`MEMBER_REMOVED` では `null`、ほかの2種ではロールの値です（DBのCHECK制約で `MEMBER_REMOVED` のときだけ `null` を許可します）。氏名・メールアドレス・認証情報は保存せず、ユーザーとメンバーシップのIDは記録時点の値です。
- 対象メンバーの削除・脱退や、操作者・対象のアカウント削除後も、組織が残る間は記録を閲覧できます。組織を削除すると記録も削除されます。
- ステータスは、未認証401、不正な組織ID・不正なquery（未対応の `offset`、不正なlimit・cursorを含む）400、未所属または存在しない組織404、所属MEMBER403です。確認の順序は 認証 → パス検証 → 所属確認 → ロール確認 → query検証 です。

## Organization Invitations

| Method | Path                                           | 認証 | 概要                                                           |
| ------ | ---------------------------------------------- | ---- | -------------------------------------------------------------- |
| GET    | `/organizations/:id/invitations`               | 必要 | OWNERまたはADMINがPENDING状態の招待一覧を取得する              |
| POST   | `/organizations/:id/invitations`               | 必要 | OWNERまたはADMINが招待を作成する（配信有効時は配信待ちも保存） |
| DELETE | `/organizations/:id/invitations/:invitationId` | 必要 | OWNERまたはADMINがPENDING状態の招待をキャンセルする            |

招待作成の `201 Created` は招待の保存を示します。メール配信が有効な環境では、配信待ちも同時に保存されます。GCP devではJobを手動実行したときに配信します。将来、定期実行を有効にした場合は、通常は次の起動まで最大約15分かかり、障害時や配信待ちが多い場合はさらに遅れます。配信設定と状態の確認方法は[招待メールの運用手順](invitation-email.md)を参照してください。

## Invitations

| Method | Path                   | 認証 | 概要                                                                                 |
| ------ | ---------------------- | ---- | ------------------------------------------------------------------------------------ |
| GET    | `/invitations/:token`  | 不要 | 招待トークンから招待詳細を取得する                                                   |
| POST   | `/invitations/accept`  | 必要 | 招待トークンを指定して招待を受諾し、組織メンバーになる                               |
| POST   | `/invitations/decline` | 不要 | 招待トークンを指定して招待を辞退する                                                 |
| POST   | `/invitations/signup`  | 不要 | 招待トークンを指定して新規登録し、組織メンバーになる（リフレッシュトークンはCookie） |
