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

## プロジェクトの目的

このプロジェクトは、Honoを用いた実務レベルのバックエンドAPI設計と、Codex / Claude Codeを組み込んだAIエージェント開発フローを検証するためのプロジェクトです。

主に以下を実践しています。

- Feature単位の機能境界と、一方向のレイヤー依存
- 独自JWT認証とSupabase Authの比較実装
- リフレッシュトークンのローテーションとセッション管理
- 組織、メンバー、招待、所有権移譲などの業務フロー
- PostgreSQL transaction、行ロック、DB制約による整合性保証
- Zodを正本とした入力検証、レスポンスDTO、OpenAPI生成
- OpenTelemetry / New Relicによる可観測性
- Issue、PR、Skill、サブエージェントを用いたAI支援開発

独自認証の `/auth` とSupabase Authの `/supabase-auth` は、単一プロダクトで二つの認証方式を併用することを目的としたものではありません。認証基盤を自前で構築する場合と、マネージドサービスへ委譲する場合の設計・実装上の違いを比較するため、両方を実装しています。

## アプリケーション構成

```mermaid
flowchart TD
    Client[API Client]

    Client --> App[Hono / OpenAPIHono]
    App --> GlobalMiddleware[Global Middleware]
    GlobalMiddleware --> Routes[Top-level Routes]

    Routes --> FeatureRoutes[Feature Routes]
    FeatureRoutes --> Controllers[Controllers]
    Controllers --> Services[Services]
    Services --> Repositories[Repositories]

    Services --> Shared[Shared Domains]
    Repositories --> Prisma[Prisma Client]

    Shared --> Libs[External Service Clients]
    Services --> Libs
    Shared --> Resend[Resend]
    Prisma --> PostgreSQL[(PostgreSQL)]

    Libs --> Supabase[Supabase Auth]
    Libs --> Telemetry[OpenTelemetry / New Relic]
```

HTTPリクエストは、基本的に次の流れで処理します。

```mermaid
sequenceDiagram
    participant Client
    participant Route
    participant Middleware
    participant Controller
    participant Service
    participant Repository
    participant DB as PostgreSQL

    Client->>Route: HTTP Request
    Route->>Middleware: 認証・認可
    Middleware-->>Route: userId / membership
    Route->>Controller: 検証済み入力
    Controller->>Service: ユースケース実行
    Service->>Repository: データ取得・更新
    Repository->>DB: Prisma / SQL
    DB-->>Repository: Result
    Repository-->>Service: Entity / Result union
    Service-->>Controller: DTO
    Controller-->>Client: HTTP Response
```

ControllerはHTTPリクエストとレスポンスの変換、Serviceはユースケースと業務ルール、Repositoryはデータ取得・更新とtransaction境界を担当します。複数featureで共有するドメイン処理は `src/shared/`、Prisma・Supabase・Telemetryのクライアントは `src/libs/` に配置します。Resendによる通知処理は `src/shared/auth/services/` に実装しています。

### 認証構成

```mermaid
flowchart LR
    Client[Browser Client]

    Client -->|Authorization: Bearer| AccessToken[Access Token]
    Client -->|HttpOnly Cookie| RefreshToken[Refresh Token]

    AccessToken --> AuthMiddleware[Auth Middleware]
    AuthMiddleware --> UserCheck[User existence check]
    UserCheck --> ProtectedAPI[Protected API]

    RefreshToken --> RefreshAPI[POST /auth/refresh]
    RefreshAPI --> TokenRepository[RefreshToken Repository]
    TokenRepository --> TokenDB[(RefreshToken Table)]
    RefreshAPI --> NewTokens[New Access Token<br/>Rotated Refresh Token]
```

- アクセストークンは `Authorization: Bearer` ヘッダーで送信します。
- リフレッシュトークンはHttpOnly Cookieで管理し、平文ではなくハッシュをDBへ保存します。
- リフレッシュ時はトークンをローテーションし、セッション単位または全セッションを失効できます。
- 認証ミドルウェアではUserの存在も確認し、削除済みユーザーの既発行アクセストークンを拒否します。

## ディレクトリ構成

