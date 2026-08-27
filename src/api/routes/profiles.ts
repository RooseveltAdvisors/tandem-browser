import type { Request, Response, Router } from 'express';
import { BrowserProfileError } from '../../profiles/types';
import type { RouteContext } from '../context';

/** Expose metadata-only Chrome profile discovery and selection preflight. */
export function registerProfileRoutes(router: Router, ctx: RouteContext): void {
  router.get('/profiles', (_req: Request, res: Response) => {
    try {
      res.json({ ok: true, ...ctx.profileManager.inspect() });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.post('/profiles/select', (req: Request, res: Response) => {
    const name = req.body?.name;
    if (typeof name !== 'string') {
      res.status(400).json({ error: 'name must be a string', code: 'invalid-profile-name' });
      return;
    }

    try {
      res.json({ ok: true, selection: ctx.profileManager.select(name) });
    } catch (error) {
      if (error instanceof BrowserProfileError) {
        const status = error.code === 'profiles-unavailable' ? 503 : error.code === 'profile-not-found' ? 404 : 400;
        res.status(status).json({ error: error.message, code: error.code });
        return;
      }
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}
