import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

vi.mock('electron', () => ({
  BrowserWindow: vi.fn(),
  session: {},
  webContents: { fromId: vi.fn(), getAllWebContents: vi.fn().mockReturnValue([]) },
}));

import { registerProfileRoutes } from '../../routes/profiles';
import { createMockContext, createTestApp } from '../helpers';
import type { RouteContext } from '../../context';
import { BrowserProfileError } from '../../../profiles/types';

describe('Profile routes', () => {
  let ctx: RouteContext;
  let app: ReturnType<typeof createTestApp>;

  beforeEach(() => {
    ctx = createMockContext();
    app = createTestApp(registerProfileRoutes, ctx);
  });

  it('returns metadata-only discovery and control boundary status', async () => {
    vi.mocked(ctx.profileManager.inspect).mockReturnValue({
      available: true,
      chromeUserDataPath: '/profiles',
      profiles: [{
        name: 'Arcs',
        directory: 'Profile 1',
        profilePath: '/profiles/Profile 1',
        metadataSource: 'local-state',
        metadataFiles: { localState: true, preferences: true },
      }],
      control: { available: false, reason: 'Electron boundary' },
    });

    const response = await request(app).get('/profiles');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ok: true,
      profiles: [{ name: 'Arcs', directory: 'Profile 1' }],
      control: { available: false },
    });
    expect(JSON.stringify(response.body)).not.toContain('cookie');
  });

  it('returns exact selection proof for a discovered profile', async () => {
    vi.mocked(ctx.profileManager.select).mockReturnValue({
      requestedName: 'RA',
      profile: {
        name: 'RA',
        directory: 'Default',
        profilePath: '/profiles/Default',
        metadataSource: 'local-state',
        metadataFiles: { localState: true, preferences: true },
      },
      control: { available: false, reason: 'Electron boundary' },
      proof: { matchedBy: 'local-state', profileName: 'RA', profileDirectory: 'Default', profilePath: '/profiles/Default' },
    });

    const response = await request(app).post('/profiles/select').send({ name: 'RA' });

    expect(response.status).toBe(200);
    expect(response.body.selection.proof).toMatchObject({ profileName: 'RA', profileDirectory: 'Default' });
    expect(response.body.selection.control.available).toBe(false);
  });

  it('rejects an unavailable or incorrect profile', async () => {
    const error = new BrowserProfileError('profile-not-found', 'Chrome profile \'JR\' was not found');
    vi.mocked(ctx.profileManager.select).mockImplementation(() => { throw error; });

    const response = await request(app).post('/profiles/select').send({ name: 'JR' });

    expect(response.status).toBe(404);
    expect(response.body.error).toContain('not found');
  });
});
