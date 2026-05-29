# Deploy Todo to Vercel

This app is ready to deploy as a Vercel Node/serverless app with a static PWA frontend.

## 1. Import the repo

1. Open <https://vercel.com/new>.
2. Import `jdotfite/todo`.
3. Keep the default framework as **Other** if Vercel does not auto-detect it.
4. Leave the build command empty unless Vercel asks for one; there is no build step.

The repo includes:

- `vercel.json` rewrites for `/api/*` and SPA routes.
- `api/index.js` Express serverless entrypoint.
- `public/manifest.webmanifest` and `public/service-worker.js` for PWA installability.

## 2. Add Vercel KV

Create or attach a Vercel KV/Redis store, then add these environment variables to the project:

```text
KV_REST_API_URL=...
KV_REST_API_TOKEN=...
```

Optional:

```text
TODO_KV_KEY=todo:store
```

If `KV_REST_API_URL` and `KV_REST_API_TOKEN` are missing, the app falls back to local JSON file storage. That is fine for desktop development but not durable on Vercel serverless.

## 3. Add Alexa token

Set a shared Alexa token:

```text
ALEXA_API_TOKEN=<long-random-string>
```

Alexa requests must include this token either as:

```text
x-alexa-token: <long-random-string>
```

or in the endpoint URL:

```text
https://<your-vercel-app>.vercel.app/api/alexa?token=<long-random-string>
```

The query-string form is easier for the first manual Alexa Developer Console setup. Use account linking or a request-signature verifier later if this becomes more than a private household skill.

## 4. Verify deployment

After deploy, check:

```text
https://<your-vercel-app>.vercel.app/api/health
https://<your-vercel-app>.vercel.app/today
https://<your-vercel-app>.vercel.app/grocery
```

Expected health response:

```json
{ "ok": true }
```

## 5. Alexa skill setup

1. Open <https://developer.amazon.com/alexa/console/ask>.
2. Create a custom skill.
3. Use invocation name: `todo list`.
4. Paste `docs/alexa/interaction-model.json` into the JSON editor.
5. Set the default endpoint to:

```text
https://<your-vercel-app>.vercel.app/api/alexa?token=<ALEXA_API_TOKEN>
```

6. Test utterances:

```text
open todo list
add milk to my grocery list
add 2 paper towels to my grocery list
what is on my grocery list
what is on my todo list
```

## 6. Current Alexa intents

- `AddGroceryItemIntent` — adds item plus optional quantity to Walmart/grocery list.
- `AddTodoIntent` — adds a todo, or uses quick-add parsing if the phrase starts with `grocery` or `walmart`.
- `ListGroceryIntent` — reads unchecked grocery items.
- `ListTodosIntent` — reads today's open todos.
