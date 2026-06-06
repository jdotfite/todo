# Household Users, Avatars, and Profile Login Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task if further work is needed.

**Goal:** Turn Household Hub from a shared PIN app into a family-profile app where Justin, Kari, Hudson, and Cohen pick an account first, enter a profile PIN when required, and can customize avatars.

**Architecture:** Keep household auth simple and private: one signed household session cookie plus one signed active-profile cookie. Profiles are stored in the app store, normalized with safe defaults, and exposed through `/api/profiles`, `/api/profile`, `/api/profile/select`, and avatar update routes. The login screen uses a Netflix-style profile picker, while Settings handles avatar uploads and calendar/profile personalization.

**Tech Stack:** Node/Express, existing JSON/KV store adapter, signed cookies, SHA-256 profile PIN hashes, vanilla JS frontend, PWA cache-bumped static assets, Node test runner.

---

## Current State

A first pass is already present on `main`:

- Default profiles: `family`, `justin`, `kari`, `cohen`, `hudson`.
- Kari and kids have profile PIN hashes stored in code defaults; concrete PIN values must not be repeated in docs or logs.
- Legacy `wife` profile IDs are normalized to `kari`.
- Login page renders a profile-picker grid and PIN overlay.
- Settings page includes avatar upload/remove controls.
- Avatar API accepts image data URLs up to 500 KB.
- `/chat` authenticated smoke check loads `styles.css?v=hub-pwa-14` and has no console errors in current verification.

## Product Shape

### Login UX

1. Visiting a protected route redirects to `/login?next=<route>`.
2. Login screen shows large profile avatars like Netflix:
   - Family
   - Justin
   - Kari
   - Cohen
   - Hudson
3. Selecting a profile with a PIN opens a focused 4-dot PIN modal.
4. Correct PIN sets:
   - household session cookie
   - active profile cookie
5. Correct login redirects back to `next`, protected against open redirects.
6. Incorrect PIN shows inline error and respects existing rate limiting.

### Profile Visibility

Profile visibility remains personalization first, not strong authorization.

Recommended initial module visibility:

- Family: Home, Calendar, Grocery, Documents, Chat
- Justin: Home, Tasks, Calendar, Grocery, Documents, Chat
- Kari: Home, Calendar, Grocery, Documents, Tips, Chat
- Kids: Home, Grocery, Chat

Future hardening can add server-side role gates for sensitive modules if needed.

### Avatars

1. Settings shows every profile.
2. Each profile has:
   - current avatar or colored initial
   - Upload/Change button
   - Remove button if avatar exists
3. Uploaded avatars are stored as image data URLs in the profile store for now.
4. Enforce:
   - image data URL only
   - max size 500 KB
   - no SVG upload unless explicitly trusted later
5. Future upgrade: crop/resize client-side before upload so phone photos are reliable.

---

## Implementation Tasks

### Task 1: Regression-test the Netflix-style login screen

**Objective:** Lock down account-picking login behavior.

**Files:**
- Modify: `tests/deploy.test.js`
- Modify: `src/auth.js`

**Steps:**
1. Assert `/login` includes `profile-grid`, all profile names, `pin-overlay`, and numeric 4-digit PIN input.
2. Assert no concrete PIN values appear in login HTML.
3. Assert `next=//evil.com` falls back to `/home`.
4. Run: `node --test --test-concurrency=1 tests/deploy.test.js`.

### Task 2: Profile PIN login API coverage

**Objective:** Confirm profile PINs select the correct profile and maintain household auth.

**Files:**
- Modify: `tests/profiles.test.js`
- Modify: `src/auth.js`

**Steps:**
1. Test login with Kari profile + correct PIN sets both cookies.
2. Test kids profile + correct PIN sets active profile to the selected child.
3. Test wrong PIN returns 401 and does not set profile cookie.
4. Test Family/Justin fallback behavior if no profile PIN is configured.
5. Run: `node --test --test-concurrency=1 tests/profiles.test.js tests/deploy.test.js`.

