# ページネーション

このドキュメントは、一覧APIのページネーション仕様・利用例・両方式の使い分けの正本です。

このリポジトリでは、カーソル式とオフセット式の設計・実装上の違いを比較するために、意図的に両方を実装しています。片方へ統一することが目的ではありません。

| 方式         | 対象API                             | 位置の指定 | ページ情報                     |
| ------------ | ----------------------------------- | ---------- | ------------------------------ |
| カーソル式   | `GET /organizations/:id/members`    | `cursor`   | `nextCursor`                   |
| カーソル式   | `GET /organizations/:id/audit-logs` | `cursor`   | `nextCursor`                   |
| オフセット式 | `GET /organizations`                | `offset`   | `limit` / `offset` / `hasNext` |

エンドポイントの一覧は [endpoints.md](endpoints.md) を参照してください。

## 共通仕様

- `limit` は省略時20、1〜100の整数です。
- queryを指定しない場合も既定件数で最初のページを返します。全件取得へフォールバックしません。
- レスポンスの配列キーは、両方式とも `items` に統一しています。既存の `GET /auth/sessions` は配列キーが `sessions` ですが、今回のページネーション対象外のため変更していません。今後ページネーションを展開する一覧APIは `items` に揃えます。
- 不正なquery（空文字、空白のみ、範囲外、整数ではない値）は400を返し、本文は既存のエラー形式 `{ "error": { "message": "..." } }` です。
  - 既定値が使われるのはパラメータを**指定しなかった**場合だけです。`?offset=` のように明示した空の値は、先頭ページへのフォールバックではなく400になります。
- 各方式で未対応の位置指定パラメータは400になります。カーソル式へ `offset` を、オフセット式へ `cursor` を渡した場合、黙って無視せずエラーにします。
- ページ情報の形は方式ごとに意図的に非対称です。カーソル式は `nextCursor !== null` で次ページの有無も分かるため、`limit` のエコーと `hasNext` を持ちません。オフセット式は数値による位置を示す `limit`・`offset` と、後続の有無を示す `hasNext` を返します。
- 次ページ判定は最大 `limit + 1` 件の取得で行い、レスポンスの `items` は `limit` 件以下です。全件取得後に配列を分割する実装はしていません。
- 認証・認可はページ位置にかかわらず適用され、所属する組織のデータだけを返します。監査ログ一覧は、さらに対象組織のOWNER / ADMINに限定します。
- **ページをまたぐ取得全体のスナップショット一貫性は保証しません。** ページの取得間にデータが追加・削除された場合の挙動は、方式ごとに後述します。

### エラーの優先順位

エラーは既存のmiddleware順序に従います。不正なqueryよりも認証・認可のエラーが優先されます。

- `GET /organizations`（認証 → query検証）
  - 未認証: 不正queryでも401
  - 認証済みで不正query: 400
- `GET /organizations/:id/members`（認証 → パスパラメータ検証 → 組織への所属確認 → query検証）
  - 未認証: 不正queryでも401
  - 認証済みで不正な組織ID: 不正queryでも400
  - 有効な組織IDに対する非所属ユーザー: 不正queryでも404
  - 所属ユーザーで不正query: 400
- `GET /organizations/:id/audit-logs`（認証 → パスパラメータ検証 → 組織への所属確認 → OWNER / ADMINの確認 → query検証）
  - 未認証: 不正queryでも401
  - 認証済みで不正な組織ID: 不正queryでも400
  - 有効な組織IDに対する非所属ユーザー: 不正queryでも404
  - 所属MEMBER: 不正queryでも403
  - OWNER / ADMINで不正query（未対応の `offset`、不正なlimit・cursorを含む）: 400

## カーソル式: メンバー一覧

### リクエスト

| パラメータ | 必須 | 既定値 | 説明                                                   |
| ---------- | ---- | ------ | ------------------------------------------------------ |
| `limit`    | 任意 | 20     | 1〜100の整数                                           |
| `cursor`   | 任意 | 先頭   | 前ページのレスポンスの `nextCursor` をそのまま指定する |

並び順は `createdAt ASC, id ASC` です。`createdAt` が同一のメンバーも `id` で一意に順序付けられます。

```bash
# 最初のページ
curl -H "Authorization: Bearer $ACCESS_TOKEN" \
  'http://localhost:3000/organizations/1/members?limit=2'
```

```json
{
  "items": [
    { "id": 10, "userId": 1, "organizationId": 1, "role": "OWNER", "createdAt": "2026-02-01T09:00:00.000Z" },
    { "id": 40, "userId": 2, "organizationId": 1, "role": "MEMBER", "createdAt": "2026-02-01T09:30:00.000Z" }
  ],
  "nextCursor": "eyJ2ZXJzaW9uIjoxLCJvcmdhbml6YXRpb25JZCI6MSwiY3JlYXRlZEF0IjoiMjAyNi0wMi0wMVQwOTozMDowMC4wMDBaIiwiaWQiOjQwfQ"
}
```

