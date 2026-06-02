FROM oven/bun:1.3.14

WORKDIR /app

COPY package.json bun.lock ./
RUN HUSKY=0 bun install --frozen-lockfile

COPY . .
RUN DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres bun run prisma:generate

ENV NODE_ENV=production

EXPOSE 3000

USER bun

CMD ["bun", "run", "start"]
