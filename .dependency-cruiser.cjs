// SAM module-boundary rules. Run with: npx depcruise server src electron
// (needs `npm i -D dependency-cruiser` first — authored ahead of the install so the
//  boundaries are reviewed and version-controlled independently of wiring it into CI.)
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      comment: "Circular deps make reasoning + tree-shaking harder. Break the cycle via an interface.",
      severity: "warn", // start as warn: the known tools↔forge edge is a registration cycle (forge pushes into TOOLS)
      from: {},
      to: { circular: true },
    },
    {
      name: "server-not-from-ui",
      comment: "The backend must never import React UI code — they ship in different runtimes.",
      severity: "error",
      from: { path: "^server/" },
      to: { path: "^src/" },
    },
    {
      name: "ui-not-from-server-internals",
      comment: "The UI talks to the backend over HTTP, not by importing server modules directly.",
      severity: "error",
      from: { path: "^src/" },
      to: { path: "^server/" },
    },
    {
      name: "no-orphans",
      comment: "Unreferenced modules are usually dead code.",
      severity: "warn",
      from: { orphan: true, pathNot: "\\.(d\\.ts|test\\.ts|config\\.(ts|js|cjs|mjs))$" },
      to: {},
    },
    {
      name: "not-to-dev-dep",
      comment: "Production code must not import a devDependency.",
      severity: "error",
      from: { pathNot: "\\.(test|spec)\\.ts$|^(scripts|e2e)/" },
      to: { dependencyTypes: ["npm-dev"] },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsConfig: { fileName: "tsconfig.json" },
    tsPreCompilationDeps: true,
  },
};
