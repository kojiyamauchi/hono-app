# テスト方針

このドキュメントは、機能追加・修正時に、どの種類のテストを追加すべきかを判断するためのガイドです。

テストを機械的に全レイヤーへ追加するのではなく、変更によって発生するリスクに対応したテストを選択します。

## 基本方針

- 変更した責務に最も近い層でテストする
- 同じ条件を複数の層で過剰に重複検証しない
- 公開APIの挙動はRoute統合テストで確認する
- 業務ルールはServiceテストで確認する
- DB固有の挙動はmockテストだけで完了としない
- Repositoryの未知の結果値は暗黙の成功にせず、エラーへ倒す

## 変更内容とテストの対応

| 変更内容                       | 主に追加・更新するテスト |
| ------------------------------ | ------------------------ |
| Zod schema                     | Schemaテスト             |
| Response DTO、mapper           | Mapper / DTOテスト       |
| Serviceの業務分岐              | Serviceテスト            |
| Repositoryの結果変換           | Repositoryテスト         |
| HTTP method、URL、status、body | Route統合テスト          |
| 認証、認可、middleware         | Route統合テスト          |
| Cookieの発行・削除             | Route統合テスト          |
| OpenAPI route定義              | OpenAPIテスト            |
| Prisma schema、migration       | 実DB検証                 |
| 外部キー、一意制約、cascade    | 実DB検証                 |
| transaction、raw SQL           | 実DB検証                 |
| 行ロック、同時実行             | 実DB検証                 |

すべての変更で、表にあるすべてのテストを追加する必要はありません。変更の責務とリスクに該当するものだけを選択します。

## Schemaテスト

Schemaテストでは、入力値そのものの妥当性を確認します。

主な確認対象は以下です。

- 必須項目
- 文字列長
- 数値の範囲
- emailやURLの形式
- enumの許可値
- 複数項目間の条件
- param、query、request bodyの境界値

Schemaテストでは、HTTPステータスやRepositoryの呼び出しは確認しません。

## Mapper / DTOテスト

Mapper / DTOテストでは、内部データが公開APIのレスポンス形式へ正しく変換されることを確認します。

主な確認対象は以下です。

- EntityからDTOへの変換
- `Date`からISO datetime文字列への変換
- nullableな値の扱い
- password、tokenHashなど非公開情報の除外
- mapperの戻り値がDTOのZod schemaを満たすこと

通常のレスポンス処理で毎回DTOを`parse`する代わりに、mapperテストでDTO定義との整合を保証します。

## Serviceテスト

Serviceテストでは、業務ルールとRepository結果の取り扱いを確認します。

主な確認対象は以下です。

- 正常系
- Repositoryが返す各失敗結果
- 業務エラーへの変換
- 必要なRepositoryが正しい引数で呼ばれること
- 失敗後に不要な後続処理を実行しないこと
- notifierなど外部処理の失敗
- 未知のresult union値

### Result unionはfail-closedにする

Repositoryの戻り値がunionやenumの場合、成功値を明示的に判定します。

```ts
const result = await repository.execute()

if (result === results.success) {
  return
}

if (result === results.notFound) {
  throw new NotFoundError()
}

throw new InternalServerError()
```

失敗ケースだけを列挙し、どれにも該当しなかった値を暗黙に成功として扱ってはいけません。

結果値が将来追加された場合に備え、必要に応じて未知の結果値がエラーになるテストを追加します。

## Repositoryテスト

Repositoryテストでは、PrismaやSQLとの接続部分と、Repository独自の結果変換を確認します。

mockを使うテストでは、主に以下を確認します。

- query条件
- update対象
- transaction内での処理呼び出し
- PrismaエラーからRepository結果への変換
- 例外の再送出
- 結果unionへの変換

ただし、mockテストだけでは以下を保証できません。

- transactionの実際のrollback
- 外部キー
- 一意制約
- cascade delete
- 行ロック
- 同時実行時の競合
- migrationの正しさ

これらは実DBで確認します。

## Route統合テスト

Route統合テストでは、Honoの`app.request()`を使い、公開APIとしての挙動を確認します。

主な確認対象は以下です。

- HTTP methodとURL
- request body、param、query
- status code
- response body
- response header
- 認証必須・不要
- ロールや所有権による認可
- middlewareの適用
- バリデーションエラー形式
- Cookieの発行・削除

