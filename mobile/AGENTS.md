# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

# This repo lives on a path with a SPACE in it

`/Volumes/Work Drive/SAM` — and several CocoaPods / React-Native script phases interpolate their
path into a shell command **unquoted**. The build then dies with:

```
No such file or directory: /Volumes/Work
```

which reads like a missing file and is really a quoting bug. It has now cost two debugging
sessions (PIING first, then here), so read this before chasing it a third time:

- **Fixed in tracked code** by `plugins/with-space-safe-pods.js`, registered in `app.json`.
  It quotes both offenders: the `expo-constants` pod script phase, and the app target's
  "Bundle React Native code and images" phase. It throws loudly if either stops matching,
  rather than letting the original bug creep back silently.
- **A symlink from a space-free path does NOT work.** CocoaPods resolves realpath when it
  writes `Pods.xcodeproj`, so the space comes straight back. Don't retry that.
- `ios/` is generated and gitignored — patching it by hand is lost on the next
  `expo prebuild --clean`. The plugin is the only durable place for this.

# Running it

```bash
npx expo prebuild --platform ios --clean      # regenerates ios/, re-applies the plugin
npx expo run:ios --device "<simulator UDID>"  # first build ~15 min, then incremental
```

JS changes hot-reload through Metro — a native rebuild is only needed after a prebuild or a
dependency with native code.

# Notifications

`lib/notify.ts` owns the receiving half (handler, permission, sound toggle). Local
notifications work on a simulator. **Remote push does not exist yet**: the server's B4 push is
Web Push / VAPID, which a native app cannot consume — a real transport needs an APNs key from
the operator's Apple account. To exercise the receive path without one:

```bash
xcrun simctl push <UDID> com.hectic.sam.mobile payload.json
```

Every notification body goes through `lib/scrub.ts` before it renders. That is a deliberate
second copy of the server's by-shape scrubber (a lock screen is a public surface, and the
native layer is the last code to touch the text). `lib/scrub.test.ts` pins the two copies
against each other so drift fails the suite — run it from the REPO ROOT with `npx vitest`,
not from here.