```bash
# 次のページ（nextCursorをそのまま送り返す）
curl -H "Authorization: Bearer $ACCESS_TOKEN" \
  'http://localhost:3000/organizations/1/members?limit=2&cursor=eyJ2ZXJzaW9uIjoxLCJvcmdhbml6YXRpb25JZCI6MSwiY3JlYXRlZEF0IjoiMjAyNi0wMi0wMVQwOTozMDowMC4wMDBaIiwiaWQiOjQwfQ'
```

最終ページと0件の場合は `nextCursor: null` です。後続がある場合だけ、返した最後のitemの境界から次のカーソルを生成します。

### カーソルの扱い

`cursor` は不透明な文字列です。ここでの「不透明」は、**クライアントが内部構造を解釈・生成せず、受け取った値をそのまま送り返すAPI契約**を意味します。完全性の保証ではありません。

- 中身はJSONのbase64urlエンコードで、署名も暗号化もしていません。デコードすれば内容を読み取れて、改変もできます。
- そのため機密情報は含めません。含まれるのはバージョン・対象組織ID・並び順の境界値（`createdAt`・membership ID）だけです。
- サーバーは受信値を信用せず、形式・値・対象組織を毎回検証します。形式が不正なカーソルや、別組織のカーソルは400です。
- 境界値の日時は、DBで扱える範囲（1年以降）に収まっていることも検証します。ISO 8601としては妥当でもDBへ渡せない値（`0000-01-01T00:00:00.000Z`）を、500ではなく400で返すためです。
- 認可はカーソル内の組織情報を根拠にしません。毎回、認可済みの組織IDで絞り込んだうえで、境界より後ろの行を取得します。
- カーソルの構造を変える場合はバージョンを上げ、旧バージョンのカーソルを無効にします。

カーソルは境界値としてのみ使うため、**基準になったメンバーが削除されても、その行の存在に依存せず続きを取得できます。**

### 追加・削除時の挙動

- ページの取得間にメンバーが追加・削除されても、重複や読み飛ばしは発生しません。境界値より後ろを毎回取得するためです。
- すでに辿ったページより前へ挿入されたメンバーは、そのページを再取得しない限り現れません。
- 前方向へのページ移動と、ページ位置への直接移動（「5ページ目」の指定）はできません。

## カーソル式: 監査ログ一覧

