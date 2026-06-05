import { createTipEntry, listTipEntries, updateTipEntry, deleteTipEntry, getTipSummary, exportTipsCsv, getTipBreakdown } from './data.js';

export function registerTipsRoutes(app) {
  app.get('/api/tips/summary', async (_req, res, next) => {
    try { res.json(await getTipSummary()); } catch (err) { next(err); }
  });

  app.get('/api/tips/breakdown', async (_req, res, next) => {
    try { res.json(await getTipBreakdown()); } catch (err) { next(err); }
  });

  app.get('/api/tips/export.csv', async (_req, res, next) => {
    try {
      const csv = await exportTipsCsv();
      res.type('text/csv').setHeader('Content-Disposition', 'attachment; filename="tips-export.csv"').send(csv);
    } catch (err) { next(err); }
  });

  app.get('/api/tips', async (req, res, next) => {
    try { res.json({ entries: await listTipEntries(req.query) }); } catch (err) { next(err); }
  });

  app.post('/api/tips', async (req, res, next) => {
    try { res.status(201).json({ entry: await createTipEntry(req.body) }); } catch (err) { next(err); }
  });

  app.patch('/api/tips/:id', async (req, res, next) => {
    try { res.json({ entry: await updateTipEntry(req.params.id, req.body) }); } catch (err) { next(err); }
  });

  app.delete('/api/tips/:id', async (req, res, next) => {
    try { res.json(await deleteTipEntry(req.params.id)); } catch (err) { next(err); }
  });
}
