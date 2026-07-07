# AGENTS.md

このファイルは、このリポジトリで作業する際に Codex に対してガイダンスを提供します。

## 言語に関する重要な注意事項

**このプロジェクトでは、すべてのコミュニケーションとドキュメントを日本語で行うことを必須とします。**

- コードコメントは日本語で記述すること
- コミットメッセージは英語の接頭辞と日本語の説明で記述すること
- ドキュメント（README、コメント等）は日本語で記述すること
- Codex とのやり取りは日本語で行うこと
- 変数名や関数名は英語でも構いませんが、JSDocやコメントは必ず日本語で記述すること

## プロジェクト概要

Bun上で動作するHono.js APIアプリケーションです。TypeScriptを使用し、ORMとしてPrisma、データベースとしてSupabase（PostgreSQL）を採用しています。モダンなESMセットアップと厳格なTypeScript設定を使用しています。

## 主要なアーキテクチャ

### アプリケーション構造

- **エントリーポイント**: [src/server.ts](src/server.ts) - `Bun.serve()`を使用してHonoサーバーを起動
- **アプリインスタンス**: [src/app.ts](src/app.ts) - Honoインスタンスを作成し、ルートを登録
- **ルート登録**: [src/routes/index.ts](src/routes/index.ts) - `registerRoutes(app)`による一元的なルート登録パターン
- **データベースクライアント**: [src/libs/prisma/index.ts](src/libs/prisma/index.ts) - PostgreSQL用の`@prisma/adapter-pg`を使用した設定済みPrismaクライアントをエクスポート

### features設計

このリポジトリでは、公開ルーティングのトップレベルを機能境界として扱うfeatures設計に従うこと。

- `src/routes/` 配下には、公開URLのトップレベルroutingを定義すること
  - 例: `/auth`、`/supabase-auth`、`/users`
  - `src/routes/index.ts` はトップレベルroutingの集約とHonoアプリへの登録に責務を限定すること
- `src/routes/` 配下に定義したトップレベルrouting単位で、`src/features/` 配下に対応するfeatureディレクトリを定義すること
  - 例: `/auth` は `src/features/auth/`、`/supabase-auth` は `src/features/supabaseAuth/`
  - URLはkebab-case、featureディレクトリ名はTypeScriptの命名に合わせてcamelCaseを許容する
- routingのサブディレクトリや詳細なルート定義は、対応する `src/features/<feature>/routes/` 配下に置くこと
  - `src/routes/` はトップレベルの入口、`src/features/<feature>/routes/` はfeature内部のルート詳細という役割分担にする
- features間の相互importは禁止すること
  - `src/features/auth` から `src/features/supabaseAuth` をimportするような、featureを跨ぐ依存は禁止する
  - feature間で共有したい処理・型・ドメイン概念は、直接importせず `src/shared/` に切り出すこと
- 複数featuresで使う機能は `src/shared/` 配下に定義すること
  - 例: 複数featureで使うUserドメイン、DTO、mapper、repositoryなど
- `src/shared/` 配下から `src/features/` 配下をimportすることは禁止する
  - 依存方向は `features -> shared` の一方向に保つこと
- `src/features/<feature>/` と `src/shared/<domain>/` 配下の構成は、以下の標準ディレクトリに揃えること
  - `controllers/`
  - `dtos/`
  - `entities/`
  - `mappers/`
  - `repositories/`
  - `routes/`
  - `schemas/`
  - `services/`
- 新しい責務名のディレクトリは原則として増やさないこと
  - 例: `tokens/`、`handlers/`、`clients/` のような新しい概念を個別判断で追加しない
  - 新しい処理を置く場合は、まず既存の標準ディレクトリのどれに属するかを判断すること
  - 標準ディレクトリでは表現しづらい責務が出た場合は、実装前に設計方針を確認し、必要に応じてREADME/AGENTS/CLAUDEを更新してから追加すること
