/* Verifies the built package shares one copy of modules across entries (CJS and ESM). */
const path = require('path');
const { pathToFileURL } = require('url');

const dist = path.resolve(process.argv[2] || path.join(__dirname, '..', 'dist'));
const subpaths = ['escrow', 'hooks', 'wallet', 'utils'];
const failures = [];

function check(label, ok) {
  if (!ok) failures.push(label);
}

async function verify(format, load) {
  const root = await load('index');
  for (const sub of subpaths) {
    const mod = await load(`${sub}/index`);
    check(`${format}: ${sub} exports the root TrustFlowError`, mod.TrustFlowError === root.TrustFlowError);
  }
  const esc = await load('escrow/index');
  check(`${format}: EscrowMonitor identical`, root.EscrowMonitor === esc.EscrowMonitor);
  check(`${format}: EscrowBuilder identical`, root.EscrowBuilder === esc.EscrowBuilder);
  check(
    `${format}: MultiSigEscrowClient identical`,
    root.MultiSigEscrowClient === esc.MultiSigEscrowClient,
  );
  let thrown;
  try {
    await esc.cancelEscrow({}, '', 'x');
  } catch (e) {
    thrown = e;
  }
  check(`${format}: errors from /escrow are instanceof root TrustFlowError`, thrown instanceof root.TrustFlowError);
  const utils = await load('utils/index');
  check(`${format}: logger identical`, root.logger === undefined || root.logger === utils.logger);
}

(async () => {
  await verify('cjs', async (name) => require(path.join(dist, `${name}.js`)));
  await verify('esm', (name) => import(pathToFileURL(path.join(dist, `${name}.mjs`)).href));
  if (failures.length) {
    console.error('Entry identity check failed:\n - ' + failures.join('\n - '));
    process.exit(1);
  }
  console.log('Entry identity check passed');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
