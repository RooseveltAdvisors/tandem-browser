/** Metadata describing an existing Chromium profile without exposing its data. */
export interface BrowserProfile {
  /** The human-readable name from Chromium's profile metadata. */
  name: string;
  /** The profile directory name, such as `Default` or `Profile 1`. */
  directory: string;
  /** Absolute path to the existing profile directory. */
  profilePath: string;
  /** Metadata source that established the display name. */
  metadataSource: 'local-state' | 'preferences' | 'directory';
  /** Presence of non-sensitive identity metadata files. */
  metadataFiles: {
    localState: boolean;
    preferences: boolean;
  };
}

export interface ProfileControlStatus {
  available: false;
  reason: string;
}

export interface ProfileDiscoveryResult {
  available: boolean;
  chromeUserDataPath: string | null;
  profiles: BrowserProfile[];
  control: ProfileControlStatus;
}

export interface ProfileSelectionProof {
  matchedBy: BrowserProfile['metadataSource'];
  profileName: string;
  profileDirectory: string;
  profilePath: string;
}

export interface ProfileSelectionResult {
  requestedName: string;
  profile: BrowserProfile;
  control: ProfileControlStatus;
  proof: ProfileSelectionProof;
}

export type ProfileErrorCode = 'profiles-unavailable' | 'profile-not-found' | 'profile-name-ambiguous' | 'invalid-profile-name';

export class BrowserProfileError extends Error {
  constructor(public readonly code: ProfileErrorCode, message: string) {
    super(message);
    this.name = 'BrowserProfileError';
  }
}
