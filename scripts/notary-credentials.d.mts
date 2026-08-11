// The hooks stay plain .mjs because electron-builder loads them directly at build time — it does
// not compile TypeScript. This declaration exists so the test suite can still typecheck them
// rather than the release tooling being the one corner of the repo the compiler cannot see.

export interface NotaryCredentials {
  /** Human-readable description for build logs. Never contains the password. */
  how: string;
  /** Passed to @electron/notarize — either a keychain profile or an Apple ID triple. */
  notarizeOptions:
    | { keychainProfile: string }
    | { appleId: string; appleIdPassword: string; teamId: string };
  /** The same identity as argv for a direct `xcrun notarytool` call (used for the dmg). */
  notarytoolArgs: string[];
}

export declare function profileName(): string;
/** Resolved credentials, or null when neither the keychain nor the environment supplies them. */
export declare function notaryCredentials(): NotaryCredentials | null;
export declare function isDeveloperIdSigned(appPath: string): boolean;
export declare function skipRequested(): boolean;
