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
|   |-- hooks/
|   |-- rules/
|   `-- skills/
|       `-- pr-review/
|           `-- SKILL.md
|-- .codex/                          # Codex project-local skills
|   `-- skills/
|       `-- pr-review/
|           `-- SKILL.md
|-- .github/
|   `-- workflows/
|       `-- ci.yml                   # GitHub Actions CI
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
|   |   |   |-- routes/
|   |   |   |-- schemas/
|   |   |   `-- services/
|   |   |-- supabaseAuth/            # Supabase Auth feature
|   |   |   |-- controllers/
|   |   |   |-- routes/
|   |   |   |-- schemas/
|   |   |   `-- services/
|   |   `-- users/                   # users feature scaffold
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

## Routes

```txt
GET /        -> Hello Hono Dev Watch
GET /health  -> { "ok": true }
```

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

## Scripts

```bash
bun run dev              # start dev server with hot reload
bun run start            # start server
bun run build            # type-check build
bun run typecheck        # run TypeScript type check
bun run lint             # run ESLint with auto-fix
bun run format           # run Prettier
bun run spellcheck       # run cspell
bun test                 # run Bun Test
bun run prisma:generate  # generate Prisma Client
bun run prisma:validate  # validate Prisma schema
```

## Environment

```txt
PORT=3000
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
```

For staging and production, create separate Supabase projects and set each environment's `DATABASE_URL` in the deployment platform or CI secrets.
