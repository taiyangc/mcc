// ESLint preload: run typescript-eslint against TypeScript 6 while the project builds on 7.
//
// typescript-eslint 8.x throws on import when it sees TypeScript >= 7 (the native port), so
// `eslint .` cannot run at all under our TS 7 toolchain. Upstream support is tracked in
// typescript-eslint#10940. Until that lands, TypeScript's own guidance is to keep a TS 6 copy
// side by side — installed here as the `typescript-6` alias — and point the tools that need
// the old API at it. Only this ESLint process is affected: tsc and next build still use TS 7.
//
// Remove this file, the `typescript-6` devDependency, and the `--require` in the lint script
// once typescript-eslint supports TS 7.
const Module = require('node:module');
const path = require('node:path');

const TS6_DIR = path.dirname(require.resolve('typescript-6/package.json', { paths: [__dirname] }));

const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  // Rewrite to an absolute path inside the TS 6 package so subpath imports
  // (typescript/lib/...) keep working too.
  if (request === 'typescript' || request.startsWith('typescript/')) {
    return originalResolve.call(this, TS6_DIR + request.slice('typescript'.length), ...rest);
  }
  return originalResolve.call(this, request, ...rest);
};
