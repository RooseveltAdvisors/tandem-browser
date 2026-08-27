import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { BrowserProfileError } from '../types';
import { BrowserProfileManager } from '../manager';

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function createChromeFixture(infoCache: Record<string, { name: string }>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-profiles-'));
  temporaryRoots.push(root);
  fs.writeFileSync(path.join(root, 'Local State'), JSON.stringify({ profile: { info_cache: infoCache } }));
  for (const [directory, metadata] of Object.entries(infoCache)) {
    const profilePath = path.join(root, directory);
    fs.mkdirSync(profilePath, { recursive: true });
    fs.writeFileSync(path.join(profilePath, 'Preferences'), JSON.stringify({ profile: metadata }));
  }
  return root;
}

describe('BrowserProfileManager', () => {
  it('discovers named profiles from Chromium identity metadata', () => {
    const root = createChromeFixture({
      Default: { name: 'RA' },
      'Profile 1': { name: 'Arcs' },
      'Profile 2': { name: 'JR' },
    });

    const result = new BrowserProfileManager({ chromeUserDataPath: root }).inspect();

    expect(result.available).toBe(true);
    expect(result.profiles.map((profile) => profile.name)).toEqual(['Arcs', 'JR', 'RA']);
    expect(result.profiles.find((profile) => profile.name === 'Arcs')).toMatchObject({
      directory: 'Profile 1',
      metadataSource: 'local-state',
      metadataFiles: { localState: true, preferences: true },
    });
  });

  it('selects by exact name and proves the actual profile directory', () => {
    const root = createChromeFixture({ 'Profile 1': { name: 'Arcs' } });

    const result = new BrowserProfileManager({ chromeUserDataPath: root }).select('Arcs');

    expect(result.requestedName).toBe('Arcs');
    expect(result.proof).toEqual({
      matchedBy: 'local-state',
      profileName: 'Arcs',
      profileDirectory: 'Profile 1',
      profilePath: path.join(root, 'Profile 1'),
    });
    expect(result.control.available).toBe(false);
  });

  it('rejects an incorrect or ambiguous profile name', () => {
    const root = createChromeFixture({
      Default: { name: 'RA' },
      'Profile 1': { name: 'RA' },
    });
    const manager = new BrowserProfileManager({ chromeUserDataPath: root });

    expect(() => manager.select('ra')).toThrowError(BrowserProfileError);
    expect(() => manager.select('RA')).toThrowError(/ambiguous/);
  });

  it('ignores profile cache entries that are not real directories inside the root', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-profiles-'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-profile-outside-'));
    temporaryRoots.push(root, outside);
    fs.writeFileSync(path.join(root, 'Local State'), JSON.stringify({
      profile: {
        info_cache: {
          'Profile 1': { name: 'File profile' },
          'Profile 2': { name: 'Symlink profile' },
        },
      },
    }));
    fs.writeFileSync(path.join(root, 'Profile 1'), 'not a profile directory');
    fs.mkdirSync(path.join(outside, 'Profile 2'));
    fs.writeFileSync(path.join(outside, 'Profile 2', 'Preferences'), JSON.stringify({ profile: { name: 'Outside' } }));
    fs.symlinkSync(path.join(outside, 'Profile 2'), path.join(root, 'Profile 2'), 'dir');

    const profiles = new BrowserProfileManager({ chromeUserDataPath: root }).list();

    expect(profiles).toEqual([]);
  });

  it('reports unavailable profile storage without creating it', () => {
    const root = path.join(os.tmpdir(), `tandem-profiles-missing-${Date.now()}`);
    const manager = new BrowserProfileManager({ chromeUserDataPath: root });

    expect(manager.inspect()).toMatchObject({ available: false, profiles: [], chromeUserDataPath: root });
    expect(() => manager.select('RA')).toThrowError(/unavailable/);
    expect(fs.existsSync(root)).toBe(false);
  });
});
