// Preflight for the desktop (electron-builder) builds. node-gyp + electron-builder
// cannot rebuild native modules or pack an asar when the project path contains a
// space — it fails deep inside the build with a cryptic asar/offset error. Catch it
// up front with a clear, actionable message instead.
const cwd = process.cwd();
if (/\s/.test(cwd)) {
  console.error(`
✗ Can't build the desktop app from a path with a space:
    ${cwd}

  node-gyp (native modules) and electron-builder don't support spaces in the path.
  Build from a space-free location instead, e.g.:

    git clone <this repo> ~/sam-build
    cd ~/sam-build && npm install && npm run build:mac

  (The web app — npm start / npm run dev — works fine from here; this only affects
   packaged DMG/EXE/AppImage builds.)
`);
  process.exit(1);
}
console.log("✓ build path is space-free");
