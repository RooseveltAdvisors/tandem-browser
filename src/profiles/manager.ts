import fs from 'fs';
import path from 'path';
import { selectPlatform } from '../platform';
import { createLogger } from '../utils/logger';
import {
  BrowserProfileError,
  type BrowserProfile,
  type ProfileDiscoveryResult,
  type ProfileSelectionResult,
  type ProfileControlStatus,
} from './types';

const log = createLogger('BrowserProfileManager');
const PROFILE_DIRECTORY_PATTERN = /^(Default|Profile \d+)$/;
const CONTROL_STATUS: ProfileControlStatus = Object.freeze({
  available: false,
  reason: 'Electron webviews use Tandem-owned sessions and cannot attach to an existing Chrome profile without sharing and mutating its user-data directory.',
});

interface ProfileInfoCacheEntry {
  name?: unknown;
}

interface ProfileManagerOptions {
  chromeUserDataPath?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Discovers existing Chrome profiles using metadata only.
 *
 * This manager deliberately does not open or copy cookies, history, local
 * storage, passwords, or page data. Selection is an inspectable preflight
 * result until Tandem has a safe native boundary for controlling Chrome's
 * existing profile storage.
 */
export class BrowserProfileManager {
  private readonly chromeUserDataPath: string | null;

  constructor(options: ProfileManagerOptions = {}) {
    const configuredPath = options.chromeUserDataPath ?? selectPlatform().chromeImport.getDefaultChromeBasePath();
    this.chromeUserDataPath = configuredPath.trim() ? path.resolve(configuredPath) : null;
  }

  /** Return a metadata-only view of profiles and the current control boundary. */
  inspect(): ProfileDiscoveryResult {
    const profiles = this.list();
    return {
      available: this.getChromeRootPath() !== null,
      chromeUserDataPath: this.chromeUserDataPath,
      profiles,
      control: CONTROL_STATUS,
    };
  }

  /** List profiles whose directories and identity metadata are present. */
  list(): BrowserProfile[] {
    const chromeRootPath = this.getChromeRootPath();
    if (!chromeRootPath) return [];

    const localState = this.readLocalState();
    const profileInfoCache = this.getProfileInfoCache(localState);
    const candidateDirectories = new Set<string>();

    for (const directory of Object.keys(profileInfoCache)) {
      if (PROFILE_DIRECTORY_PATTERN.test(directory) && this.resolveProfilePath(directory)) {
        candidateDirectories.add(directory);
      }
    }

    try {
      for (const entry of fs.readdirSync(chromeRootPath, { withFileTypes: true })) {
        if (entry.isDirectory() && PROFILE_DIRECTORY_PATTERN.test(entry.name)) {
          candidateDirectories.add(entry.name);
        }
      }
    } catch (error) {
      log.warn('Could not scan Chrome user-data directory:', error instanceof Error ? error.message : String(error));
      return [];
    }

    return Array.from(candidateDirectories)
      .map((directory) => this.readProfile(directory, profileInfoCache[directory], localState !== null))
      .filter((profile): profile is BrowserProfile => profile !== null)
      .sort((left, right) => left.name.localeCompare(right.name) || left.directory.localeCompare(right.directory));
  }

  /** Resolve an exact profile name to its actual profile directory. */
  select(name: string): ProfileSelectionResult {
    if (!name || name.trim() !== name) {
      throw new BrowserProfileError('invalid-profile-name', 'Profile name must be a non-empty exact string');
    }

    if (!this.getChromeRootPath()) {
      throw new BrowserProfileError('profiles-unavailable', 'Chrome user-data directory is unavailable');
    }

    const matches = this.list().filter((profile) => profile.name === name);
    if (matches.length === 0) {
      throw new BrowserProfileError('profile-not-found', `Chrome profile '${name}' was not found`);
    }
    if (matches.length > 1) {
      throw new BrowserProfileError('profile-name-ambiguous', `Chrome profile name '${name}' is ambiguous`);
    }

    const profile = matches[0];
    return {
      requestedName: name,
      profile,
      control: CONTROL_STATUS,
      proof: {
        matchedBy: profile.metadataSource,
        profileName: profile.name,
        profileDirectory: profile.directory,
        profilePath: profile.profilePath,
      },
    };
  }

