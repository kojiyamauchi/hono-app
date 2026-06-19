# hono-app

<!-- cspell:ignore lintstagedrc -->

Hono を使ったバックエンド API の実装用プロジェクトです。

薄い Web フレームワークである Hono をベースに、実務で使いやすいバックエンド構成を試せるようにしています。現在はルーティング、ヘルスチェック、Prisma、ローカル Supabase、Lint / Format / Spell Check / CI の土台を入れています。

## Tech Stack

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

## Project Structure

```txt
.
|-- .claude/                         # Claude Code settings and skills
|   |-- agents/
|   |   `-- implementer.md           # implementation sub-agent (Sonnet)
|   |-- hooks/
|   |-- rules/
|   `-- skills/
|       |-- pr-review/
|       |   `-- SKILL.md
|       `-- review-response/
|           `-- SKILL.md
|-- .codex/                          # Codex project-local skills
|   `-- skills/
|       `-- pr-review/
|           `-- SKILL.md
|-- .github/
|   |-- pull_request_template.md     # PR template
|   `-- workflows/
|       |-- ci.yml                   # GitHub Actions CI
|       `-- comment-ops.yml          # PR comment operations
|-- .husky/
|   `-- pre-commit                   # pre-commit hook
|-- Dockerfile                       # Bun runtime container for deployment
|-- prisma/
|   |-- schema.prisma                # Prisma schema
|   `-- migrations/                  # Prisma migrations
|-- src/
|   |-- app.ts                       # Hono app instance
|   |-- server.ts                    # local server entrypoint
|   |-- routes/
|   |   `-- index.ts                 # top-level route registry
|   |-- libs/
|   |   |-- prisma.ts                # Prisma Client setup
|   |   `-- supabase.ts              # Supabase client setup
|   |-- features/
|   |   |-- auth/                    # custom auth feature
|   |   |   |-- controllers/
|   |   |   |-- dtos/
|   |   |   |-- entities/
|   |   |   |-- mappers/
|   |   |   |-- repositories/
|   |   |   |-- routes/
|   |   |   |-- schemas/
|   |   |   `-- services/
|   |   |-- supabaseAuth/            # Supabase Auth feature
|   |   |   |-- controllers/
|   |   |   |-- dtos/
|   |   |   |-- entities/
|   |   |   |-- mappers/
|   |   |   |-- repositories/
|   |   |   |-- routes/
|   |   |   |-- schemas/
|   |   |   `-- services/
|   |   `-- users/                   # users feature scaffold
|   |       |-- controllers/
|   |       |-- dtos/
|   |       |-- entities/
|   |       |-- mappers/
|   |       |-- repositories/
|   |       |-- schemas/
|   |       `-- services/
|   |-- middlewares/
|   |   |-- auth/
|   |   `-- supabaseAuth/
|   |-- shared/
|   |   `-- user/                    # shared User domain
|   |       |-- dtos/
|   |       |-- entities/
|   |       |-- mappers/
|   |       `-- repositories/
|   |-- types/
|   `-- utils/
|-- supabase/
|   |-- config.toml                  # local Supabase config
|   |-- seed.sql                     # local seed file
|   `-- snippets/
|-- .env.example                     # environment variable example
|-- .lintstagedrc.yml                # lint-staged config
|-- .prettierrc.yml                  # Prettier config
|-- CLAUDE.md                        # AI agent operating rules
|-- cspell.yml                       # spell check config
|-- eslint.config.mjs                # ESLint config
|-- package.json                     # Bun scripts and dependencies
|-- prisma.config.ts                 # Prisma CLI config
`-- tsconfig.json                    # TypeScript config
```

## Features Architecture

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

### Standard Directories

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

## Schema Naming

`src/features/**/schemas/` および `src/shared/**/schemas/` 配下では、Zod schemaとそこから推論する型の対応が分かる命名に揃えます。

- Zod schemaは `***Schema` として定義します。
  - 例: `signupSchema`、`updateMeSchema`、`userIdParamSchema`
- schemaから `z.infer` でexportする型は、対応するschema名に `Type` を付与した `***SchemaType` とします。
  - 例: `SignupSchemaType`、`UpdateMeSchemaType`
- param系schemaの型も同じ規則で `***ParamSchemaType` とします。
  - 例: `UserIdParamSchemaType`、`OrganizationIdParamSchemaType`
- schema由来の型には `***Input` や `***Param` のような別接尾語を使いません。

## Getting Started

Install dependencies.

```bash
bun install
```

Create `.env`.

```bash
cp .env.example .env
```

Start local Supabase.

```bash
bun run db:start
```

Apply Prisma migrations.

```bash
bun run prisma:migrate:dev
```

Start the development server.

```bash
bun run dev
```

The API runs on:

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

## Local Database

Local development uses Supabase CLI and Docker.

```txt
Supabase Studio: http://127.0.0.1:54323
API URL:         http://127.0.0.1:54321
Database URL:    postgresql://postgres:postgres@127.0.0.1:54322/postgres
```

Check local Supabase status.

```bash
bun run db:status
```

Stop local Supabase.

```bash
bun run db:stop
```

Open Prisma Studio.

```bash
bun run prisma:studio
```

テストと CI は意図的に DB 非依存（`mock.module` で repository をモック）です。そのため migration の適用や実 DB での挙動（transaction・一意制約・外部キーなど）は CI で検証されません。migration を含む変更は、ローカルで実 DB へ適用し必要に応じて smoke 確認してください。詳細は CLAUDE.md「migrationを含む変更の実DB検証」を参照してください。

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
