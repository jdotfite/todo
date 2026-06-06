import { createWorkEntry, listWorkEntries, updateWorkEntry, deleteWorkEntry, getWorkSummary, getWorkBreakdown, exportWorkCsv, getWorkSettings, updateWorkSettings, dryRunWorkImport, listWorkImportBatches, getWorkImportBatch, updateWorkImportRow, commitWorkImportBatch } from './data.js';

export function registerWorkRoutes(app) {
  app.get('/api/work/settings', async (_req, res, next) => {
    try { res.json({ settings: await getWorkSettings() }); } catch (err) { next(err); }
  });

  app.patch('/api/work/settings', async (req, res, next) => {
    try { res.json({ settings: await updateWorkSettings(req.body) }); } catch (err) { next(err); }
  });

  app.get('/api/work/summary', async (req, res, next) => {
    try { res.json(await getWorkSummary(req.query)); } catch (err) { next(err); }
  });

  app.get('/api/work/breakdown', async (_req, res, next) => {
    try { res.json(await getWorkBreakdown()); } catch (err) { next(err); }
  });

  app.get('/api/work/export.csv', async (_req, res, next) => {
    try {
      const csv = await exportWorkCsv();
      res.type('text/csv').setHeader('Content-Disposition', 'attachment; filename="work-export.csv"').send(csv);
    } catch (err) { next(err); }
  });

  app.get('/api/work/import/batches', async (_req, res, next) => {
    try { res.json({ batches: await listWorkImportBatches() }); } catch (err) { next(err); }
  });

  app.post('/api/work/import/dry-run', async (req, res, next) => {
    try { res.status(201).json({ batch: await dryRunWorkImport(req.body?.paths) }); } catch (err) { next(err); }
  });

  app.get('/api/work/import/batches/:batchId', async (req, res, next) => {
    try { res.json({ batch: await getWorkImportBatch(req.params.batchId) }); } catch (err) { next(err); }
  });

  app.patch('/api/work/import/batches/:batchId/rows/:rowId', async (req, res, next) => {
    try { res.json({ batch: await updateWorkImportRow(req.params.batchId, req.params.rowId, req.body) }); } catch (err) { next(err); }
  });

  app.post('/api/work/import/batches/:batchId/commit', async (req, res, next) => {
    try { res.json(await commitWorkImportBatch(req.params.batchId, req.body || {})); } catch (err) { next(err); }
  });

  app.get('/api/work', async (req, res, next) => {
    try { res.json({ entries: await listWorkEntries(req.query) }); } catch (err) { next(err); }
  });

  app.post('/api/work', async (req, res, next) => {
    try { res.status(201).json({ entry: await createWorkEntry(req.body) }); } catch (err) { next(err); }
  });

  app.patch('/api/work/:id', async (req, res, next) => {
    try { res.json({ entry: await updateWorkEntry(req.params.id, req.body) }); } catch (err) { next(err); }
  });

  app.delete('/api/work/:id', async (req, res, next) => {
    try { res.json(await deleteWorkEntry(req.params.id)); } catch (err) { next(err); }
  });
}