  private readLocalState(): Record<string, unknown> | null {
    const chromeRootPath = this.getChromeRootPath();
    if (!chromeRootPath) return null;
    const localStatePath = this.getSafeMetadataPath(chromeRootPath, 'Local State');
    if (!localStatePath) return null;
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(localStatePath, 'utf8'));
      return isRecord(parsed) ? parsed : null;
    } catch (error) {
      log.warn('Could not read Chrome Local State metadata:', error instanceof Error ? error.message : String(error));
      return null;
    }
  }

  private getProfileInfoCache(localState: Record<string, unknown> | null): Record<string, ProfileInfoCacheEntry> {
    const rawCache = localState?.['profile'];
    if (!isRecord(rawCache) || !isRecord(rawCache['info_cache'])) return {};

    const cache: Record<string, ProfileInfoCacheEntry> = {};
    for (const [directory, value] of Object.entries(rawCache['info_cache'])) {
      if (isRecord(value)) cache[directory] = value;
    }
    return cache;
  }

  private readProfile(directory: string, cached: ProfileInfoCacheEntry | undefined, hasLocalState: boolean): BrowserProfile | null {
    const profilePath = this.resolveProfilePath(directory);
    if (!profilePath) return null;
    const chromeRootPath = this.getChromeRootPath();
    if (!chromeRootPath) return null;
    const preferencesPath = this.getSafeMetadataPath(profilePath, 'Preferences', chromeRootPath);
    const hasPreferences = preferencesPath !== null;
    let name = typeof cached?.name === 'string' && cached.name.trim() ? cached.name.trim() : '';
    let metadataSource: BrowserProfile['metadataSource'] = name ? 'local-state' : 'directory';

    if (!name && hasPreferences) {
      try {
        const preferences: unknown = JSON.parse(fs.readFileSync(preferencesPath, 'utf8'));
        const preferenceName = isRecord(preferences) && isRecord(preferences['profile'])
          ? preferences['profile']['name']
          : undefined;
        if (typeof preferenceName === 'string' && preferenceName.trim()) {
          name = preferenceName.trim();
          metadataSource = 'preferences';
        }
      } catch (error) {
        log.warn(`Could not read metadata for Chrome profile ${directory}:`, error instanceof Error ? error.message : String(error));
      }
    }

    if (!name) name = directory;
    return {
      name,
      directory,
      profilePath,
      metadataSource,
      metadataFiles: { localState: hasLocalState, preferences: hasPreferences },
    };
  }

  private resolveProfilePath(directory: string): string | null {
    if (!this.chromeUserDataPath || !PROFILE_DIRECTORY_PATTERN.test(directory)) return null;
    try {
      const root = this.getChromeRootPath();
      if (!root) return null;
      const profilePath = fs.realpathSync(path.join(root, directory));
      if (!this.isContainedPath(root, profilePath) || !fs.statSync(profilePath).isDirectory()) {
        return null;
      }
      return profilePath;
    } catch {
      return null;
    }
  }

  private getChromeRootPath(): string | null {
    if (!this.chromeUserDataPath) return null;
    try {
      const root = fs.realpathSync(this.chromeUserDataPath);
      return fs.statSync(root).isDirectory() ? root : null;
    } catch {
      return null;
    }
  }

  private getSafeMetadataPath(
    parentPath: string,
    fileName: string,
    chromeRootPath = parentPath,
  ): string | null {
    try {
      const metadataPath = fs.realpathSync(path.join(parentPath, fileName));
      if (!this.isContainedPath(chromeRootPath, metadataPath) || !fs.statSync(metadataPath).isFile()) {
        return null;
      }
      return metadataPath;
    } catch {
      return null;
    }
  }

  private isContainedPath(root: string, candidate: string): boolean {
    const relative = path.relative(root, candidate);
    return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
  }
}

export { CONTROL_STATUS as PROFILE_CONTROL_STATUS };
