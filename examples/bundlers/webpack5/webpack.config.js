// @ts-check
const path = require('path');
const webpack = require('webpack');

/** Node core modules that must never reach a browser bundle. */
const NODE_BUILTINS = [
  'assert', 'child_process', 'cluster', 'crypto', 'dgram', 'dns', 'events',
  'fs', 'http', 'http2', 'https', 'net', 'os', 'path', 'perf_hooks', 'process',
  'punycode', 'readline', 'repl', 'stream', 'string_decoder', 'sys', 'tls',
  'tty', 'url', 'util', 'v8', 'vm', 'worker_threads', 'zlib',
];

/**
 * Fails the build if any Node core module ended up in the browser bundle.
 *
 * Webpack 5 errors outright on an unpolyfilled `http` import, but a transitive
 * dependency could still be swapped for a shim by a third-party plugin, or a
 * `node:`-prefixed specifier could resolve through a different rule. This makes
 * the guarantee explicit and testable rather than incidental.
 */
class NoNodeBuiltinsPlugin {
  /** @param {import('webpack').Compiler} compiler */
  apply(compiler) {
    compiler.hooks.compilation.tap('NoNodeBuiltinsPlugin', (compilation) => {
      compilation.hooks.afterOptimizeModules.tap('NoNodeBuiltinsPlugin', (modules) => {
        /** @type {string[]} */
        const offenders = [];
        for (const module of modules) {
          const request = module.resource || module.userRequest || '';
          if (typeof request !== 'string' || !request) continue;
          const specifier = request.replace(/^[a-z]+:/i, '');
          if (NODE_BUILTINS.includes(specifier)) {
            offenders.push(request);
          }
        }
        if (offenders.length > 0) {
          compilation.errors.push(
            new Error(
              `Node core modules reached the browser bundle: ${offenders.join(', ')}. ` +
                'The SDK browser entries must stay free of Node built-ins.',
            ),
          );
        }
      });
    });
  }
}

/**
 * Webpack 5 browser build of the TrustFlow SDK.
 *
 * ## The point of this file
 *
 * There is **no `resolve.fallback`**, no `ProvidePlugin`, no `node:` alias and
 * no `Buffer`/`process`/`stream`/`crypto` shim. Webpack 5 removed automatic Node
 * polyfills, so any Node built-in reachable from the SDK's browser entries would
 * make this build fail with `BREAKING_CHANGE: webpack < 5 used to include
 * polyfills for node.js core modules by default` — which is exactly the
 * regression these examples guard against.
 *
 * Everything here is a Webpack 5 default or TypeScript plumbing; the only
 * SDK-specific logic is {@link NoNodeBuiltinsPlugin}, which turns "no Node
 * built-ins in the browser bundle" into a build failure rather than a
 * convention.
 *
 * Run with: npm run test:bundlers
 */
module.exports = {
  mode: 'production',
  target: 'web',
  entry: path.resolve(__dirname, '../shared-entry.ts'),
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'bundle.js',
    clean: true,
  },
  resolve: {
    extensions: ['.ts', '.js'],
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: {
          loader: 'esbuild-loader',
          options: { loader: 'ts', target: 'es2020' },
        },
      },
    ],
  },
  // No fallback, on purpose.
  stats: { errorDetails: true },
  plugins: [
    new webpack.DefinePlugin({
      'process.env.NODE_ENV': JSON.stringify('production'),
    }),
    new NoNodeBuiltinsPlugin(),
  ],
};