- 現時点で実装がない標準ディレクトリには `.gitkeep` を置き、構成の一貫性を保つこと
- OpenAPIドキュメント公開（`/open-api/doc` / `/open-api/scalar`）は、上記の標準構成に対する例外として以下を許容する
  - `src/shared/openApi/schemes/`: OpenAPIのsecurity scheme（認証「方式」の定義）を置く標準外の責務ディレクトリ。入力検証用Zod schema（データ構造）を置く `schemas/` とは責務が異なるため別ディレクトリとして分離する。scheme（方式）と schema（構造）を混在させない
  - `src/features/openApi`: OpenAPI仕様は各featureのroute定義がroot app（`OpenAPIHono`）のregistryへ集約されて初めて全体が揃うため、`app.route()` でmountする通常のfeature routesではなく、root appを受け取って `/open-api/doc`・`/open-api/scalar` を登録する登録関数 `registerOpenApiRoutes(app)` を提供する。`src/routes/index.ts` は全 `app.route(...)` の後にこれを1回呼ぶ
  - これらは例外であり、他featureへ横展開しないこと

#### src配下のレイヤー依存ルール

`src/` 配下の全層を以下の線形レイヤーとして整理し、importは図の下方向のみ許可する。

```txt
routes / app.ts / server.ts   （配線層・最上位）
  ↓
features                       （機能）
  ↓
middlewares                    （Hono横断ミドルウェア）
  ↓
shared                         （共有ドメイン）
  ↓
libs                           （外部サービス・インフラのクライアント）
  ↓
utils                          （汎用ユーティリティ）
  ↓
types                          （型宣言のみ・最下層）
```

- 各層は自分より下のすべての層をimport可（隣接層に限定しない）。上方向のimportは禁止する
- `src/generated/` は自動生成物として全層から参照可（最下層扱い）
- 外部パッケージは全層から参照可

##### 各層の責務

- `types/`: アプリ全体で使う型宣言専用（Honoの型拡張、環境変数の型など）。ランタイムコードは置かないこと
- `utils/`: 特定サービスのクライアント実体に依存しない汎用ユーティリティ（errors / rateLimit / timing / validation / prisma判定ヘルパーなど）。外部パッケージや生成物の型（例: `@/generated/prisma/client` の `Prisma` 型）の利用は可だが、`libs` のクライアント実体へのimportは禁止する
- `libs/`: 外部サービス・インフラのクライアント（prisma / supabase / telemetry）。`utils` のimportは許可する
- `shared/`: 複数featureで使う共有ドメイン（前述の定義どおり）。`middlewares`・`features` へのimportは禁止する（HTTP層の関心事をsharedへ持ち込まない。ミドルウェアが設定した値はcontroller/feature側で取り出して引数として渡すこと）
- `middlewares/`: Hono横断ミドルウェア。`shared` のrepositoryの利用は許可する。`features` へのimportは禁止する
- `features/`: `shared` 以下の層に加え `middlewares` もimport可（feature内routesでのミドルウェア適用）。feature間の相互importは前述のとおり禁止する
- `routes/` / `app.ts` / `server.ts`: 配線層。全層をimport可（例: `app.ts` でのグローバルミドルウェア適用・CORS設定・telemetry初期化）

### データベース設定

- Prismaスキーマ: [prisma/schema.prisma](prisma/schema.prisma)
- マイグレーション: `prisma/migrations/`
- 生成されたクライアント: `src/generated/prisma/`（このディレクトリは自動生成され、ESLintで無視されます）
- カスタムPrisma設定: [prisma.config.ts](prisma.config.ts) - トップレベルのPrismaスキーマ/マイグレーションパスを使用

### ローカル開発用データベース

ローカルPostgreSQLインスタンスにSupabase CLIを使用:

- 起動: `bun run db:start`
- 停止: `bun run db:stop`
- リセット: `bun run db:reset`
- ステータス確認: `bun run db:status`
- デフォルト接続: `postgresql://postgres:postgres@127.0.0.1:54322/postgres`

### migrationを含む変更の実DB検証

テスト/CIは意図的にDB非依存（`mock.module`でrepositoryをモック）のため、migrationの適用や実DBでのSQL/transaction/一意制約/外部キーの挙動はCIで検証されない。CIがDBを動かさない以上、migration適用と実DB挙動の検証はローカルのどこかで必ず行うこと。

詳細な手順（基本原則の全文・smokeの手段・タイミング別の責務・PRへの検証証跡の項目・レビュー時の再実行手順）は、migration検証Skill（[`.codex/skills/migration-verification/SKILL.md`](.codex/skills/migration-verification/SKILL.md)）に集約する。ここでは常に守る共通原則だけを示す。