```txt
.
|-- .claude/                         # Claude Code の設定とSkill
|   |-- agents/                      # サブエージェント定義
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
|-- .dockerignore                    # Docker build contextの除外設定
|-- .lintstagedrc.yml                # lint-staged設定
|-- .prettierignore                  # Prettier対象外設定
|-- .prettierrc.yml                  # Prettier設定
|-- AGENTS.md                        # Codex向け運用ルール
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
- OpenAPIドキュメント公開（`/open-api/doc` / `/open-api/scalar`）は、標準構成に対する例外として次を許容します。
  - `src/shared/openApi/schemes/`: OpenAPIのsecurity scheme（認証「方式」の定義）を置く標準外の責務ディレクトリです。入力検証用Zod schema（データ構造）を置く `schemas/` とは責務が異なるため分離します。
  - `src/features/openApi`: OpenAPI仕様は各featureのroute定義がroot app（`OpenAPIHono`）へ集約されて全体が揃うため、`app.route()` でmountせず、root appを受け取って `/open-api/doc`・`/open-api/scalar` を登録する登録関数 `registerOpenApiRoutes(app)` を提供します。

### src配下のレイヤー依存ルール

`src/` 配下の全層を以下の線形レイヤーとして整理し、importは図の下方向のみ許可します。

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

- 各層は自分より下のすべての層をimport可（隣接層に限定しません）。上方向のimportは禁止です。
- `src/generated/` は自動生成物として全層から参照可（最下層扱い）です。
- 外部パッケージは全層から参照可です。

#### 各層の責務

- `types/`: アプリ全体で使う型宣言専用（Honoの型拡張、環境変数の型など）です。ランタイムコードは置きません。
- `utils/`: 特定サービスのクライアント実体に依存しない汎用ユーティリティ（errors / rateLimit / timing / validation / prisma判定ヘルパーなど）です。外部パッケージや生成物の型（例: `@/generated/prisma/client` の `Prisma` 型）の利用は可ですが、`libs` のクライアント実体へのimportは禁止です。
- `libs/`: 外部サービス・インフラのクライアント（prisma / supabase / telemetry）です。`utils` のimportは許可します。
- `shared/`: 複数featureで使う共有ドメイン（前述の定義どおり）です。`middlewares`・`features` へのimportは禁止です（HTTP層の関心事をsharedへ持ち込まず、ミドルウェアが設定した値はcontroller/feature側で取り出して引数として渡します）。ただし、`src/shared/auth/services/` のcookieヘルパーはCookie入出力に責務を限定し、Controllerから受け取った `Context` を操作する例外とします。
- `middlewares/`: Hono横断ミドルウェアです。`shared` のrepositoryの利用は許可します。`features` へのimportは禁止です。
- `features/`: `shared` 以下の層に加え `middlewares` もimport可（feature内routesでのミドルウェア適用）です。feature間の相互importは前述のとおり禁止です。
- `routes/` / `app.ts` / `server.ts`: 配線層です。全層をimport可（例: `app.ts` でのグローバルミドルウェア適用・CORS設定・telemetry初期化）です。

## Schema命名

`src/features/**/schemas/` および `src/shared/**/schemas/` 配下では、Zod schemaとそこから推論する型の対応が分かる命名に揃えます。

- Zod schemaは `***Schema` として定義します。
  - 例: `signupSchema`、`updateMeSchema`、`userIdParamSchema`
- schemaから `z.infer` でexportする型は、対応するschema名に `Type` を付与した `***SchemaType` とします。
  - 例: `SignupSchemaType`、`UpdateMeSchemaType`
- param系schemaの型も同じ規則で `***ParamSchemaType` とします。
  - 例: `UserIdParamSchemaType`、`OrganizationIdParamSchemaType`
- schema由来の型には `***Input` や `***Param` のような別接尾語を使いません。
- `dtos/` 配下のZod DTO定義とその型はこの規則の対象外とし、後述の `***Dto` / `***DtoType` 命名に従います。

## DTOとOpenAPI schemaの配置

OpenAPIを導入しており、入力検証用schemaとレスポンスDTOの責務を分離します。

- `schemas/` はrequest body / query / paramなどの入力検証用Zod schemaに寄せます。
- `dtos/` はAPIレスポンスDTOに寄せます。
- レスポンスDTOはZodで定義し、OpenAPI response schemaとDTO型の正本にします。
- DTO定義名は `***Dto`、そこから `z.infer` でexportする型名は `***DtoType` とします。
  - 例: `userDto`、`UserDtoType`
- レスポンスDTOのZodは通常の本番レスポンスで毎回parseせず、mapperテストで `safeParse` して実装との整合を担保します。
- OpenAPI JSONは `/open-api/doc` で動的生成し、手書きの `openapi.yml` を正本にしません。
- `/open-api/doc` と `/open-api/scalar` は `ENABLE_API_DOCS=true` のときだけ登録し、staging / prodでは原則非公開にします。

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
make migrate
```

開発サーバーを起動します。

```bash
bun run dev
```

APIは以下で起動します。

```txt
http://localhost:3000
```

### 日常の起動・停止

初回セットアップ後は、ローカルSupabaseと開発サーバーをまとめて起動できます。

```bash
make dev
```

ホットリロードを使わずにサーバーを起動する場合は、次のコマンドを実行します。

```bash
make start
```

`make dev` と `make start` は、`bun run db:start` の正常完了後にそれぞれのサーバーを起動します。Prisma migrationの適用は含まないため、初回セットアップ時やmigration追加後は、事前に `make migrate` を実行してください。

