.PHONY: dev migrate start stop

dev:
	bun run db:start
	bun run dev

migrate:
	bun run db:start
	bun run prisma:migrate:dev

start:
	bun run db:start
	bun run start

stop:
	bun run db:stop