- migrationを含む変更は、push（マージ）される最終コミットに対して、実DB検証（適用＋非自明なデータ層ならsmoke）が少なくとも一度ローカルでgreenであることを担保すること
- PR本文の `## 実DB検証` セクションは、migrationの有無にかかわらず必ず記載すること（migrationを含まないPRは `- migrationを含まないため検証なし` のようにリスト形式で記載する）
- 検証用データは既存データと衝突しない値を使い、検証後に削除すること
- 既存DBのreset・全削除（`bun run db:reset` を含む）は、ユーザー承認なしで行わないこと
- マージ後は各環境で`prisma migrate deploy`を実行して適用する前提（CIは適用しない）

## 開発コマンド

### アプリケーションの実行

```bash
bun run dev          # 開発モード（ホットリロード付き）
bun run start        # 本番モード
```

### コード品質

```bash
bun run typecheck    # ファイル出力なしの型チェック
bun run build        # typecheckのエイリアス
bun run lint         # ESLintによる自動修正（max-warnings 0）
bun run format       # Prettierによるフォーマット
bun run spellcheck   # CSpellによるスペルチェック
bun test --isolate   # テストファイルを分離したBun Testの実行
```

### データベース操作

```bash
bun run prisma:generate      # Prismaクライアントの生成
bun run prisma:migrate:dev   # マイグレーションの作成と適用
bun run prisma:validate      # スキーマの検証
bun run prisma:format        # スキーマファイルのフォーマット
bun run prisma:studio        # Prisma Studioを開く
```

### プレコミットフック

Husky + lint-stagedがコミット時に実行されるよう設定されています:

```bash
bun run lint-staged  # ステージングされたファイルのチェックを手動実行
```

## 重要な設定の詳細

### ESLintルール

- **インポートのソート**: `eslint-plugin-simple-import-sort`を使用した自動インポート整理
- **コンソール使用**: `console.info`と`console.error`のみ許可（`console.log`は警告）
- **明示的な戻り値の型**: 関数には明示的な戻り値の型が必要（不足している場合は警告）
- **未使用変数**: `_`プレフィックスを付けない限り、未使用変数はエラー
- **無視パス**: `src/generated/**`はリント対象から除外

### TypeScript設定

- モジュール解決: `bundler`
- ターゲット: `ES2023`
- strictモード有効
- emit無し（ビルドステップは型チェックのみ）

### テスト

- Bunに組み込まれた`bun test --isolate`を使用
- テストファイル: `**/*.test.ts`または`**/*.test.js`
- テストがない場合は失敗するため、最低限の動作確認テストを維持

### 環境変数

`.env.example`を`.env`にコピー:

- `PORT`: サーバーポート（デフォルト: 3000）
- `DATABASE_URL`: PostgreSQL接続文字列

## コードパターン

### 新しいルートの追加

[src/routes/index.ts](src/routes/index.ts)の`registerRoutes`関数を使用してルートを追加します。渡された`app`インスタンスにルートを登録する既存のパターンに従ってください。

### エンドポイント一覧

公開APIの一覧は [docs/endpoints.md](docs/endpoints.md) を正本とすること。

APIの追加・変更・削除を行う場合は、実装と同じPRで `docs/endpoints.md` も更新すること。

READMEには詳細なエンドポイント一覧を重複して記載せず、`docs/endpoints.md` への導線のみを置くこと。

### データベースアクセス

[src/libs/prisma/index.ts](src/libs/prisma/index.ts)からPrismaクライアントをインポート:

```typescript
import { prisma } from '../libs/prisma'
```

### ルートハンドラー

リクエスト/レスポンス処理にはHonoのコンテキスト（`c`）を使用します。例については[src/routes/index.ts](src/routes/index.ts)の既存ルートを参照してください。

## コーディング規約

### コメントとドキュメント

- すべてのコメントは日本語で記述すること
- 複雑なロジックには必ずコメントを付けること
- 関数やクラスにはJSDocコメント（日本語）を記述すること

### Zod schema と型定義の命名

`src/features/**/schemas/` および `src/shared/**/schemas/` 配下で定義するZod schemaと、そのschemaからexportする型は以下の命名に揃えること:

- Zod schemaは `***Schema` として定義すること
  - 例: `signupSchema`、`updateMeSchema`、`userIdParamSchema`
- schemaから `z.infer` でexportする型は、対応するschema名に `Type` を付与した `***SchemaType` とすること
  - 例: `SignupSchemaType`、`UpdateMeSchemaType`