`make migrate` は、`bun run db:start` の正常完了後に `bun run prisma:migrate:dev` を実行します。

終了時は `Ctrl+C` でサーバーを停止してから、ローカルSupabaseを停止します。

```bash
make stop
```

## API

公開エンドポイント一覧は [docs/endpoints.md](docs/endpoints.md) を参照してください。

### OpenAPI / Scalar

`ENABLE_API_DOCS=true` のとき、OpenAPI仕様とAPIリファレンスUIを利用できます。ローカル開発では `.env` に `ENABLE_API_DOCS=true` を設定してください。

- `GET /open-api/doc`: OpenAPI JSON（Zod定義から動的生成）
- `GET /open-api/scalar`: Scalar UI（`/open-api/doc` を読み込んで表示）

`ENABLE_API_DOCS=false`（既定）のときは両エンドポイントを登録せず404になります。staging / prod では原則 `false` とし、OpenAPI JSONとScalar UIを外部公開しません。

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

テストと CI は意図的に DB 非依存（`mock.module` で repository をモック）です。そのため migration の適用や実 DB での挙動（transaction・一意制約・外部キーなど）は CI で検証されません。migration を含む変更は、ローカルで実 DB へ適用し必要に応じて smoke 確認してください。共通原則は CLAUDE.md / AGENTS.md「migrationを含む変更の実DB検証」、詳細手順は migration検証Skill（[.claude/skills/migration-verification/SKILL.md](.claude/skills/migration-verification/SKILL.md)）を参照してください。

## OpenTelemetry

`OTEL_TRACES_ENABLED=true` の場合、OpenTelemetryでHTTP request spanとPostgreSQLのDB spanを作成し、OTLP/HTTP protobuf exporterでNew Relicへ送信します。New Relic Node.js AgentはBun + Hono構成では使わず、OpenTelemetry経由のtrace送信を採用します。

DB spanは `@opentelemetry/instrumentation-pg` で計測します。Prismaは `@prisma/adapter-pg` 経由で `pg` を使うため、実アプリのDBアクセスは `pg` instrumentationで追跡します。DB spanは親spanがある場合だけ作成し、HTTP request spanの子spanとして紐づくことを前提にしています。

DB spanではSQL本文属性（`db.statement` または `db.query.text`）が送信される可能性があります。クエリのパラメータ値は `enhancedDatabaseReporting=false` で送らない設定にしていますが、`$queryRawUnsafe` などで個人情報やsecretをSQL文字列へ直接埋め込まないでください。

外部API呼び出しは、Bun上でfetch / SDK内部の自動計装に寄せず、serviceやmiddlewareの境界で手動spanを作成します。対象はResendのメール送信とSupabase Auth呼び出しです。span属性には依存先名、操作名、HTTP method、host、HTTP status相当、成功/失敗だけを入れ、API key、Authorization header、メール本文、メールアドレス、リセットトークン、パスワードなどの機微情報は入れません。

環境変数、secret管理、環境別の有効化方針、New Relic UIでの確認手順は [docs/observability.md](docs/observability.md) を参照してください。初期導入対象はtracesのみで、Datadog、logs、metrics、alert、dashboardは対象外です。

送信量は `OTEL_TRACES_SAMPLER_RATIO` で制御します。未設定時はroot traceの約10%を送信し、`/health` は既定でHTTP request spanの対象から除外します。

## Scripts

```bash
make dev                    # Supabaseとホットリロード付き開発サーバーを順番に起動
make migrate                # Supabaseの起動後にPrisma migrationを作成・適用
make start                  # Supabaseとサーバーを順番に起動
make stop                   # ローカルSupabaseを停止
bun run dev                 # ホットリロード付きで開発サーバーを起動
bun run start               # サーバーを起動
bun run build               # TypeScriptの型チェック
bun run typecheck           # TypeScriptの型チェック
bun run lint                # ESLintによる自動修正
bun run lint:check          # ESLintによるチェックのみ（--fixなし・CIで使用）
bun run format              # Prettierによるフォーマット
bun run spellcheck          # cspellによるスペルチェック
bun test --isolate          # Bun Testを分離実行
bun run lint-staged         # staged files向けチェックを実行
bun run db:start            # ローカルSupabaseを起動
bun run db:status           # ローカルSupabaseの状態を確認
bun run db:stop             # ローカルSupabaseを停止
bun run db:reset            # ローカルSupabase DBをリセット
bun run prisma:generate     # Prisma Clientを生成
bun run prisma:migrate:dev  # Prisma migrationを作成・適用
bun run prisma:validate     # Prisma schemaを検証
bun run prisma:format       # Prisma schemaをフォーマット
bun run prisma:studio       # Prisma Studioを起動
```

## Environment

`.env.example` を `.env` にコピーし、環境に合わせて値を設定してください。

