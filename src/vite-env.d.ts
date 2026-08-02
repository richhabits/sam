/// <reference types="vite/client" />

// Vite's ambient types, which among other things declare `*.css` (and svg/png/worker imports)
// as modules. Added for TypeScript 7: it errors on a side-effect import of a file it has no
// declaration for — `import "./styles.css"` in main.tsx became TS2882 "Cannot find module or
// type declarations for side-effect import". TypeScript 5 let it pass silently.
//
// vite/client has been in node_modules the whole time; nothing referenced it. This is the
// reference Vite's own template ships and expects, not a workaround — without it the app
// type-checks against a world where its stylesheet does not exist.
