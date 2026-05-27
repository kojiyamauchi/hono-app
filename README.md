# hono-app

Hono を使ったバックエンド API の実装用プロジェクトです。

薄い Web フレームワークである Hono をベースに、実務で使いやすいバックエンド構成を試せるようにしています。現在はルーティング、ヘルスチェック、Prisma、ローカル Supabase、Lint / Format / Spell Check / CI の土台を入れています。

## Tech Stack

- Hono
- TypeScript
- Node.js
- Prisma
- PostgreSQL
- Supabase CLI
- ESLint
- Prettier
- cspell
- Husky
- lint-staged
- Jest
- GitHub Actions

## Project Structure

```txt
src/
  app.ts               # Hono app instance
  server.ts            # local server entrypoint
  routes/
    index.ts           # top-level routes
  libs/
    prisma.ts          # Prisma Client setup
  generated/
    prisma/            # generated Prisma Client
prisma/
  schema.prisma        # Prisma schema
  migrations/          # Prisma migrations
supabase/
  config.toml          # local Supabase config
  seed.sql             # local seed file
```

## Getting Started

Install dependencies.

```bash
npm install
```

Create `.env`.

```bash
cp .env.example .env
```

Start local Supabase.

```bash
npm run db:start
```

Apply Prisma migrations.

```bash
npm run prisma:migrate:dev
```

Start the development server.

```bash
npm run dev
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
npm run db:status
```

Stop local Supabase.

```bash
npm run db:stop
```

Open Prisma Studio.

```bash
npm run prisma:studio
```

## Scripts

```bash
npm run dev              # start dev server with watch mode
npm run start            # start server
npm run build            # type-check build
npm run typecheck        # run TypeScript type check
npm run lint             # run ESLint with auto-fix
npm run format           # run Prettier
npm run spellcheck       # run cspell
npm run jest             # run Jest
npm run prisma:generate  # generate Prisma Client
npm run prisma:validate  # validate Prisma schema
```

## Environment

```txt
PORT=3000
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
```

For staging and production, create separate Supabase projects and set each environment's `DATABASE_URL` in the deployment platform or CI secrets.