`GET /organizations/:id/audit-logs` は、対象組織のOWNER / ADMINだけが閲覧できます。記録の対象は [endpoints.md](endpoints.md#organization-audit-logs) を参照してください。

### リクエスト

| パラメータ | 必須 | 既定値 | 説明                                                   |
| ---------- | ---- | ------ | ------------------------------------------------------ |
| `limit`    | 任意 | 20     | 1〜100の整数                                           |
| `cursor`   | 任意 | 先頭   | 前ページのレスポンスの `nextCursor` をそのまま指定する |

並び順は `createdAt DESC, id DESC`（新しい順）です。`createdAt` が同一の記録も `id` で一意に順序付けられます。メンバー一覧（`ASC`）とは逆順です。

```bash
curl -H "Authorization: Bearer $ACCESS_TOKEN" \
  'http://localhost:3000/organizations/1/audit-logs?limit=2'
```

```json
{
  "items": [
    {
      "id": 12,
      "organizationId": 1,
      "action": "MEMBER_ROLE_CHANGED",
      "actorUserId": 1,
      "targetUserId": 5,
      "targetMembershipId": 40,
      "previousRole": "ADMIN",
      "newRole": "MEMBER",
      "createdAt": "2026-02-02T09:00:00.000Z"
    },
    {
      "id": 11,
      "organizationId": 1,
      "action": "MEMBER_ROLE_CHANGED",
      "actorUserId": 1,
      "targetUserId": 5,
      "targetMembershipId": 40,
      "previousRole": "MEMBER",
      "newRole": "ADMIN",
      "createdAt": "2026-02-01T09:30:00.000Z"
    }
  ],
  "nextCursor": "eyJraW5kIjoiYXVkaXRMb2dzIiwidmVyc2lvbiI6MSwib3JnYW5pemF0aW9uSWQiOjEsImNyZWF0ZWRBdCI6IjIwMjYtMDItMDFUMDk6MzA6MDAuMDAwWiIsImlkIjoxMX0"
}
```

最終ページと0件の場合は `nextCursor: null` です。DBからは最大 `limit + 1` 件を取得し、`limit` 件を超えた場合だけ、返した最後のitemの境界から次のカーソルを生成します。

### カーソルの扱い

基本的な扱い（不透明な文字列、署名・暗号化なし、サーバーでの毎回の検証、境界値の日時の範囲検証、バージョン管理）は[メンバー一覧](#カーソルの扱い)と同じです。監査ログのカーソルには、次の違いがあります。

- ペイロードに `kind: "auditLogs"` と `version: 1` を持ちます。`kind` は必須で、一致しないカーソルは不正です。
- `kind` を持たないメンバー一覧のカーソルは、同じ組織のものでも監査ログAPIでは400です。別組織のカーソル、形式が不正なカーソル、バージョンが異なるカーソルも400です。
- 逆方向（監査ログのカーソルをメンバー一覧APIへ渡すこと）は、メンバー一覧の既存仕様を変えないため拒否の対象にしていません。同じ組織の認可済みの範囲に限られ、情報漏えいにはなりません。
- カーソル内の組織IDと境界のID、およびパスの組織IDは、1〜2147483647（PostgreSQL INTEGERの範囲）です。範囲外はDBの整数変換で500になるため、DBへ渡す前に400で返します。
- 認可はカーソル内の組織情報を根拠にしません。毎回、認可済みの組織IDで絞り込んだうえで、境界より古い行を取得します。

カーソルは境界値としてのみ使うため、**基準になった記録が削除されても、その行の存在に依存せず続きを取得できます。**（記録は削除連動で組織の削除時にまとめて消えるほか、アプリケーションからは削除しません。）

### 追加時の挙動

- 次ページの境界は `(createdAt, id) < (境界createdAt, 境界id)` で絞り込みます。ページの取得間に新しい記録が追加されても、すでに辿ったページの続きに重複や読み飛ばしは発生しません。
- ページの取得間に追加された新しい記録は、先頭ページを取り直すまで現れません。
- 前方向へのページ移動と、ページ位置への直接移動はできません。

## オフセット式: 所属組織一覧

### リクエスト

| パラメータ | 必須 | 既定値 | 説明                                                                |
| ---------- | ---- | ------ | ------------------------------------------------------------------- |
| `limit`    | 任意 | 20     | 1〜100の整数                                                        |
| `offset`   | 任意 | 0      | 0〜10,000の整数。大きなoffsetによる負荷を抑えるため上限を設けている |

並び順は `id ASC` です。

```bash
curl -H "Authorization: Bearer $ACCESS_TOKEN" \
  'http://localhost:3000/organizations?limit=2&offset=0'
```

```json
{
  "items": [
    { "id": 1, "name": "Acme", "createdAt": "2026-02-01T09:00:00.000Z", "updatedAt": "2026-02-01T09:00:00.000Z" },
    { "id": 2, "name": "Example Inc", "createdAt": "2026-02-02T09:00:00.000Z", "updatedAt": "2026-02-02T09:00:00.000Z" }
  ],
  "limit": 2,
  "offset": 0,
  "hasNext": true
}
```

入力範囲内で、取得対象の件数以上となる `offset` は200で `items: []`・`hasNext: false` を返します（エラーではありません）。

```bash
curl -H "Authorization: Bearer $ACCESS_TOKEN" \
  'http://localhost:3000/organizations?limit=2&offset=1000'
```

```json
{ "items": [], "limit": 2, "offset": 1000, "hasNext": false }
```

### 追加・削除時の挙動

- **ページの取得間に所属組織の追加・削除があると、後続ページで重複や読み飛ばしが発生し得ます。** `offset` は「先頭から何件読み飛ばすか」であって特定の行を指さないためです。
  - 例: 1ページ目（`offset=0&limit=2`）を取得した後に、より小さい `id` の組織へ新しく所属した場合、2ページ目（`offset=2`）には1ページ目の最後のitemが再び現れます。
  - 逆に、辿ったページより前の組織から脱退した場合、2ページ目で1件読み飛ばされます。
- ページ位置への直接移動はできます（`offset` を計算して任意のページへ飛べます）。
- `offset` の上限は10,000です。それより深い位置の取得はできません。

## 両方式の比較

| 観点                   | カーソル式                                 | オフセット式                                        |
| ---------------------- | ------------------------------------------ | --------------------------------------------------- |
| 深いページの取得コスト | ページ位置によらずほぼ一定                 | `offset` に比例して増える（読み飛ばす行を走査する） |
| ページ位置への直接移動 | できない（前ページのカーソルが必要）       | できる                                              |
| 前方向へのページ移動   | 今回は未対応                               | `offset` を戻せばできる                             |
| 取得間の追加・削除     | 重複・読み飛ばしが起きない                 | 重複・読み飛ばしが起き得る                          |
| 総件数の取得           | 今回は未対応                               | 今回は未対応                                        |
| 必要なindex            | 並び順と境界条件に合う複合indexが前提      | 並び順のindexがあればよい                           |
| 向く用途               | 件数が多い・追加が頻繁な一覧の順次読み込み | 件数が限られ、ページ番号を見せたい一覧              |

一覧の件数が増える見込みがあり、クライアントが順に読み進める用途ではカーソル式を選びます。件数が小さく、ページ番号や任意ページへの移動を見せたい用途ではオフセット式を選びます。

### カーソル式のクエリとindex

複合境界（`createdAt`・`id`）の条件は、raw SQLの行値比較で表現しています。

```sql
WHERE "organizationId" = $1
  AND ("createdAt", id) > ($2, $3)
ORDER BY "createdAt" ASC, id ASC
LIMIT $4
```

Prismaのtyped APIでOR展開する書き方（`OR: [{ createdAt: { gt } }, { createdAt, id: { gt } }]`）も検討しましたが、採用していません。ローカル実DB（50,000行・20組織）の `EXPLAIN (ANALYZE, BUFFERS)` で、次の差が出たためです。

| 方式     | 浅いページ                                                                                                         | 深いページ                        |
| -------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------- |
| OR展開   | `Index Cond` は `organizationId` だけ。境界条件は `Filter` へ落ち `Rows Removed by Filter: 1200` / `Buffers: 1230` | `BitmapOr` + `Sort` へ退行        |
| 行値比較 | `Index Cond: (("organizationId" = N) AND (ROW("createdAt", id) > ROW($1, $2)))` / `Buffers: 24`                    | 同じ形のindex scan / `Buffers: 3` |

OR展開では境界条件がindexの開始位置に使われず、境界までの行を読み捨てます。ページ位置に比例してコストが増え、カーソル式の利点が失われます。

この行値比較を `Index Cond` へ入れるには、並び順と同じ `[organizationId, createdAt, id]` の複合indexが必要です。`id` を含まない2カラム構成では `Index Cond: ("createdAt" >= $1)` までしか効かず、`Filter` と `Incremental Sort` が残ります。そのため既存の `[organizationId, createdAt]` を置き換えています（既存indexは新indexのprefixとなり冗長になるため、両方は残していません）。

### 監査ログ一覧のクエリとindex

監査ログは新しい順（`DESC`）のため、境界条件の向きがメンバー一覧と逆になります。

```sql
WHERE "organizationId" = $1
  AND ("createdAt", id) < ($2, $3)
ORDER BY "createdAt" DESC, id DESC
LIMIT $4
```

index は `[organizationId, createdAt, id]` の複合index（`AuditLog_organizationId_createdAt_id_idx`）です。btreeを逆方向にスキャンして `DESC` の並びを満たすため、降順専用のindexは作りません。ローカル実DB（20組織・60,000行、`ANALYZE` 後）の `EXPLAIN (ANALYZE, BUFFERS)` で、深いページ（2,000行目の境界）も浅いページ（50行目の境界）も次の形になることを確認しています。

```txt
Limit  (actual time=0.006..0.010 rows=21 loops=1)
  Buffers: shared hit=7
  ->  Index Scan Backward using "AuditLog_organizationId_createdAt_id_idx" on "AuditLog"
        Index Cond: (("organizationId" = N) AND (ROW("createdAt", id) < ROW('...'::timestamp, M)))
        Buffers: shared hit=7
```

`Index Cond` に組織IDと行値の境界が入るため、`Sort` や `Filter` による読み捨てはなく、ページ位置によらず `Buffers` は一定です。

## レスポンスの破壊的変更

ページネーションの導入により、両APIのレスポンスは**配列からページ情報を持つオブジェクトへ変わりました。**

| API                              | 変更前              | 変更後                              |
| -------------------------------- | ------------------- | ----------------------------------- |
| `GET /organizations`             | `OrganizationDto[]` | `{ items, limit, offset, hasNext }` |
| `GET /organizations/:id/members` | `MemberDto[]`       | `{ items, nextCursor }`             |

各itemのDTOは変更していません。クライアントはレスポンスのルートを配列として扱えなくなるため、`items` を参照するよう変更が必要です。

また、どちらも取得件数に上限（既定20件）が付きました。これまで全件が返っていたため、全件が必要な場合はページを辿る実装が必要です。

## 今回の対象外

- 招待一覧（`GET /organizations/:id/invitations`）・セッション一覧（`GET /auth/sessions`）への展開
- 任意のソート・検索
- 前方向へのページ移動
- 総件数の取得
- 大規模な負荷試験
