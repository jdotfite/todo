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

## 3. Add household auth

Before sharing the Vercel URL, set these environment variables:

```text
HOUSEHOLD_PASSWORD=<shared-family-password>
AUTH_SECRET=<long-random-string>
```

When `HOUSEHOLD_PASSWORD` is set, app pages redirect to `/login` and `/api/*` routes require a valid login session. `AUTH_SECRET` signs the HttpOnly session cookie; make it a different long random value from the household password.

Optional integration tokens:

```text
HOUSEHOLD_API_TOKEN=<long-random-string>
EINK_API_TOKEN=<long-random-string>
```

- API clients can pass `x-todo-token: <HOUSEHOLD_API_TOKEN>` or `?token=...`.
- The e-paper dashboard can pass `x-eink-token: <EINK_API_TOKEN>` or `?token=...` to `/api/eink/*` endpoints.
- If `EINK_API_TOKEN` is omitted, `/api/eink/*` falls back to `HOUSEHOLD_API_TOKEN`.

See `.env.example` for the full deployment environment checklist.

## 4. Add Alexa token

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
https://<your-vercel-app>.vercel.app/api/alexa?token=***
```

The query-string form is easier for the first manual Alexa Developer Console setup. Use account linking or a request-signature verifier later if this becomes more than a private household skill.

## 5. Add Google Calendar for the e-paper dashboard

The `/api/eink/dashboard` endpoint includes a `calendar` array for the next few days.

For Vercel, the simplest private read-only setup is the Family calendar's **secret iCal URL**:

```text
GOOGLE_CALENDAR_ICAL_URL=<secret-google-calendar-ical-url>
```

Google Calendar path: Calendar settings → select the Family calendar → **Integrate calendar** → copy **Secret address in iCal format**. Keep this URL private; anyone with it can read that calendar.

Local/Hermes fallback uses the Google Workspace OAuth token on this machine:

```text
FAMILY_CALENDAR_ID=family12925651382350424080@group.calendar.google.com
GOOGLE_API_SCRIPT=/home/agent/.hermes/skills/productivity/google-workspace/scripts/google_api.py
```

Optional tuning:

```text
EINK_CALENDAR_ENABLED=true
EINK_CALENDAR_DAYS=3
EINK_CALENDAR_MAX=8
EINK_FACTS_ENABLED=true
EINK_FACT_CACHE_MS=3600000
```

Verify with:

```text
https://<your-vercel-app>.vercel.app/api/eink/dashboard?token=***
```

The response should include upcoming events like:

```json
{
  "calendar": [
    { "summary": "Soccer practice", "date": "2026-06-05", "time": "All day" }
  ]
}
```

## 6. Verify deployment

After deploy, check:

```text
https://<your-vercel-app>.vercel.app/api/health
https://<your-vercel-app>.vercel.app/today
https://<your-vercel-app>.vercel.app/grocery
https://<your-vercel-app>.vercel.app/api/eink/dashboard?token=***
```

Expected health response:

```json
{ "ok": true }
```

If household auth is enabled, `/today` and `/grocery` should redirect to `/login` until you enter the household password.

## 7. Alexa skill setup

1. Open <https://developer.amazon.com/alexa/console/ask>.
2. Create a custom skill.
3. Use invocation name: `todo list`.
4. Paste `docs/alexa/interaction-model.json` into the JSON editor.
5. Set the default endpoint to:

```text
https://<your-vercel-app>.vercel.app/api/alexa?token=***
```

6. Test utterances:

```text
open todo list
add milk to my grocery list
add 2 paper towels to my grocery list
what is on my grocery list
what is on my todo list
```

## 8. Current Alexa intents

- `AddGroceryItemIntent` — adds item plus optional quantity to Walmart/grocery list.
- `AddTodoIntent` — adds a todo, or uses quick-add parsing if the phrase starts with `grocery` or `walmart`.
- `ListGroceryIntent` — reads unchecked grocery items.
- `ListTodosIntent` — reads today's open todos.
