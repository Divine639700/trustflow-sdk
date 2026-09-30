/**
 * Prepends the `'use client'` directive to the emitted `@trustflow/sdk/react`
 * entry points.
 *
 * `src/hooks/*` calls `useState`, `useEffect` and `useCallback`, so in the
 * Next.js App Router the module fails the moment it is imported from a Server
 * Component (or from any file that is not itself a client module) unless it
 * declares itself a client module. Without this, every consumer has to re-wrap
 * the hooks in their own client file.
 *
 * It is injected into the build output rather than written in the source
 * because a module-level directive does not survive bundling: a `'use client'`
 * at the top of `src/hooks/index.ts` is dropped by tsup (and by any consumer's
 * bundler), which is exactly why the directive has to be in the emitted file.
 *
 * A per-entry tsup `banner` would be the natural place for this, but tsup runs
 * the configs of an array in parallel against one `outDir`, so a second config
 * for the React entry races the first one's `clean` and leaks the banner onto
 * `dist/index.js` ("Module level directives cause errors when bundled, "use
 * client" in "dist/index.js" was ignored"). Injecting after the build is
 * deterministic and can only ever touch the two React files.
 *
 * Idempotent: a file that already starts with the directive is left alone.
 *
 * Usage: node scripts/inject-use-client.js [distDir]
 */
const fs = require('fs');
const path = require('path');

const DIRECTIVE = "'use client';";
const TARGETS = ['hooks/index.js', 'hooks/index.mjs'];

const dist = path.resolve(process.argv[2] || path.join(__dirname, '..', 'dist'));
const errors = [];

for (const target of TARGETS) {
  const file = path.join(dist, target);

  let source;
  try {
    source = fs.readFileSync(file, 'utf8');
  } catch {
    errors.push(`${target} was not emitted; run the build first`);
    continue;
  }

  if (source.startsWith(DIRECTIVE)) continue;

  fs.writeFileSync(file, `${DIRECTIVE}\n${source}`);
  console.log(`Injected '${DIRECTIVE}' into dist/${target}`);
}

if (errors.length > 0) {
  errors.forEach((e) => console.error(`error: ${e}`));
  process.exit(1);
}
