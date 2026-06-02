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
|   |   `-- index.ts                 # top-level routes
|   |-- libs/
|   |   `-- prisma.ts                # Prisma Client setup
|   |-- features/
|   |   `-- users/
|   |       |-- controllers/
|   |       |-- dtos/
|   |       |-- entities/
|   |       |-- mappers/
|   |       |-- repositories/
|   |       |-- schemas/
|   |       `-- services/
|   |-- middlewares/
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
