import { createGroceryItem, listGroceryItems, listRecentGroceryItems, readdGroceryItem, updateGroceryItem, clearCheckedGroceryItems, deleteGroceryItem, quickAdd, normalizeAllGroceryItems, deleteGroceryHistory } from './data.js';
import { readStore } from '../../db.js';

export function registerGroceryRoutes(app) {
  app.get('/api/grocery', async (req, res, next) => {
    try { res.json({ items: await listGroceryItems(req.query) }); } catch (err) { next(err); }
  });

  app.get('/api/grocery/recent', async (req, res, next) => {
    try { res.json({ items: await listRecentGroceryItems(req.query.limit) }); } catch (err) { next(err); }
  });

  app.post('/api/grocery', async (req, res, next) => {
    try { res.status(201).json({ item: await createGroceryItem(req.body) }); } catch (err) { next(err); }
  });

  app.patch('/api/grocery/:id', async (req, res, next) => {
    try { res.json({ item: await updateGroceryItem(req.params.id, req.body) }); } catch (err) { next(err); }
  });

  app.delete('/api/grocery/:id', async (req, res, next) => {
    try { res.json(await deleteGroceryItem(req.params.id)); } catch (err) { next(err); }
  });

  app.post('/api/grocery/:id/readd', async (req, res, next) => {
    try { res.status(201).json({ item: await readdGroceryItem(req.params.id) }); } catch (err) { next(err); }
  });

  app.post('/api/grocery/clear-checked', async (_req, res, next) => {
    try { res.json(await clearCheckedGroceryItems()); } catch (err) { next(err); }
  });

  app.post('/api/grocery/normalize-all', async (_req, res) => {
    try {
      res.json(await normalizeAllGroceryItems());
    } catch (err) {
      console.error('[normalize-all]', err?.message, err?.stack?.split('\n')[1]);
      res.status(500).json({ error: err?.message || String(err) });
    }
  });

  app.delete('/api/grocery/history', async (req, res, next) => {
    try { res.json(await deleteGroceryHistory(req.query.title)); } catch (err) { next(err); }
  });

  app.get('/api/grocery/suggest', async (req, res, next) => {
    try {
      const q = String(req.query.q || '').trim().toLowerCase();
      if (q.length < 2) return res.json({ suggestions: [] });
      const store = await readStore();
      const seen = new Map();
      for (const item of (store.groceryItems || [])) {
        if (!item.title?.toLowerCase().includes(q)) continue;
        const key = item.title.toLowerCase();
        const existing = seen.get(key);
        if (!existing || (item.checkedAt || '') > (existing.checkedAt || '')) seen.set(key, item);
      }
      const suggestions = [...seen.values()]
        .sort((a, b) => (b.checkedAt || '').localeCompare(a.checkedAt || ''))
        .slice(0, 8)
        .map(i => ({ title: i.title, category: i.category, store: i.store || 'walmart' }));
      res.json({ suggestions });
    } catch (err) { next(err); }
  });

  app.post('/api/quick-add', async (req, res, next) => {
    try { res.status(201).json(await quickAdd(req.body.text, req.body)); } catch (err) { next(err); }
  });
}
