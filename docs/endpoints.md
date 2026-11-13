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
| DELETE | `/organizations/:id`                    | 必要 | OWNERのみ、組織を削除する（メンバーシップ・招待・監査ログ・プロジェクトも同時に削除される）                                |
| POST   | `/organizations/:id/transfer-ownership` | 必要 | OWNERが既存のADMINまたはMEMBERへ組織の所有権を移譲する（成立時は監査ログ `OWNERSHIP_TRANSFERRED` を記録する）               |

## Organization Members

| Method | Path                                       | 認証 | 概要                                                                                                                                   |
| ------ | ------------------------------------------ | ---- | -------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/organizations/:id/members`               | 必要 | 所属している組織のメンバー一覧をカーソル式ページネーションで取得する（`limit` / `cursor`、詳細は [pagination.md](pagination.md)）      |
| POST   | `/organizations/:id/members`               | 必要 | OWNERまたはADMINがメンバーを追加する                                                                                                   |
| DELETE | `/organizations/:id/members/me`            | 必要 | ADMINまたはMEMBERが自分自身を組織から脱退させる                                                                                        |
| PATCH  | `/organizations/:id/members/:membershipId` | 必要 | OWNERまたはADMINがメンバーのロールを更新する（実際にロールが変わったときは監査ログを記録する）                                         |
| DELETE | `/organizations/:id/members/:membershipId` | 必要 | OWNERまたはADMINがメンバーを削除する（204を返したときは監査ログ `MEMBER_REMOVED` を記録する。記録に失敗した場合は削除も取り消され500） |

## Organization Projects

組織が所有するプロジェクトのCRUDです。すべてBearerアクセストークンが必要で、組織のメンバーシップを確認します。プロジェクトは組織の資産として扱い、作成したユーザーが脱退・アカウント削除をしても残ります。同名のプロジェクトも作成できます（IDで識別します）。

| Method | Path                                     | 認証 | 概要                                                                                                                                          |
| ------ | ---------------------------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/organizations/:id/projects`            | 必要 | OWNERまたはADMINがプロジェクトを作成する（201、作成したProject）                                                                              |
| GET    | `/organizations/:id/projects`            | 必要 | 組織の全メンバーがプロジェクト一覧を新しい順にカーソル式ページネーションで取得する（`limit` / `cursor`、詳細は [pagination.md](pagination.md)） |
| GET    | `/organizations/:id/projects/:projectId` | 必要 | 組織の全メンバーがプロジェクトを1件取得する                                                                                                   |
| PATCH  | `/organizations/:id/projects/:projectId` | 必要 | OWNERまたはADMINがプロジェクトを部分更新する（200、更新後のProject）                                                                          |
| DELETE | `/organizations/:id/projects/:projectId` | 必要 | OWNERまたはADMINがプロジェクトを完全削除する（204、本文なし。復元不可）                                                                       |

仕様は次のとおりです。

