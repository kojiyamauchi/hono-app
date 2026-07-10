.PHONY: dev start stop

dev:
	bun run db:start
	bun run dev

start:
	bun run db:start
	bun run start

stop:
	bun run db:stop