```txt
PORT=3000
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
ENABLE_API_DOCS=false
JWT_SECRET="your-jwt-secret"
REFRESH_TOKEN_SECRET="your-refresh-token-secret"
PASSWORD_RESET_TOKEN_SECRET="your-password-reset-token-secret"
EMAIL_VERIFICATION_TOKEN_SECRET="your-email-verification-token-secret"
SUPABASE_URL="http://127.0.0.1:54321"
SUPABASE_ANON_KEY="your-supabase-anon-key"
ALLOWED_ORIGINS="http://localhost:3000"
```

`ENABLE_API_DOCS` はOpenAPI JSON(`/open-api/doc`)とScalar UI(`/open-api/scalar`)の公開フラグです。`true` のときだけ登録し、staging / prod では原則 `false` とします。

staging / production では環境ごとに別のSupabase projectを作成し、`DATABASE_URL` や各secretをdeployment platformまたはCI secretsで管理してください。

Cookie、パスワードリセット、メールアドレス検証、OpenTelemetry / New Relic送信に関する環境変数も `.env.example` に定義しています。OpenTelemetryの詳細は [docs/observability.md](docs/observability.md) を参照してください。

### パスワードリセット（本番利用に必要な設定）

パスワードリセット機能を本番利用する場合、以下の環境変数を設定してください。

| 環境変数                      | 説明                                                                                                     |
| ----------------------------- | -------------------------------------------------------------------------------------------------------- |
| `PASSWORD_RESET_TOKEN_SECRET` | パスワードリセットトークンのHMAC-SHA256署名鍵。設定がないとパスワードリセットエンドポイントが500を返す。 |
| `RESEND_API_KEY`              | Resend の API キー。[resend.com](https://resend.com) でアカウントを作成し発行する。                      |
| `PASSWORD_RESET_FROM_EMAIL`   | パスワードリセットメールの送信元アドレス。Resend で検証済みのドメインを使用する。                        |
| `PASSWORD_RESET_URL_BASE`     | フロントエンドのパスワード再設定ページの URL。`?token=...` が付与されてメール本文のリセット URL になる。 |

```txt
PASSWORD_RESET_TOKEN_SECRET="your-password-reset-token-secret"
RESEND_API_KEY="re_your_resend_api_key"
PASSWORD_RESET_FROM_EMAIL="noreply@your-domain.com"
PASSWORD_RESET_URL_BASE="https://your-frontend.com/reset-password"
```

- `PASSWORD_RESET_TOKEN_SECRET` が未設定の場合、パスワードリセットトークンを発行できないため500を返します。
- `RESEND_API_KEY` / `PASSWORD_RESET_FROM_EMAIL` / `PASSWORD_RESET_URL_BASE` のいずれかが未設定の場合、メール送信は失敗し、発行済みのリセットトークンは補償削除されます。ただし**アカウント列挙を防ぐため、外部レスポンスは登録有無・配送成否によらず常に `202 Accepted`** を返します（配送失敗は機密を含めない形でサーバーログに記録されます）。
- CI では Resend SDK をモックするため、実際のAPIキーは不要です。
- Resend 受理後の非同期バウンス・迷惑メール判定・実配達失敗は補償対象外です（Resend の管理画面で確認してください）。

### メールアドレス検証（本番利用に必要な設定）

メールアドレス検証機能を本番利用する場合、共通の `RESEND_API_KEY` に加えて以下の環境変数を設定してください。

| 環境変数                          | 説明                                                                                |
| --------------------------------- | ----------------------------------------------------------------------------------- |
| `EMAIL_VERIFICATION_TOKEN_SECRET` | 検証トークンのHMAC-SHA256署名鍵。パスワードリセット用とは異なる値を設定する。       |
| `EMAIL_VERIFICATION_FROM_EMAIL`   | 検証メールの送信元アドレス。Resend で検証済みのドメインを使用する。                 |
| `EMAIL_VERIFICATION_URL_BASE`     | フロントエンドの検証ページURL。`?token=...` が付与されてメール本文の検証URLになる。 |

```txt
EMAIL_VERIFICATION_TOKEN_SECRET="your-email-verification-token-secret"
RESEND_API_KEY="re_your_resend_api_key"
EMAIL_VERIFICATION_FROM_EMAIL="noreply@your-domain.com"
EMAIL_VERIFICATION_URL_BASE="https://your-frontend.com/verify-email"
```

- 検証トークンの有効期限は24時間で、再発行時に同じユーザーの未使用トークンを置き換えます。
- `/auth/signup` と `/invitations/signup` は登録成功後に検証メールを送信します。トークン保存またはメール送信に失敗しても登録結果は維持し、配送失敗時は発行済みトークンを補償削除します。
- `POST /auth/email-verification/request` はユーザー単位で1時間に3回まで再送できます。
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
