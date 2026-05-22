# QQNotice

A Server酱-style notification service that pushes private-message notifications
to QQ via a pool of OneBot (NapCat) bots.

> Status: very early. The repository currently contains only the deepest
> internal modules of the server (`OneBotClient`, `FriendshipCache`) and their
> tests. There is no runnable application yet.

## Workspace layout

```
.
├── server/       # Node + TypeScript backend (Fastify + Prisma + ws, all WIP)
└── web/          # React + Vite frontend (not yet scaffolded)
```

## Requirements

- Node.js 20+
- pnpm 9+
- MySQL 8 (for later slices; not needed yet)

## Common commands

```sh
pnpm install              # install all workspace deps
pnpm -C server test       # run server unit tests
```

## License

TBD
