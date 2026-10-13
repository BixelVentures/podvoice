// Test-only launch observation. Preserve Playwright's spawn options and SDK cleanup.
'use strict';
const fs = require('node:fs');
const childProcess = require('node:child_process');
const originalSpawn = childProcess.spawn;
const nonce = process.env.PODVOICE_BROWSER_NONCE;
const registryFd = Number(process.env.PODVOICE_BROWSER_REGISTRY_FD);
const executable = fs.realpathSync(process.env.PODVOICE_TEST_CHROMIUM);
let sequence = 0;
function record(kind, fields = {}) {
  const value = {kind, nonce, worker:process.pid, sequence:sequence++, ...fields};
  try { fs.writeSync(registryFd, JSON.stringify(value)+'\n'); }
  catch (_) {
    // A failed registry can never be success, even if assertions later pass.
    process.exitCode = 78;
    process.stderr.write('browser ownership registry failed\n');
  }
}
record('ready');
childProcess.spawn = function(command, args, options) {
  const child = originalSpawn.apply(this, arguments);
  let matches = false;
  try { matches = fs.realpathSync(command) === executable; } catch (_) {}
  if (matches) {
    if (!options || options.detached !== true || !Number.isInteger(child.pid)) {
      record('invalid-launch');
      process.exitCode = 78;
    } else {
      record('launch', {pid:child.pid, group:child.pid});
    }
  }
  return child;
};
