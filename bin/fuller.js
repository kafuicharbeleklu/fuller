#!/usr/bin/env node
// Ink switches to a frame-less "CI" renderer when it sees CI variables (is-in-ci, read at import).
// In a real terminal Fuller is interactive, so hide them before Ink loads.
if (process.stdout.isTTY && process.stdin.isTTY) {
  for (const key of Object.keys(process.env)) if (key === 'CI' || key === 'CONTINUOUS_INTEGRATION' || key.startsWith('CI_')) delete process.env[key];
}
await import('../dist/index.js');