- Projectは `id` / `organizationId` / `name` / `description` / `createdAt` / `updatedAt` の6項目です。`description` は未設定でも `null` で返します。
- `:id`・`:projectId` は1〜2147483647の整数です。不正値は400です。
- `name` は必須で、前後の空白を除去した後に1〜100文字です。`description` は省略可能かつnullableで、最大2000文字です（trimや空文字→nullの変換はせず、空文字も有効です）。POSTで省略した `description` は `null` として保存します。
- PATCHは `name` / `description` のうち少なくとも1項目が必須で、指定した項目だけを更新します（省略した項目は維持、`description: null` は説明の削除、`name: null` は400）。同値の指定も200で、`updatedAt` は更新されます。
- POST / PATCHで未知の項目（`id`・`organizationId`・日時を含む）を送ると400です。
- 一覧は `createdAt DESC, id DESC` の新しい順で、queryは `limit`（既定20、1〜100）と `cursor` のみです。`offset` などの未知のqueryや空文字・空白は400です。
- 判定順は 401（認証）→ 400（パスパラメータ）→ 404（組織が存在しない、または未所属）→ 403（MEMBERによる書き込み。bodyの検証より先に確定する）→ 400（body / query）→ 404（対象プロジェクトなし。別組織のIDを含む。削除済みへの再削除も404）です。MEMBERの書き込みは対象の有無にかかわらず403です。
- 作成・更新・削除は、トランザクション内でロック取得後の最新の所属・ロールで再判定します。組織または所属が消えていれば404、MEMBERへ降格していれば403、対象プロジェクトが消えていれば404です。
- 作成・実変更・完全削除は、同じトランザクションで監査ログ（`PROJECT_CREATED` / `PROJECT_UPDATED` / `PROJECT_DELETED`）に記録します。記録に失敗した場合は作成・更新・削除も取り消され500です。同値のPATCH（名前・説明がすべて保存済みの値と同じ）は200で `updatedAt` を更新しますが、監査ログは作りません。詳細は[Organization Audit Logs](#organization-audit-logs)を参照してください。

## Organization Audit Logs

| Method | Path                            | 認証 | 概要                                                                                                                                          |
| ------ | ------------------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/organizations/:id/audit-logs` | 必要 | OWNERまたはADMINが組織の監査ログを新しい順にカーソル式ページネーションで取得する（`limit` / `cursor`、詳細は [pagination.md](pagination.md)） |

監査ログの記録対象と閲覧の仕様は次のとおりです。

- 記録するのは次の6種類のイベントだけです。
  - `MEMBER_ROLE_CHANGED`: `PATCH /organizations/:id/members/:membershipId` で**実際にロールが変わったとき**。同じロールを指定した場合（200）や、権限不足・OWNER対象などで拒否された場合は記録しません。
  - `OWNERSHIP_TRANSFERRED`: `POST /organizations/:id/transfer-ownership` で**移譲が成立したとき**（204）。移譲先の昇格と移譲元の降格をまとめて1回の操作として1件記録します。認可・入力・対象・競合のエラーでは記録しません。
  - `MEMBER_REMOVED`: `DELETE /organizations/:id/members/:membershipId` で**管理者による削除が成立したとき**（204）。入力・認可・対象のエラー（400・401・403・404・409）では記録しません。同時に自主脱退と競合した場合は、先に確定した側だけが成立し、管理者による削除が先に成立したときだけ1件記録します（後続の自主脱退は404）。
  - `PROJECT_CREATED`: `POST /organizations/:id/projects` で作成が成立したとき（201）。
  - `PROJECT_UPDATED`: `PATCH /organizations/:id/projects/:projectId` で**名前または説明が実際に変化したとき**。名前と説明を同時に変えても1件です。名前は入力検証後（前後の空白除去後）の値、説明は `null` と空文字を区別して比較します。指定項目がすべて同値なら200で `updatedAt` だけ更新し、記録しません。
  - `PROJECT_DELETED`: `DELETE /organizations/:id/projects/:projectId` で個別の完全削除が成立したとき（204）。削除済みへの再削除（404）は記録しません。組織の削除によるプロジェクトのcascade削除では、プロジェクトごとの削除イベントを作りません（組織の削除で記録も削除されます）。
  - メンバーの追加、自主脱退（`DELETE /organizations/:id/members/me`）、アカウント削除に伴うメンバーシップの消滅、招待、プロジェクトの閲覧は記録対象外です。過去の移譲・削除・プロジェクト操作は遡って記録しません。
- メンバー操作3種のイベントごとの項目の意味は次のとおりです。

  | 項目                 | `MEMBER_ROLE_CHANGED`        | `OWNERSHIP_TRANSFERRED`                                                 | `MEMBER_REMOVED`                                                |
  | -------------------- | ---------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------- |
  | `actorUserId`        | ロールを変更した操作者       | 移譲元のOWNER（移譲後はADMINになる）                                    | メンバーを削除した操作者                                        |
  | `targetUserId`       | ロールが変わった対象ユーザー | 移譲先のユーザー                                                        | 削除されたユーザー                                              |
  | `targetMembershipId` | 対象のメンバーシップ         | 移譲先のメンバーシップ                                                  | 削除されたメンバーシップ（記録時点の値）                        |
  | `previousRole`       | 対象の変更前のロール         | ロック取得後に確認した移譲先の変更前のロール（`ADMIN` または `MEMBER`） | ロック取得後に確認した削除前のロール（`ADMIN` または `MEMBER`） |
  | `newRole`            | 対象の変更後のロール         | 常に `OWNER`（移譲元がOWNERからADMINになったことも表す）                | 常に `null`（変更後のロールが存在しない）                       |

- プロジェクト操作3種は、共通項目に加えて `projectId`（記録時点のID。外部キーではなく、プロジェクト削除後も残る）と、名前・説明のスナップショット `before` / `after` を持ちます。スナップショットは `{ "name": string, "description": string | null }` の2キーだけで、更新では省略した項目も含めて操作前後の両方を保存します。`PROJECT_CREATED` は `before: null`、`PROJECT_DELETED` は `after: null` です（キーは省略されません）。`actorUserId` は操作者です。DBに保存済みの値をそのまま記録し、API入力の文字数上限を超える既存値も切り詰めません。

  ```json
  {
    "id": 501,
    "organizationId": 10,
    "action": "PROJECT_UPDATED",
    "actorUserId": 7,
    "createdAt": "2026-11-13T12:00:00.000Z",
    "projectId": 42,
    "before": { "name": "旧名称", "description": null },
    "after": { "name": "新名称", "description": "" }
  }
  ```

- ロールの更新・メンバーの削除・プロジェクトの作成/更新/削除と記録は同じトランザクションで確定します。記録に失敗した場合はロールの更新（所有権移譲では移譲先と移譲元の両方の更新）やメンバーの削除、プロジェクトの作成・更新・削除も取り消され、500を返します。メンバー削除は、ロール変更・所有権移譲・自主脱退と行ロックで直列化され、確定後の最新のロールで認可と記録を行います。プロジェクト操作は、組織 → 操作者のメンバーシップ → 対象プロジェクトの順にロックし、ロック取得後の最新のロールで認可し、ロック後のDB値を `before`、保存後の値を `after` として記録します。同一プロジェクトの同時更新では、先に確定した更新の `after` が後続の更新の `before` に反映されます。
- 6種のイベントは同じ一覧に混在して返り、並び順（`createdAt DESC, id DESC`）・カーソル・閲覧権限（OWNER / ADMINのみ。プロジェクトを閲覧できるMEMBERにも監査ログの閲覧権限は付きません）はイベント種別によらず共通です。`createdAt` は記録日時（トランザクション開始時刻）で、一覧の順序は操作の確定順を保証しません（[pagination.md](pagination.md#カーソル式-監査ログ一覧)を参照）。
- レスポンスは `{ items, nextCursor }` です。各itemは `action` で区別できる次のいずれかの形です。
  - メンバー操作3種（`MEMBER_ROLE_CHANGED` / `OWNERSHIP_TRANSFERRED` / `MEMBER_REMOVED`）: `id`・`organizationId`・`action`・`actorUserId`・`targetUserId`・`targetMembershipId`・`previousRole`・`newRole`・`createdAt`（ISO 8601）。`newRole` は常にキーを返し、`MEMBER_REMOVED` では `null`、ほかの2種ではロールの値です。プロジェクト向けのキーは含みません。
  - プロジェクト操作3種: `id`・`organizationId`・`action`・`actorUserId`・`createdAt`・`projectId`・`before`・`after`。メンバー向けのキーは含みません。

  DBのCHECK制約で、イベントごとの必須項目・null条件・スナップショットの形状を担保します。氏名・メールアドレス・認証情報は保存せず、ユーザー・メンバーシップ・プロジェクトのIDは記録時点の値です。
- クライアントへの影響は次の2点を分けて確認してください。
  - 既存3イベントの実行時のJSON（項目・値の意味）は変わりません。
  - `action` の値が3種から6種に増え、OpenAPIの `AuditLog` コンポーネントは単一のobjectから6つのコンポーネント（`MemberRoleChangedAuditLog` / `OwnershipTransferredAuditLog` / `MemberRemovedAuditLog` / `ProjectCreatedAuditLog` / `ProjectUpdatedAuditLog` / `ProjectDeletedAuditLog`）の `oneOf`（`action` が判別子）に変わります。生成クライアントでは型の構造・参照先が変わり得るため、enumや `action` の網羅判定（未知の `action` を想定した分岐）の更新と、型の再生成が必要です。
- 対象メンバーの削除・脱退や、操作者・対象のアカウント削除、プロジェクトの完全削除後も、組織が残る間は記録を閲覧できます。組織を削除すると記録も削除されます。
- ステータスは、未認証401、不正な組織ID・不正なquery（未対応の `offset`、不正なlimit・cursorを含む）400、未所属または存在しない組織404、所属MEMBER403です。確認の順序は 認証 → パス検証 → 所属確認 → ロール確認 → query検証 です。

## Organization Invitations

| Method | Path                                                        | 認証 | 概要                                                                         |
| ------ | ----------------------------------------------------------- | ---- | ---------------------------------------------------------------------------- |
| GET    | `/organizations/:id/invitations`                            | 必要 | OWNERまたはADMINがPENDING状態の招待一覧を配信状態付きで取得する              |
| POST   | `/organizations/:id/invitations`                            | 必要 | OWNERまたはADMINが招待を作成する（配信有効時は配信待ちも保存）               |
| DELETE | `/organizations/:id/invitations/:invitationId`              | 必要 | OWNERまたはADMINがPENDING状態の招待をキャンセルする                          |
| POST   | `/organizations/:id/invitations/:invitationId/resend-email` | 必要 | OWNERまたはADMINが拒否された招待メールの再送を1回受け付ける（本文なし、202） |

招待一覧の各要素は、従来の招待項目（`invitationToken` を含む）に加えて、必須項目 `emailDeliveryStatus` を持ちます。値は `PENDING`・`ACCEPTED`・`REJECTED`・`UNKNOWN`・`SKIPPED` のいずれか、または配信記録がない場合の `null` で、DBに保存された招待メール配信の状態を取得時点の値で返します。招待自身の `status` とは別の項目です。配信ID・ResendメールID・エラー・試行回数などの内部情報は返しません。各状態の意味と読み方は[招待メールの運用手順](invitation-email.md#招待一覧での配信状態の確認)を参照してください。

招待作成の `201 Created` は招待の保存を示します。メール配信が有効な環境では、配信待ちも同時に保存されます。GCP devではJobを手動実行したときに配信します。将来、定期実行を有効にした場合は、通常は次の起動まで最大約15分かかり、障害時や配信待ちが多い場合はさらに遅れます。配信設定と状態の確認方法は[招待メールの運用手順](invitation-email.md)を参照してください。

`POST /organizations/:id/invitations/:invitationId/resend-email` は、招待メールの再送を受け付けます。Bearer認証が必要で、リクエスト本文はありません。OWNERはADMIN／MEMBER宛て、ADMINはMEMBER宛ての招待を再送できます（招待作成と同じ権限の境界）。MEMBERは再送できず、OWNER宛ての招待は誰も再送できません。所属とロールは、リクエスト中にロックを取得した後の最新の値で判定します（ロール変更やメンバー削除が先に成立していれば、その結果で判定されます）。次のすべてを満たす場合に、招待ごとに1回だけ受け付けます。

- `ENABLE_INVITATION_EMAIL=true` の環境である。
- 招待がDB上で `PENDING` で、有効期限が判定時刻より後である（有効期限と判定時刻が等しい場合は期限切れ）。
- 初回の配信が `REJECTED` で、受付結果不明ではなく、原因がResendの明示的な拒否（`client` または `rate_limited`）である。配信記録がない招待、ほかの配信状態、`invalid_idempotency` は対象外です。

`202 Accepted`（本文なし）は、新しい配信待ちを保存したことだけを示します。Resendの受付や受信者への配達ではありません。GCP devでは既存の手動Jobを実行したときに処理され、結果は招待一覧の `emailDeliveryStatus` で確認します。招待のID・トークン・宛先・ロール・有効期限は変わりません。

ステータスは、202 受付、400 不正な組織IDまたは招待ID、401 未認証、403 所属MEMBERまたは対象ロールへの権限なし、404 組織・招待が存在しない／未所属／別組織の招待、409 配信設定が無効・招待が無効または期限切れ・再送対象外・再送受付済み、500 配信設定の不備や保存失敗です。確認の順序は 認証 → パス検証 → 所属 → 操作者のロール → 招待 → 対象ロール → 再送受付済み → 設定・状態・期限・対象の確認 → 保存 です。再送を受け付けた後は、再送が再び `REJECTED` になったり招待が期限切れになったりしても、同じ依頼は専用メッセージ `この招待メールの再送は既に受け付けています` の409になります。応答を受け取れなかった場合は同じ依頼をもう一度送り、202またはこの409で受付を確認してください。詳細は[招待メールの運用手順](invitation-email.md#招待メールの手動再送)を参照してください。

## Invitations

| Method | Path                   | 認証 | 概要                                                                                 |
| ------ | ---------------------- | ---- | ------------------------------------------------------------------------------------ |
| GET    | `/invitations/:token`  | 不要 | 招待トークンから招待詳細を取得する                                                   |
| POST   | `/invitations/accept`  | 必要 | 招待トークンを指定して招待を受諾し、組織メンバーになる                               |
| POST   | `/invitations/decline` | 不要 | 招待トークンを指定して招待を辞退する                                                 |
| POST   | `/invitations/signup`  | 不要 | 招待トークンを指定して新規登録し、組織メンバーになる（リフレッシュトークンはCookie） |
