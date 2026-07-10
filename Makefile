.PHONY: start stop

start:
	bun run db:start
	bun run start

stop:
	bun run db:stop