Cookieを扱う場合は、必要に応じて以下の属性も確認します。

- `HttpOnly`
- `Secure`
- `SameSite`
- `Path`
- `Max-Age`
- 削除時の`Max-Age=0`

Schemaのすべての境界値をRoute統合テストでも繰り返す必要はありません。Route統合テストでは、入力検証がHTTPレスポンスへ正しく変換される代表ケースを確認します。

## OpenAPIテスト

OpenAPIテストでは、公開APIとOpenAPI定義の不一致を防ぎます。

主な確認対象は以下です。

- pathとHTTP method
- request schema
- response schema
- status code
- Bearer認証
- Cookie認証
- named component
- `ENABLE_API_DOCS=false`の場合に公開されないこと

OpenAPI JSON全体の巨大なsnapshotは避け、対象endpointの重要項目を検証します。

## 実DB検証

以下を変更した場合は、通常のmockテストだけで完了としません。

- `prisma/schema.prisma`
- migration
- transaction
- raw SQL
- 外部キー
- unique制約
- cascade
- index
- 行ロック
- 同時実行時の整合性
- 複数テーブルを更新する重要なRepository処理

実DB検証では、変更内容に応じて以下を確認します。

1. migrationを適用できる
2. Prisma schemaとDB schemaが一致する
3. 正常系が成功する
4. 制約違反が期待どおり失敗する
5. transaction途中の失敗でrollbackされる
6. 同時実行後に不正な状態が確定しない
7. cascadeや外部キーが期待どおり動作する
8. 検証用データや一時的なDBオブジェクトを削除する

具体的な実行手順は、[Codex版のmigration検証Skill](../.codex/skills/migration-verification/SKILL.md) または [Claude版のmigration検証Skill](../.claude/skills/migration-verification/SKILL.md) を参照してください。

## 外部サービス

Resend、Supabase Auth、OpenTelemetry exporterなどの外部サービスは、通常のCIでは実通信せず、SDKまたは境界となるServiceをmockします。

主な確認対象は以下です。

- 正しい引数で呼ばれること
- 成功時の処理
- 失敗時の処理
- 必要な補償処理
- 外部レスポンスへ機密情報を出さないこと
- ログやspanへ機密情報を含めないこと

実配達や外部サービスの管理画面への反映は、必要に応じて手動のsmoke testで確認します。

## 重複テストを避ける

同じ条件を全レイヤーで繰り返し検証しません。

例として、パスワードの最小文字数はSchemaテストで確認します。

Serviceテストでは、パスワードの文字数を再検証するのではなく、Repositoryの結果が適切な業務エラーへ変換されることを確認します。

Route統合テストでは、入力エラーが期待するHTTPステータスとレスポンス形式になることを確認します。

一方、以下は重要度に応じて複数の層で確認する場合があります。

- 認証・認可
- Cookie属性
- 所有権とロール
- transactionとrollback
- 公開APIの後方互換性

複数の層で確認する場合は、それぞれのテストが異なる責務を保証していることを明確にします。

## CI

通常のCIでは依存関係のインストール後にPrisma Clientを生成し、以下を実行します。

```bash
bun run prisma:generate
bun run lint:check
bun run typecheck
bun run spellcheck
bun test --isolate
bun run build
```

通常のCIテストはDB非依存とし、Repositoryと外部サービスをmockします。

実DB integration testを自動化する場合は、通常のテストとは別のCI jobとして実行します。

## 新機能・修正時の確認

テスト追加時は、以下を機械的にすべて実施するのではなく、変更内容に該当する項目を確認します。

- [ ] 入力条件を変更した場合、Schemaテストを更新した
- [ ] DTOやmapperを変更した場合、変換結果を確認した
- [ ] 業務分岐を変更した場合、Serviceテストを更新した
- [ ] result unionを変更した場合、未知値が成功へ倒れないことを確認した
- [ ] HTTP仕様を変更した場合、Route統合テストを更新した
- [ ] Cookieを変更した場合、必要な属性を確認した
- [ ] OpenAPI定義を変更した場合、対象pathを確認した
- [ ] migrationやDB制約を変更した場合、実DBで確認した
- [ ] transactionを変更した場合、rollbackを確認した
- [ ] 競合が想定される場合、同時実行を確認した
- [ ] 外部サービス処理を変更した場合、失敗時の挙動を確認した
