process.argv.splice(2, 0, 'hook');
await import('./codex-live2d.mjs');
