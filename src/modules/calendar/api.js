import { calendarEvents } from './data.js';

export function registerCalendarRoutes(app) {
  app.get('/api/calendar', async (_req, res, next) => {
    try {
      res.json(await calendarEvents({ respectEnabled: false, includeCalendars: true }));
    } catch (err) {
      next(err);
    }
  });
}