### Task 3: Avatar API hardening

**Objective:** Make avatar storage safe enough for family use.

**Files:**
- Modify: `tests/profiles.test.js`
- Modify: `src/profiles.js`

**Steps:**
1. Test avatar update rejects non-string values.
2. Test avatar update rejects non-image data URLs.
3. Test avatar update rejects oversized payloads.
4. Test avatar remove with `null` clears avatar.
5. Consider rejecting `data:image/svg+xml` unless we sanitize; prefer PNG/JPEG/WebP/GIF initially.
6. Run profile tests.

### Task 4: Avatar upload UX polish

**Objective:** Make Settings avatar creation pleasant on mobile.

**Files:**
- Modify: `public/app.js`
- Modify: `public/styles.css`
- Modify: `tests/ui.test.js`

**Steps:**
1. Add client-side max-size check before upload.
2. Add upload progress/working state.
3. Add preview before save or immediate optimistic preview.
4. Add helper copy: “Square photos work best.”
5. If image is too large, show a clear message instead of `alert()`.
6. Add tests for durable selectors: `.settings-profiles-grid`, `.profile-avatar-upload`, `.settings-avatar-clear-btn`.

### Task 5: Chat/profile display polish

**Objective:** Make messages show real profile names/avatars, not just profile IDs/initials.

**Files:**
- Modify: `public/app.js`
- Modify: `tests/ui.test.js`

**Steps:**
1. Load profile metadata once into a map.
2. Render chat avatars using uploaded avatar when available.
3. Render display names as “Kari”, “Hudson”, etc.
4. Keep fallback colored initials.
5. Run UI tests and manually smoke `/chat`.

### Task 6: PWA/cache and deployment verification

**Objective:** Avoid stale CSS/JS issues after login/profile changes.

**Files:**
- Modify: `public/index.html`
- Modify: `public/service-worker.js`
- Modify: `tests/ui.test.js`

**Steps:**
1. Bump app asset version and service-worker cache together.
2. Verify live `/styles.css?v=<new>` returns `text/css`.
3. Verify protected `/chat` redirects to styled login when unauthenticated.
4. Login as Kari and verify authenticated `/chat` loads CSS and has no console errors.
5. Run `npm test` and `npm audit --omit=dev --audit-level=moderate`.
6. Deploy to Vercel and smoke test production.
7. Sync/restart local Beelink.

---

## CSS Bug Investigation Notes

Reported: `https://todo-five-kohl-26.vercel.app/chat` loads without CSS.

Current verification:

- Unauthenticated `/chat` redirects to `/login?next=%2Fchat`.
- The login/profile picker uses inline CSS and intentionally does not load `styles.css`.
- Authenticated `/chat` loads `https://todo-five-kohl-26.vercel.app/styles.css?v=hub-pwa-14` successfully.
- Browser inspection showed the stylesheet had CSS rules and no JS console errors.

Likely causes if the user still sees no styling:

1. Stale service-worker cache on that browser/device.
2. Viewing the login/profile picker and expecting the main app stylesheet link.
3. A transient deploy/cache mismatch between `hub-pwa-14` and old cached app shell.

Recommended next fix if reproducible on the user's device:

- Bump to `hub-pwa-15` / `todo-hub-v15`.
- Add a login-page external stylesheet or shared CSS link if we want login to use the same CSS pipeline.
- Add a small debug footer/comment on login with asset version for cache diagnosis.

---

## Security Notes

- Do not commit or repeat concrete PIN values in docs/summaries.
- Profile PINs are convenience controls, not bank-grade auth.
- Profile visibility is not authorization unless server-side role checks are added.
- Avatar data URLs should remain size/type constrained.
- Keep session cookies HttpOnly and signed.

## Verification Commands

```bash
node --test --test-concurrency=1 tests/profiles.test.js tests/deploy.test.js tests/ui.test.js
npm test
npm audit --omit=dev --audit-level=moderate
node --check src/auth.js
node --check src/profiles.js
node --check public/app.js
```