- param系schemaの型も同じ規則に従い、`***ParamSchemaType` とすること
  - 例: `UserIdParamSchemaType`、`OrganizationIdParamSchemaType`
- schema由来の型に `***Input` や `***Param` のような別接尾語を使わないこと
- repository内部など、`schemas/` 配下のZod schema由来ではない入出力型はこの規則の対象外とする
- `dtos/` 配下のZod DTO定義とその型もこの規則の対象外とし、[### DTOとOpenAPI schemaの配置](#dtoとopenapi-schemaの配置) の `***Dto` / `***DtoType` 命名に従うこと

### DTOとOpenAPI schemaの配置

OpenAPIを導入しており、入力検証用schemaとレスポンスDTOの責務を以下のとおり分離すること:

- `schemas/` はrequest body / query / paramなどの入力検証用Zod schemaに寄せること
- `dtos/` はAPIレスポンスDTOに寄せること
- レスポンスDTOはZodで定義し、OpenAPI response schemaとDTO型の正本にすること
- DTO定義名は `***Dto`、そこから `z.infer` でexportする型名は `***DtoType` とすること
  - 例: `userDto`、`UserDtoType`
- `dtos/` 配下のZod DTO定義は、`schemas/` 配下の `***Schema` / `***SchemaType` 命名規則の対象外とする
- レスポンスDTOのZodは通常の本番レスポンスで毎回parseせず、mapperテストで `safeParse` して実装との整合を担保すること
- OpenAPI JSONは `/open-api/doc` で動的生成し、手書きの `openapi.yml` を正本にしないこと
- `/open-api/doc` と `/open-api/scalar` は `ENABLE_API_DOCS=true` のときだけ登録し、staging / prodでは原則非公開にすること

### コミットメッセージ

英語の接頭辞と日本語の説明で記述し、以下の形式に従うこと:

- `add: 新機能の説明`
- `fix: バグ修正の説明`
- `modify: 既存機能の改善`
- `remove: 不要なコードの削除`
- `refactor: コードの整理`

AIエージェントがコミットする場合は、誰が作業したか分かるようにコミットメッセージ本文の末尾に以下のトレーラーを付与すること:

- Claude がコミットする場合: `Co-authored-by: Claude <claude@anthropic.com>`
- Codex がコミットする場合: `Co-authored-by: Codex <codex@openai.com>`
- ツールやハーネスが既定で自動付与する別形式の `Co-Authored-By` トレーラー（モデル名入り・`noreply` アドレスなど）は使わず、上記の形式へ統一すること（同一コミットへ二重に付与しない）

### コミットの粒度

コミットは、変更内容を追いやすくするため細かい粒度で分割すること。詳細な分解手順・feature実装時の標準レイヤー順・粒度チェックリストは、コミット粒度Skill（[`.codex/skills/commit-granularity/SKILL.md`](.codex/skills/commit-granularity/SKILL.md)）に集約する。ここでは常に守る共通原則だけを示す。

- 1つの作業 = 1コミットの粒度で分割すること（PR本文の作業項目リストの1項目が、おおむね1コミットの目安）
- 実装コミットと、その振る舞いを確認するテストコミットを隣接させること（「実装 → そのテスト」をレイヤーごとにペアで刻む）
- 役割の異なるレイヤーを1コミットへ混ぜないこと。特に controller と routes は別コミットにすること
- review対応コミットは、指摘ごと、または関心事ごとに分けること
- 各コミット時点で `typecheck` が完全に通らなくてもよい（ファイル間の参照のため一時的に通らない瞬間が出るため）が、プレコミットフック（lint-staged の prettier / eslint / cspell）は通すこと。最終的にpush後のCIで全チェックを通すこと

#### feature実装時の標準コミット粒度

feature配下にAPIやユースケースを追加する場合は、レイヤー単位で「実装 → そのテスト」を分けて刻むこと。DTO / mapper / repository / service / schema / controller / routes / top-level route登録を1コミットへ混ぜないこと。

番号付きの標準順序とその依存関係の根拠、テスト省略の判断は、コミット粒度Skill（[`.codex/skills/commit-granularity/SKILL.md`](.codex/skills/commit-granularity/SKILL.md)）を正本とする。

### ブランチ命名

ブランチ名は作業種別と関心事が分かるように、以下の形式に従うこと:

- 新規機能・追加機能開発: `feature/作業の関心事`
- 既存機能や設定の修正・改善: `modify/作業の関心事`
- 機能や設定の削除: `remove/作業の関心事`

ブランチの接頭辞は、PRや作業全体の主目的で決めること。コミットメッセージの接頭辞は、ブランチ名とは独立して、そのコミット単体の変更内容で決めること。

- `feature/` ブランチでも、既存実装の変更を含むコミットには `modify:`、不具合修正には `fix:`、整理には `refactor:`、削除には `remove:` を使ってよい
- `modify/` ブランチでも、修正に必要な補助的な追加があれば `add:` を使ってよい
- `remove/` ブランチでも、削除に伴う設定変更やテスト更新があれば `modify:` や `fix:` を使ってよい
- ブランチ名はコミット接頭辞の一覧ではなく、PR全体でユーザーに伝えたい主目的を優先して決めること

作業の関心事は英語のケバブケースで簡潔に記述すること。例:

- `feature/auth`
- `feature/users-crud`
- `modify/branch-rules`
- `modify/ci-workflow`
- `remove/legacy-config`

### Issue運用

Issueを作成・整理・本文レビューする場合は、詳細手順として [`.codex/skills/issue-management/SKILL.md`](.codex/skills/issue-management/SKILL.md) を参照すること。

- Issue本文の末尾には `## 記載者` を置き、誰が作成・詳細更新した本文か分かるようにすること
- Issueタイトル接頭辞、本文テンプレート、記載者表記、本文レビュー運用、本文メンテナンス方針の詳細はCodex用Issue運用Skillに従うこと

### PRタイトル

PRのタイトルは、作業者と関心事が分かるように以下の形式で記述すること:

`[作業者]: 関心事`

- `作業者` には作業した主体を記述する:
  - ユーザー（リポジトリ所有者）が作業した場合: `me`
  - Codex が作業した場合: `codex`
  - Claude が作業した場合: `claude`
- `関心事` にはPRの主目的を日本語で簡潔に記述する
- 例:
  - `[me]: ユーザー認証機能の追加`
  - `[codex]: CIワークフローの改善`
  - `[claude]: PRテンプレートの追加`

### PR作成時の最初のコミット

PRを作成する際、最初のコミットは以下の空コミットにすること:

```bash
git commit --allow-empty -m "initial commit."
```

これにより、PRの起点が明確になり、以降の変更を追いやすくなる。

### PR本文の関連Issue

対象IssueがあるPRでは、PRがマージされたときに対象Issueが自動でcloseされるよう、PR本文の `関連Issue` セクションに `Closes #<issue番号>` / `Fixes #<issue番号>` / `Resolves #<issue番号>` のいずれかを明記すること。

- 対象Issueがない場合は `なし` と記載すること
- 空の `Closes #` を残さないこと
- PR本文の `概要` / `変更内容` / `確認内容` は、対象Issueの受け入れ条件・完了条件と矛盾しないように更新すること

### PR作成時の公開状態

PRを作成する際、ユーザーから特段の指定がない場合は **draftではなくready/open状態** で作成すること。

- draft PRにするのは、ユーザーが明示的にdraftを指定した場合、または未完了・未検証でレビュー可能状態ではないことをユーザーへ説明した場合に限定する
- AIエージェントが誤ってdraftで作成した場合は、気づいた時点でready for reviewへ切り替えること

### GitHubへのpush

ユーザーの通常のpush方法を変えないため、`origin` のURLはSSHのまま維持すること:

```txt
git@github.com:kojiyamauchi/hono-app.git
```

AIエージェントがpushする場合は、`origin` のURLをHTTPSへ変更せず、HTTPS URLを直接指定してpushすること:

```bash
git push https://github.com/kojiyamauchi/hono-app.git main
```

これにより、ユーザーが `git push origin main` を実行する場合は引き続きSSHを使用し、AIエージェントがpushする場合だけHTTPS認証を使用する。

#### push後はリモート追跡参照を更新すること

HTTPS URLを直接指定したpushは、名前付きリモート `origin` を経由しないため、ローカルのリモート追跡参照（`refs/remotes/origin/main`）が自動更新されない。その結果、push済みにもかかわらず `git log` や `git status` 上でローカルとリモートのHEADがズレて見える。

これを防ぐため、AIエージェントはpush直後に以下のfetchを実行し、リモート追跡参照を明示的に更新すること:

```bash
git fetch https://github.com/kojiyamauchi/hono-app.git main:refs/remotes/origin/main
```

これにより `git log --oneline --decorate` で `(HEAD -> main, origin/main, origin/HEAD)` が揃った状態になる。なお、この手順はユーザーやSSH経由のpush（`git push origin main`）では不要（追跡参照が自動更新されるため）。

### AIエージェント間レビュー

AIエージェント間レビューの共通原則を示す。レビュー実行手順・レビューコメントの見出し/出力フォーマット・inline suggestion comment の投稿手順は、PRレビューSkill（[`.codex/skills/pr-review/SKILL.md`](.codex/skills/pr-review/SKILL.md)）に集約する。

- AIエージェントが実装した変更は、原則としてPRでレビューすること
- Codex が実装したPRは Claude が、Claude が実装したPRは Codex がレビューすること
- ユーザーが作成したPRは Claude と Codex がレビューすること
- AIエージェントが作成したPRは、他のAIエージェントに加えてユーザーもレビューすること
- レビューを開始する前に、対象PRのCIが通っていることを確認すること（CIが未完了・失敗なら、その状態をレビュー結果へ明記し、問題なしの通常コメントはCI通過後に投稿する）
- 対象Issueがある場合は、レビュー前にIssue本文・コメント・受け入れ条件・完了条件・未完了TODOを読み、PR差分・テスト・動作確認と整合するか確認すること。対象IssueがあるのにPR本文から参照されていない場合はPR本文更新を指摘すること
- レビューでは、バグ、設計リスク、テスト不足、セキュリティ、運用上の問題を優先すること
- コミット履歴がレビュー可能な粒度になっているか確認し、明らかに複数の関心事が混ざる場合は指摘すること
- migrationを含むPRのレビューでは、[### migrationを含む変更の実DB検証](#migrationを含む変更の実db検証) に従い、PRの検証証跡を確認し、必要なときのみ実DB適用＋smokeを再実行すること
- レビュー指摘への修正は、PR上で追加コミットとして行うこと
- 初回・再レビュー・修正後レビューを問わず、レビュー結果をGitHub上へコメントとして投稿すること。問題がない場合は、レビュー結果とは別の通常コメントとして`Approve by エージェント名 <メールアドレス> :octocat:`を投稿すること
- 修正コミット追加後は、過去の承認に依存せず最新HEADを確認して再レビューすること。指摘事項が残っている場合は、重大度に応じて`COMMENT`または`REQUEST_CHANGES`を投稿すること

レビュー対応の共通原則を以下に示す。コミットメッセージの具体フォーマット、PR本文更新のチェック項目、確認コマンドなどの手順詳細は、レビュー対応Skill（[`.codex/skills/review-response/SKILL.md`](.codex/skills/review-response/SKILL.md)）に集約する。

#### レビュー指摘への対応コミット

レビュー指摘へ対応する追加コミットは、通常のコミットと区別できるように `review:` 接頭辞で記述すること。本文には対応元レビューコメントのURL（`comment:`）と、AIエージェントが対応した場合は `Co-authored-by` トレーラーを付与する。指摘が複数ある場合は、指摘ごと・関心事ごとにコミットを分ける。具体フォーマットはレビュー対応Skillを正本とする。

#### レビュー対応時のPR本文更新

レビュー指摘へ対応する追加コミットを行った場合は、PR本文も最新状態へ更新すること。PR本文の更新は、コード修正とは別の補助作業ではなく、レビュー対応フローの一部として扱う。

確認すべき項目（`概要` / `変更内容` / `コミット構成` / `確認内容` の最新化、`レビュー対応` セクションの追加要否、差分・コミット履歴とのズレ確認）の詳細は、レビュー対応Skillを正本とする。

### サブエージェント運用（Claude Code）

Claude Codeでのfeature実装は、設計・レビューをメインスレッド（上位モデル）が担い、実装を implementer サブエージェント（[`.claude/agents/implementer.md`](.claude/agents/implementer.md)）へ委譲する運用を標準とする。Codexには対応するサブエージェントの仕組みがないため、この節はClaude Codeの運用を共有知として記載する。

- 委譲元（メイン）は、委譲プロンプトへ以下を必ず含めること（implementer側は不足があれば実装を始めずに要求を返す）:
  - 作業ブランチ名（main上ではコミットさせない）
  - 設計（エンドポイント・schema/DTOの形・レイヤーごとの責務）
  - 完了定義（どのテスト・チェックがgreenなら完了か）
  - 参照feature（構成・命名・テストパターンを踏襲する既存featureを1つ指名する）
  - 変更してよいファイル・ディレクトリの範囲
- implementerは実装・検証・コミットまでを担当し、pushとPR作成はメイン（委譲元）が行う
- implementerが設計判断を要する不明点に当たった場合は、推測で実装せず停止して報告し、メインが回答を返して継続させる。メインでも判断できない仕様レベルの論点は、ユーザーへ確認してから回答する

### Skill運用方針

`AGENTS.md` と `CLAUDE.md`、`.codex/skills/` と `.claude/skills/` は、Codex / Claude 向けの並行版として同期運用すること。片方だけにルールを追加して、期待値がズレないようにする。

READMEの「Features設計」「標準ディレクトリ」「src配下のレイヤー依存ルール」「Schema命名」「DTOとOpenAPI schemaの配置」の各セクションは、`AGENTS.md` / `CLAUDE.md` の同名ルールの人間向け副本として扱う。アーキテクチャルールの正本は `AGENTS.md` / `CLAUDE.md` とし、これらのルールを変更する場合は同じPRでREADMEの該当セクションも同期すること。

Skill化した運用ルールは、詳細手順を `SKILL.md` に集約すること。`AGENTS.md` / `CLAUDE.md` には、常に守る共通原則（最小限のガードレール）と、対応するSkillへの導線（参照リンク）だけを残し、手順の全文を再掲しないこと。これにより `AGENTS.md` / `CLAUDE.md` の肥大化とドリフトを防ぐ。

- Skill化済みの運用ルールの詳細（手順・テンプレート・チェックリスト・コマンド例など）は `SKILL.md` を正本とする。
- `AGENTS.md` / `CLAUDE.md` には、Skillを起動しなくても外せない共通原則（例: コミットは1作業=1コミット、controllerとroutesは別コミット、レビュー対応はPR上の追加コミットで行う、など）と、Skillへの導線だけを残す。
- Skill化していない運用ルール（branch命名・push方法など）の詳細は、引き続き `AGENTS.md` / `CLAUDE.md` を正本とし、Skill側はそこを参照する。
- Codex版（`.codex/skills/`）とClaude版（`.claude/skills/`）のSkillは、方針・確認項目がずれないよう同期する。

サブエージェント定義（`.claude/agents/implementer.md` など）は、コールドスタートでエージェント定義自体が主要な文脈になるため、完全な参照寄せはドリフトを消す代わりに実装の取りこぼしリスクを上げる。そのため折衷を取る。

- 手順の長い再掲（命名規則の詳細、番号付きコミット順など）は、正本/`SKILL.md` 参照へ寄せる。
- 絶対に外せないガードレール（例: `src/features/*` 相互import禁止、controllerとroutesは別コミット）は、最小限に絞ってエージェント定義へ残す。

### Codex Skill

- PRレビューの詳細な手順は [`.codex/skills/pr-review/SKILL.md`](.codex/skills/pr-review/SKILL.md) を参照すること
- Issue作成・整理・本文レビューの詳細な手順は [`.codex/skills/issue-management/SKILL.md`](.codex/skills/issue-management/SKILL.md) を参照すること
- レビュー対応の手順は [`.codex/skills/review-response/SKILL.md`](.codex/skills/review-response/SKILL.md) を参照すること
- コミット粒度の確認手順は [`.codex/skills/commit-granularity/SKILL.md`](.codex/skills/commit-granularity/SKILL.md) を参照すること
- DB性能調査（遅い/多いSQLの調査）の手順は [`.codex/skills/db-performance/SKILL.md`](.codex/skills/db-performance/SKILL.md) を参照すること
- migrationを含む変更の実DB検証の詳細手順は [`.codex/skills/migration-verification/SKILL.md`](.codex/skills/migration-verification/SKILL.md) を参照すること
- Codex 用のプロジェクト内Skillは `.codex/skills/` に置くこと

### 変数名と関数名

- 英語のキャメルケースまたはパスカルケースを使用
- 日本語のローマ字表記は避けること
- 意味のある名前を使用すること
