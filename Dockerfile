# ---- 本番依存ステージ: 本番依存のみをインストールし最終イメージへ渡す ----
FROM oven/bun:1.3.14 AS prod-deps

WORKDIR /app

COPY package.json bun.lock ./
# devDependenciesを含めず本番依存のみをインストールする（--production）。
# --ignore-scriptsでprepareスクリプト（husky）等のライフサイクル実行を抑止する
# （huskyはdevDependencyのため--production下では存在せず、実行するとエラーになる）。
RUN HUSKY=0 bun install --frozen-lockfile --production --ignore-scripts

# ---- ビルドステージ: 全依存を入れPrismaクライアントをこのステージ内で生成する ----
FROM oven/bun:1.3.14 AS build

WORKDIR /app

COPY package.json bun.lock ./
RUN HUSKY=0 bun install --frozen-lockfile

# schema.prisma / prisma.config.ts / src等、生成に必要なファイルをコピーする
COPY . .

# .dockerignoreがsrc/generatedを除外するため、Prismaクライアントの生成はこのビルドステージ内で
# 完結させ、生成済み成果物（src/generated/prisma）を最終ステージへコピーする。
# 生成にはDATABASE_URLが要求されるが接続はしないため、ダミー値をビルドステージ側で渡す。
RUN DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres bun run prisma:generate

# ---- 実行ステージ: 実行に必要な成果物のみを含めるスリムな最終イメージ ----
FROM oven/bun:1.3.14 AS runtime

WORKDIR /app

ENV NODE_ENV=production

# 本番依存のみのnode_modules
COPY --from=prod-deps /app/node_modules ./node_modules

# アプリケーションソースと生成済みPrismaクライアント（src/generated/prisma）
COPY --from=build /app/src ./src

# 実行スクリプト（package.json）とpath alias（@/*）解決に必要な設定（tsconfig.json）
COPY package.json tsconfig.json ./

EXPOSE 3000

USER bun

CMD ["bun", "run", "start"]
