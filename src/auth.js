import { createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { listProfiles, findProfile, profileCookieValue, PROFILE_COOKIE, PROFILE_MAX_AGE } from './profiles.js';

const COOKIE_NAME = 'todo_session';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 5;
const loginFailures = new Map();

function clientKey(req) {
  return String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || req.socket?.remoteAddress || 'unknown';
}

function loginFailure(req) {
  const key = clientKey(req);
  const now = Date.now();
  const current = loginFailures.get(key);
  const next = !current || current.resetAt < now
    ? { count: 1, resetAt: now + LOGIN_WINDOW_MS }
    : { count: current.count + 1, resetAt: current.resetAt };
  loginFailures.set(key, next);
}

function loginLimited(req) {
  const entry = loginFailures.get(clientKey(req));
  if (!entry) return false;
  if (entry.resetAt < Date.now()) { loginFailures.delete(clientKey(req)); return false; }
  return entry.count >= LOGIN_MAX_FAILURES;
}

function clearLoginFailures(req) {
  loginFailures.delete(clientKey(req));
}

function authEnabled() {
  return Boolean(process.env.HOUSEHOLD_PIN || process.env.HOUSEHOLD_PASSWORD);
}

function credential() {
  return process.env.HOUSEHOLD_PIN || process.env.HOUSEHOLD_PASSWORD || '';
}

function secret() {
  return process.env.AUTH_SECRET || credential() || 'local-dev-secret';
}

function sign(value) {
  return createHmac('sha256', secret()).update(value).digest('base64url');
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function hashPin(pin) {
  return createHash('sha256').update(String(pin)).digest('hex');
}

function parseCookies(req) {
  return Object.fromEntries(String(req.headers.cookie || '').split(';').map(part => part.trim()).filter(Boolean).map(part => {
    const index = part.indexOf('=');
    return index === -1 ? [part, ''] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
  }));
}

function makeSessionCookie() {
  const issuedAt = Date.now();
  const nonce = randomBytes(12).toString('base64url');
  const payload = `${issuedAt}.${nonce}`;
  return `${payload}.${sign(payload)}`;
}

function verifySessionCookie(value) {
  if (!value) return false;
  const parts = String(value).split('.');
  if (parts.length !== 3) return false;
  const [issuedAt, nonce, signature] = parts;
  const issuedMs = Number(issuedAt);
  if (!Number.isFinite(issuedMs)) return false;
  if (Date.now() - issuedMs > MAX_AGE_SECONDS * 1000) return false;
  return safeEqual(signature, sign(`${issuedAt}.${nonce}`));
}

function hasSession(req) {
  if (!authEnabled()) return true;
  return verifySessionCookie(parseCookies(req)[COOKIE_NAME]);
}

function hasApiToken(req) {
  const token = process.env.HOUSEHOLD_API_TOKEN;
  if (!token) return false;
  const supplied = req.get('x-todo-token') || req.query.token;
  return supplied ? safeEqual(supplied, token) : false;
}

function hasEinkToken(req) {
  const token = process.env.EINK_API_TOKEN || process.env.HOUSEHOLD_API_TOKEN;
  if (!token) return false;
  const supplied = req.get('x-eink-token') || req.get('x-todo-token') || req.query.token;
  return supplied ? safeEqual(supplied, token) : false;
}

export function isHouseholdAuthed(req) {
  return hasSession(req) || hasApiToken(req);
}

export function requireHouseholdAuth(req, res, next) {
  if (!authEnabled() || isHouseholdAuthed(req)) return next();
  res.status(401).json({ error: 'Authentication required' });
}

export function requirePageAuth(req, res, next) {
  if (!authEnabled() || hasSession(req)) return next();
  res.redirect(`/login?next=${encodeURIComponent(req.originalUrl || '/home')}`);
}

export function requireEinkAuth(req, res, next) {
  if (!authEnabled() || hasSession(req) || hasEinkToken(req)) return next();
  res.status(401).json({ error: 'E-ink token required' });
}

export function authStatus(_req, res) {
  res.json({ enabled: authEnabled(), authenticated: !authEnabled() || hasSession(_req) });
}

export async function loginPage(_req, res) {
  const profiles = await listProfiles();
  const safeProfiles = profiles.map(p => ({
    id: p.id,
    name: p.name,
    color: p.color,
    avatar: p.avatar || null,
    hasPin: Boolean(p.pinHash) || (p.id === 'family' && authEnabled()),
  }));
  const profilesJson = JSON.stringify(safeProfiles).replace(/<\/script>/gi, '<\\/script>');

  res.type('html').send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Household Hub</title>
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      min-height: 100vh;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, sans-serif;
      background: #111;
      color: #fff;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 40px 16px;
    }
    h1 { font-size: 26px; font-weight: 700; letter-spacing: -.04em; color: #ffd60a; margin-bottom: 40px; }
    .profile-grid { display: flex; flex-wrap: wrap; gap: 28px; justify-content: center; max-width: 560px; }
    .profile-card {
      display: flex; flex-direction: column; align-items: center; gap: 12px;
      background: none; border: none; cursor: pointer; padding: 10px 14px;
      border-radius: 18px; transition: background .15s, transform .15s; min-width: 90px;
    }
    .profile-card:hover { background: rgba(255,255,255,.07); transform: scale(1.04); }
    .profile-card:focus-visible { outline: 2px solid #ffd60a; outline-offset: 4px; border-radius: 18px; }
    .profile-avatar-wrap {
      width: 88px; height: 88px; border-radius: 50%; overflow: hidden;
      border: 3px solid rgba(255,255,255,.1); transition: border-color .15s;
    }
    .profile-card:hover .profile-avatar-wrap { border-color: rgba(255,255,255,.6); }
    .profile-avatar-inner {
      width: 100%; height: 100%;
      display: flex; align-items: center; justify-content: center;
      font-size: 34px; font-weight: 800; color: #111; line-height: 1;
    }
    .profile-avatar-inner img { width: 100%; height: 100%; object-fit: cover; border-radius: 50%; }
    .profile-name { font-size: 14px; font-weight: 500; color: #bbb; transition: color .15s; }
    .profile-card:hover .profile-name { color: #fff; }

    /* PIN overlay */
    .pin-overlay {
      position: fixed; inset: 0; background: rgba(0,0,0,.88);
      display: none; align-items: center; justify-content: center; z-index: 100;
    }
    .pin-overlay.active { display: flex; }
    .pin-card {
      background: #1c1c1c; border: 1px solid #2e2e2e; border-radius: 28px;
      padding: 36px 28px; display: flex; flex-direction: column; align-items: center;
      gap: 22px; width: min(360px, calc(100vw - 32px)); box-shadow: 0 32px 80px rgba(0,0,0,.6);
    }
    .pin-profile-avatar { width: 72px; height: 72px; border-radius: 50%; overflow: hidden; border: 3px solid rgba(255,255,255,.15); }
    .pin-profile-name { font-size: 20px; font-weight: 700; }
    .pin-hint { font-size: 13px; color: #888; }
    .pin-dots { display: flex; gap: 18px; }
    .pin-dot {
      width: 15px; height: 15px; border-radius: 50%;
      border: 2px solid #444; background: transparent; transition: background .1s, border-color .1s;
    }
    .pin-dot.filled { background: #ffd60a; border-color: #ffd60a; }
    .pin-input { position: absolute; opacity: 0; width: 1px; height: 1px; }
    .pin-error { color: #ff9f9f; font-size: 13px; min-height: 1.3em; text-align: center; }
    .pin-back-btn { background: none; border: none; color: #666; font: inherit; font-size: 13px; cursor: pointer; padding: 4px 8px; border-radius: 8px; }
    .pin-back-btn:hover { color: #aaa; background: rgba(255,255,255,.06); }
  </style>
</head>
<body>
  <h1>Household Hub</h1>
  <div class="profile-grid" id="profile-grid"></div>

  <div class="pin-overlay" id="pin-overlay">
    <div class="pin-card">
      <div class="pin-profile-avatar" id="pin-avatar"></div>
      <span class="pin-profile-name" id="pin-name"></span>
      <span class="pin-hint">Enter PIN</span>
      <div class="pin-dots">
        <div class="pin-dot" id="d0"></div>
        <div class="pin-dot" id="d1"></div>
        <div class="pin-dot" id="d2"></div>
        <div class="pin-dot" id="d3"></div>
      </div>
      <input class="pin-input" id="pin-input" type="password" inputmode="numeric" maxlength="4" pattern="[0-9]*" autocomplete="off" />
      <p class="pin-error" id="pin-error"></p>
      <button class="pin-back-btn" id="pin-back">← Back</button>
    </div>
  </div>

  <script>
    const PROFILES = ${profilesJson};
    const params = new URLSearchParams(location.search);
    const rawNext = params.get('next') || '/home';
    const next = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/home';
    let active = null;

    function avatarHtml(p, size) {
      const s = size || 34;
      if (p.avatar) return '<img src="' + p.avatar + '" alt="' + p.name + '">';
      return '<span style="font-size:' + s + 'px;font-weight:800;color:#111">' + p.name[0].toUpperCase() + '</span>';
    }

    function buildGrid() {
      const grid = document.getElementById('profile-grid');
      grid.innerHTML = PROFILES.map(p =>
        '<button class="profile-card" data-id="' + p.id + '" aria-label="' + p.name + '">' +
          '<div class="profile-avatar-wrap">' +
            '<div class="profile-avatar-inner" style="background:' + p.color + '">' + avatarHtml(p) + '</div>' +
          '</div>' +
          '<span class="profile-name">' + p.name + '</span>' +
        '</button>'
      ).join('');
      grid.querySelectorAll('.profile-card').forEach(btn => {
        btn.addEventListener('click', () => {
          const p = PROFILES.find(x => x.id === btn.dataset.id);
          if (!p) return;
          if (p.hasPin) { openPin(p); } else { doLogin(p.id, null); }
        });
      });
    }

    function openPin(p) {
      active = p;
      const av = document.getElementById('pin-avatar');
      av.style.background = p.color;
      av.innerHTML = '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center">' + avatarHtml(p, 28) + '</div>';
      document.getElementById('pin-name').textContent = p.name;
      document.getElementById('pin-error').textContent = '';
      document.getElementById('pin-overlay').classList.add('active');
      const inp = document.getElementById('pin-input');
      inp.value = '';
      updateDots(0);
      setTimeout(() => inp.focus(), 80);
    }

    function updateDots(n) {
      for (let i = 0; i < 4; i++) document.getElementById('d' + i).className = 'pin-dot' + (i < n ? ' filled' : '');
    }

    document.getElementById('pin-input').addEventListener('input', async function() {
      const val = this.value.replace(/[^0-9]/g, '').slice(0, 4);
      this.value = val;
      updateDots(val.length);
      if (val.length === 4) await doLogin(active.id, val);
    });

    document.getElementById('pin-back').addEventListener('click', () => {
      document.getElementById('pin-overlay').classList.remove('active');
      active = null;
    });

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') { document.getElementById('pin-overlay').classList.remove('active'); active = null; }
    });

    async function doLogin(profileId, pin) {
      try {
        const body = { profileId };
        if (pin) body.pin = pin;
        const res = await fetch('/api/auth/profile-login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (res.ok) { location.href = next; return; }
        const data = await res.json().catch(() => ({}));
        document.getElementById('pin-error').textContent = data.error || 'Incorrect PIN';
        document.getElementById('pin-input').value = '';
        updateDots(0);
        document.getElementById('pin-input').focus();
      } catch {
        document.getElementById('pin-error').textContent = 'Something went wrong. Try again.';
      }
    }

    buildGrid();
  </script>
</body>
</html>`);
}

export function login(req, res) {
  if (!authEnabled()) return res.json({ ok: true, enabled: false });
  if (loginLimited(req)) return res.status(429).json({ error: 'Too many PIN attempts. Try again later.' });
  const supplied = req.body?.pin || req.body?.password || '';
  if (!safeEqual(supplied, credential())) {
    loginFailure(req);
    return res.status(401).json({ error: 'Invalid PIN' });
  }
  clearLoginFailures(req);
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${encodeURIComponent(makeSessionCookie())}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_SECONDS}${secure}`);
  res.json({ ok: true });
}

export async function profileLogin(req, res) {
  if (loginLimited(req)) return res.status(429).json({ error: 'Too many attempts. Try again later.' });
  const { profileId, pin } = req.body || {};
  const profile = await findProfile(profileId);
  if (!profile) return res.status(400).json({ error: 'Unknown profile' });

  // Determine required PIN hash
  let requiredHash = profile.pinHash || null;
  // Family with no pinHash: use HOUSEHOLD_PASSWORD as PIN if auth is enabled
  if (profile.id === 'family' && !requiredHash && authEnabled()) {
    requiredHash = hashPin(credential());
  }

  if (requiredHash) {
    if (!pin) return res.status(401).json({ error: 'PIN required' });
    if (!safeEqual(hashPin(String(pin)), requiredHash)) {
      loginFailure(req);
      return res.status(401).json({ error: 'Incorrect PIN' });
    }
  }

  clearLoginFailures(req);
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', [
    `${COOKIE_NAME}=${encodeURIComponent(makeSessionCookie())}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_SECONDS}${secure}`,
    `${PROFILE_COOKIE}=${encodeURIComponent(profileCookieValue(profile.id))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${PROFILE_MAX_AGE}${secure}`,
  ]);
  res.json({ ok: true, profile: { id: profile.id, name: profile.name, color: profile.color } });
}

export function logout(_req, res) {
  res.setHeader('Set-Cookie', [
    `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
    `${PROFILE_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
  ]);
  res.json({ ok: true });
}
