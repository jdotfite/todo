# Todo

Personal todo system scaffolded for the Office desktop `_websites/todo` folder.

Architecture:

- **Local JSON locally; Neon/Postgres on Vercel** is the source of truth.
- **Task API** owns all task mutations and queries.
- **Discord/Hermes** is only a quick-capture interface.
- **Web app** is for organizing and editing.
- **E-ink endpoint** is a passive dashboard/feed.
- Todoist sync can be added later as an adapter without changing the task model.

## Quick start

```bash
npm install
npm start
```

Default server: <http://localhost:3456>

Override with environment variables:

```bash
PORT=3456 TODO_DB=./data/todo.json npm start
```

## Discord command parser API

Hermes can parse Discord slash-style text and call this endpoint:

```http
POST /api/discord/command
Content-Type: application/json

{ "command": "/todo add Fix arcade joystick" }
```

Supported Phase 1 commands:

- `/todo add Fix arcade joystick`
- `/todo list`
- `/todo done 4`
- `/todo today`
- `/todo project arcade`

The numeric IDs shown in list responses are display indexes for the filtered response, not permanent database IDs.

## Core API

- `GET /api/tasks?status=open|done&view=inbox|today&project=arcade`
- `POST /api/tasks`
- `PATCH /api/tasks/:id`
- `POST /api/tasks/:id/complete`
- `POST /api/tasks/reorder`
- `GET /api/projects`
- `GET /api/grocery`
- `POST /api/grocery`
- `PATCH /api/grocery/:id`
- `POST /api/grocery/clear-checked`
- `POST /api/quick-add`
- `GET /api/eink/today`
- `GET /api/eink/today.svg`
- `POST /api/alexa`

## Web pages

- `/inbox`
- `/today`
- `/future`
- `/grocery`
- `/projects`
- `/eink`
- `/done`

## Vercel, PWA, and Alexa

This repo includes a Vercel serverless entrypoint at `api/index.js` plus `vercel.json` rewrites for `/api/*` and the SPA routes.

The web app has baseline PWA installability:

- `public/manifest.webmanifest`
- `public/service-worker.js`
- `public/icon.svg`

Alexa can call `POST /api/alexa`. If `ALEXA_API_TOKEN` is set, Alexa requests must include the same value in the `x-alexa-token` header or `?token=` query parameter.

Supported initial Alexa intent names:

- `AddGroceryItemIntent` with `Item` and optional `Quantity` slots
- `AddTodoIntent` with `Task` or `Item` slot
- `ListGroceryIntent`
- `ListTodosIntent`

Next deployment step: configure durable Neon/Postgres storage before relying on Vercel for production data.

Set this environment variable in Vercel:

- `DATABASE_URL` — Neon pooled connection string
- Optional: `TODO_POSTGRES_KEY` defaults to `todo:store`
- Optional legacy fallback: `KV_REST_API_URL`, `KV_REST_API_TOKEN`, `TODO_KV_KEY`
- Optional: `ALEXA_API_TOKEN` protects Alexa requests

Without Postgres/KV env vars, the app falls back to local JSON storage for desktop/local development.

## E-ink JSON

```json
{
  "title": "Today",
  "tasks": ["Fix joystick vertical wiggle"],
  "waiting": ["Bolts from Amazon"]
}
```

SVG output is intentionally simple: large type, high contrast, few items.
