# hono-app

<!-- cspell:ignore lintstagedrc -->

Hono / Bun / TypeScript / Prisma / PostgreSQL をベースにした、バックエンド API の実装用プロジェクトです。

薄い Web フレームワークである Hono を使い、認証、ユーザー、組織、メンバー、招待、パスワードリセットなどの API を実装しています。ローカル開発では Supabase CLI による PostgreSQL を使い、Lint / Format / Spell Check / Test / CI の確認フローも整えています。

## 技術スタック

- Hono
- TypeScript
- Bun
- Prisma
- PostgreSQL
- Supabase CLI
- ESLint
- Prettier
- cspell
- Husky
- lint-staged
- Bun Test
- GitHub Actions

## ディレクトリ構成

```txt
.
|-- .claude/                         # Claude Code の設定とSkill
|   |-- agents/
|   |   `-- implementer.md           # 実装担当サブエージェント（Sonnet）
|   |-- hooks/
|   |-- rules/
|   `-- skills/
|       `-- <skill>/
|           `-- SKILL.md
|-- .codex/                          # Codex のプロジェクト内Skill
|   `-- skills/
|       `-- <skill>/
|           `-- SKILL.md
|-- .github/
|   |-- pull_request_template.md     # PRテンプレート
|   `-- workflows/
|       |-- ci.yml                   # GitHub Actions CI
|       `-- comment-ops.yml          # PRコメント操作
|-- .husky/
|   `-- pre-commit                   # pre-commit hook
|-- Dockerfile                       # デプロイ用のBun実行コンテナ
|-- docs/
|   |-- endpoints.md                 # 公開API一覧
|   `-- observability.md             # OpenTelemetry / New Relic運用手順
|-- prisma/
|   |-- schema.prisma                # Prismaスキーマ
|   `-- migrations/                  # Prisma migration
|-- src/
|   |-- app.ts                       # Honoアプリインスタンス
|   |-- server.ts                    # ローカルサーバーのエントリーポイント
|   |-- routes/
|   |   `-- index.ts                 # トップレベルroute登録
|   |-- libs/
|   |   |-- prisma/                  # Prisma Client設定
|   |   |-- supabase/                # Supabase client設定
|   |   `-- telemetry/               # OpenTelemetry初期化とspan計測
|   |-- features/
|   |   `-- <feature>/               # 公開URLのトップレベルに対応する機能境界
|   |       |-- controllers/
|   |       |-- dtos/
|   |       |-- entities/
|   |       |-- mappers/
|   |       |-- repositories/
|   |       |-- routes/
|   |       |-- schemas/
|   |       `-- services/
|   |-- middlewares/
|   |-- shared/
|   |   `-- <domain>/                # 複数featureで共有するドメイン・処理
|   |       |-- controllers/
|   |       |-- dtos/
|   |       |-- entities/
|   |       |-- mappers/
|   |       |-- repositories/
|   |       |-- routes/
|   |       |-- schemas/
|   |       `-- services/
|   |-- types/
|   `-- utils/
|-- supabase/
|   |-- config.toml                  # ローカルSupabase設定
|   |-- seed.sql                     # ローカルseed
|   `-- snippets/
|-- .env.example                     # 環境変数の例
|-- .lintstagedrc.yml                # lint-staged設定
|-- .prettierrc.yml                  # Prettier設定
|-- CLAUDE.md                        # AIエージェント向け運用ルール
|-- cspell.yml                       # spell check設定
|-- eslint.config.mjs                # ESLint設定
|-- package.json                     # Bun scriptsと依存関係
|-- prisma.config.ts                 # Prisma CLI設定
`-- tsconfig.json                    # TypeScript設定
```

## Features設計

このプロジェクトでは、公開URLのトップレベルroutingを機能境界として扱います。

- `src/routes/` はトップレベルroutingの入口です。
  - 例: `/auth`、`/supabase-auth`、`/users`
  - `src/routes/index.ts` は各featureのrouteをHonoアプリへ登録する集約場所です。
- トップレベルroutingごとに `src/features/` 配下へ対応するfeatureディレクトリを置きます。
  - 例: `/auth` -> `src/features/auth/`
  - 例: `/supabase-auth` -> `src/features/supabaseAuth/`
  - URLはkebab-case、featureディレクトリ名はTypeScriptの命名に合わせてcamelCaseを許容します。
- サブルートや詳細なルート定義は、対応する `src/features/<feature>/routes/` に閉じます。
  - `src/routes/` はトップレベルの入口、`src/features/<feature>/routes/` はfeature内部のルート詳細です。
- features間の相互importは禁止です。
  - `src/features/auth` から `src/features/supabaseAuth` をimportするような、featureを跨ぐ依存は作りません。
  - feature間で共有したい処理・型・ドメイン概念は `src/shared/` に切り出します。
- 複数featuresで使う機能は `src/shared/` 配下に置きます。
  - 例: 複数featureで使うUserドメイン、DTO、mapper、repositoryなど
- `src/shared/` から `src/features/` をimportすることは禁止です。
  - 依存方向は `features -> shared` の一方向に保ちます。

### 標準ディレクトリ

`src/features/<feature>/` と `src/shared/<domain>/` 配下の構成は、以下の標準ディレクトリに揃えます。

```txt
controllers/
dtos/
entities/
mappers/
repositories/
routes/
schemas/
services/
```

- 新しい責務名のディレクトリは原則として増やしません。
  - 例: `tokens/`、`handlers/`、`clients/` のような新しい概念を、個別判断で追加しません。
- 新しい処理を置く場合は、まず既存の標準ディレクトリのどれに属するかを判断します。
  - 例: JWT発行のような認証の共通処理は `src/shared/auth/services/` に置きます。
- 標準ディレクトリでは表現しづらい責務が出た場合は、実装前に設計方針を確認し、必要に応じてこのドキュメントを更新してから追加します。
- 現時点で実装がない標準ディレクトリには `.gitkeep` を置き、構成の一貫性を保ちます。

## Schema命名

`src/features/**/schemas/` および `src/shared/**/schemas/` 配下では、Zod schemaとそこから推論する型の対応が分かる命名に揃えます。

- Zod schemaは `***Schema` として定義します。
  - 例: `signupSchema`、`updateMeSchema`、`userIdParamSchema`
- schemaから `z.infer` でexportする型は、対応するschema名に `Type` を付与した `***SchemaType` とします。
  - 例: `SignupSchemaType`、`UpdateMeSchemaType`
- param系schemaの型も同じ規則で `***ParamSchemaType` とします。
  - 例: `UserIdParamSchemaType`、`OrganizationIdParamSchemaType`
- schema由来の型には `***Input` や `***Param` のような別接尾語を使いません。

## はじめに

依存関係をインストールします。

```bash
bun install
```

`.env` を作成します。

```bash
cp .env.example .env
```

ローカルSupabaseを起動します。

```bash
bun run db:start
```

Prisma migrationを適用します。

```bash
bun run prisma:migrate:dev
```

開発サーバーを起動します。

```bash
bun run dev
```

APIは以下で起動します。

```txt
http://localhost:3000
```

## API

公開エンドポイント一覧は [docs/endpoints.md](docs/endpoints.md) を参照してください。

### ブラウザクライアントからの利用

リフレッシュトークンは `HttpOnly Cookie`（`Path=/auth`）で管理されます。ブラウザからリクエストを送る場合は `credentials: 'include'` を指定してください。

```js
await fetch('/auth/login', {
  method: 'POST',
  credentials: 'include',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
})
```

アクセストークンはメモリ上で保持し、ページ再読み込み時は `POST /auth/refresh`（`credentials: 'include'`）で復元してください。リフレッシュCookieは自動送信されます。

#### Cookie の設定（環境差分）

- リフレッシュCookieは既定で `SameSite=Lax`・Secure 付きで発行されます。**フロントエンドとAPIが同一サイトの構成を既定**とします。
- `COOKIE_SECURE` は未設定なら有効（本番では必ず有効）。HTTP のローカル開発でのみ `COOKIE_SECURE=false` にしてください。
- フロントエンドとAPIが**cross-site**になる構成では `COOKIE_SAMESITE=None` を設定します。`SameSite=None` はブラウザ仕様上 Secure が必須のため、その場合 Secure は自動的に有効化されます。あわせて `ALLOWED_ORIGINS` に許可するフロントエンドのOriginを設定してください。

## ローカルデータベース

ローカル開発では Supabase CLI と Docker を使います。

```txt
Supabase Studio: http://127.0.0.1:54323
API URL:         http://127.0.0.1:54321
Database URL:    postgresql://postgres:postgres@127.0.0.1:54322/postgres
```

ローカルSupabaseの状態を確認します。

```bash
bun run db:status
```

ローカルSupabaseを停止します。

```bash
bun run db:stop
```

Prisma Studioを開きます。

```bash
bun run prisma:studio
```

テストと CI は意図的に DB 非依存（`mock.module` で repository をモック）です。そのため migration の適用や実 DB での挙動（transaction・一意制約・外部キーなど）は CI で検証されません。migration を含む変更は、ローカルで実 DB へ適用し必要に応じて smoke 確認してください。詳細は CLAUDE.md「migrationを含む変更の実DB検証」を参照してください。

## OpenTelemetry

`OTEL_TRACES_ENABLED=true` の場合、OpenTelemetryでHTTP request spanとPostgreSQLのDB spanを作成し、OTLP/HTTP protobuf exporterでNew Relicへ送信します。New Relic Node.js AgentはBun + Hono構成では使わず、OpenTelemetry経由のtrace送信を採用します。

DB spanは `@opentelemetry/instrumentation-pg` で計測します。Prismaは `@prisma/adapter-pg` 経由で `pg` を使うため、実アプリのDBアクセスは `pg` instrumentationで追跡します。DB spanは親spanがある場合だけ作成し、HTTP request spanの子spanとして紐づくことを前提にしています。

DB spanではSQL本文属性（`db.statement` または `db.query.text`）が送信される可能性があります。クエリのパラメータ値は `enhancedDatabaseReporting=false` で送らない設定にしていますが、`$queryRawUnsafe` などで個人情報やsecretをSQL文字列へ直接埋め込まないでください。

外部API呼び出しは、Bun上でfetch / SDK内部の自動計装に寄せず、serviceやmiddlewareの境界で手動spanを作成します。対象はResendのメール送信とSupabase Auth呼び出しです。span属性には依存先名、操作名、HTTP method、host、HTTP status相当、成功/失敗だけを入れ、API key、Authorization header、メール本文、メールアドレス、リセットトークン、パスワードなどの機微情報は入れません。

環境変数、secret管理、環境別の有効化方針、New Relic UIでの確認手順は [docs/observability.md](docs/observability.md) を参照してください。初期導入対象はtracesのみで、Datadog、logs、metrics、alert、dashboardは対象外です。

送信量は `OTEL_TRACES_SAMPLER_RATIO` で制御します。未設定時はroot traceの約10%を送信し、`/health` は既定でHTTP request spanの対象から除外します。

## Scripts

```bash
bun run dev              # start dev server with hot reload
bun run start            # start server
bun run build            # type-check build
bun run typecheck        # run TypeScript type check
bun run lint             # run ESLint with auto-fix
bun run format           # run Prettier
bun run spellcheck       # run cspell
bun test --isolate       # run Bun Test with isolated test files
bun run prisma:generate  # generate Prisma Client
bun run prisma:validate  # validate Prisma schema
```

## Environment

```txt
PORT=3000
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
```

For staging and production, create separate Supabase projects and set each environment's `DATABASE_URL` in the deployment platform or CI secrets.

### パスワードリセットメール（本番利用に必要な設定）

パスワードリセット機能を本番利用する場合、以下の環境変数を設定してください。

| 環境変数                    | 説明                                                                                                     |
| --------------------------- | -------------------------------------------------------------------------------------------------------- |
| `RESEND_API_KEY`            | Resend の API キー。[resend.com](https://resend.com) でアカウントを作成し発行する。                      |
| `PASSWORD_RESET_FROM_EMAIL` | パスワードリセットメールの送信元アドレス。Resend で検証済みのドメインを使用する。                        |
| `PASSWORD_RESET_URL_BASE`   | フロントエンドのパスワード再設定ページの URL。`?token=...` が付与されてメール本文のリセット URL になる。 |

```txt
RESEND_API_KEY="re_your_resend_api_key"
PASSWORD_RESET_FROM_EMAIL="noreply@your-domain.com"
PASSWORD_RESET_URL_BASE="https://your-frontend.com/reset-password"
```

- `RESEND_API_KEY` / `PASSWORD_RESET_FROM_EMAIL` / `PASSWORD_RESET_URL_BASE` のいずれかが未設定の場合、メール送信は失敗し、発行済みのリセットトークンは補償削除されます。ただし**アカウント列挙を防ぐため、外部レスポンスは登録有無・配送成否によらず常に `202 Accepted`** を返します（配送失敗は機密を含めない形でサーバーログに記録されます）。
- CI では Resend SDK をモックするため、実際のAPIキーは不要です。
- Resend 受理後の非同期バウンス・迷惑メール判定・実配達失敗は補償対象外です（Resend の管理画面で確認してください）。

### パスワードリセットリクエストのレート制限

`POST /auth/password-reset/request` は、メール大量送信や連打を抑制するため、IP単位とemail単位のレート制限を行います。

| 制限単位  | 初期値         | 超過時の外部レスポンス  |
| --------- | -------------- | ----------------------- |
| IP単位    | 15分で5回まで  | `429 Too Many Requests` |
| email単位 | 1時間で3回まで | `202 Accepted`          |

- email単位の制限では、アカウント列挙を防ぐため、超過時も外部レスポンスは通常の受理時と同じ `202 Accepted` を維持します。この場合、トークン発行とメール送信は行いません。
- email単位の制限キーには、正規化したメールアドレスのHMACを使用し、平文メールアドレスをレート制限storeへ保存しません。
- email単位の制限により送信をスキップする場合も、通常の `202 Accepted` と区別しにくいよう最低応答時間＋jitterを適用します。
- レート制限の保存先はプロセス内メモリです。プロセス再起動でリセットされ、複数インスタンス間では共有されません。
- インメモリstoreはTTLで期限切れエントリを掃除し、キーが残り続けないようにします。
- `x-forwarded-for` を使うIP判定は、信頼できるプロキシ/CDN背後でのみ信頼する前提です。IPを特定できない場合は、全クライアントを同じキーへ束ねないようIP単位の制限をスキップします。
