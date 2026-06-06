import express from 'express';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { einkToday } from './modules/tasks/data.js';
import { runTodoCommand } from './discordParser.js';
import { alexaRoute } from './alexa.js';
import { einkDashboard } from './einkDashboard.js';
import { authStatus, login, loginPage, logout, profileLogin, requireEinkAuth, requireHouseholdAuth, requirePageAuth } from './auth.js';
import { registerCalendarRoutes } from './modules/calendar/api.js';
import { registerDocumentRoutes } from './modules/documents/api.js';
import { registerTipsRoutes } from './modules/tips/api.js';
import { registerChatRoutes } from './modules/chat/api.js';
import { registerGroceryRoutes } from './modules/grocery/api.js';
import { registerTaskRoutes } from './modules/tasks/api.js';
import { appPageRoutes } from './modules/registry.js';
import { registerProfileRoutes } from './profiles.js';

export function createApp() {
  const app = express();
  app.use(express.json());
  app.use(express.static('public', { index: false }));

  const indexHtml = fileURLToPath(new URL('../public/index.html', import.meta.url));
  const page = () => (_req, res) => res.sendFile(indexHtml);
  app.get('/', requirePageAuth, (_req, res) => res.redirect('/home'));
  app.get('/login', loginPage);
  app.get(appPageRoutes, requirePageAuth, page());

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.get('/api/auth/status', authStatus);
  app.post('/api/auth/login', login);
  app.post('/api/auth/profile-login', profileLogin);
  app.post('/api/auth/logout', logout);

  app.use('/api/eink', requireEinkAuth);
  app.use('/api', (req, res, next) => {
    if (req.path === '/alexa') return next();
    if (req.path.startsWith('/auth/')) return next();
    if (req.path.startsWith('/eink/')) return next();
    return requireHouseholdAuth(req, res, next);
  });

  registerProfileRoutes(app);
  registerTaskRoutes(app);
  registerCalendarRoutes(app);
  registerDocumentRoutes(app);
  registerGroceryRoutes(app);
  registerTipsRoutes(app);
  registerChatRoutes(app);

  app.get('/api/eink/today', async (_req, res, next) => {
    try { res.json(await einkToday()); } catch (err) { next(err); }
  });

  app.get('/api/eink/dashboard', async (_req, res, next) => {
    try { res.json(await einkDashboard()); } catch (err) { next(err); }
  });

  app.get('/api/eink/today.svg', async (_req, res, next) => {
    try {
      const data = await einkToday();
      const lines = [data.title.toUpperCase(), ...data.tasks.map(t => `□ ${t}`), ...(data.waiting.length ? ['', 'WAITING', ...data.waiting.map(t => `• ${t}`)] : [])];
      const safe = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
      const text = lines.map((line, i) => `<text x="48" y="${70 + i * 42}" class="${i === 0 || line === 'WAITING' ? 'heading' : 'item'}">${safe(line)}</text>`).join('\n');
      res.type('image/svg+xml').send(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="480" viewBox="0 0 800 480"><style>rect{fill:#fff}.heading{font:bold 38px sans-serif}.item{font:30px sans-serif}</style><rect width="800" height="480"/>${text}</svg>`);
    } catch (err) { next(err); }
  });

  app.post('/api/discord/command', async (req, res, next) => {
    try { res.json(await runTodoCommand(req.body.command)); } catch (err) { next(err); }
  });

  app.post('/api/alexa', alexaRoute);

  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ error: err.message || 'Server error' });
  });

  return app;
}

const app = createApp();
export default app;

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT || 3456);
  createApp().listen(port, () => console.log(`todo listening on http://localhost:${port}`));
}
