#!/usr/bin/env node
// Production entrypoint for the combined dashboard + worker image.
// Spawns the Next.js dashboard and the agent worker as child processes so
// Akash can supervise a single container that services both responsibilities.

import { spawn } from 'node:child_process';

const processes = [];

function start(label, command, args, env = {}) {
  const child = spawn(command, args, {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'inherit', 'inherit'],
  });

  child.on('exit', (code) => {
    console.error(`[${label}] exited with code ${code}`);
    processes.filter((entry) => entry.child !== child).forEach((entry) => entry.child.kill('SIGTERM'));
    process.exit(code ?? 1);
  });

  processes.push({ label, child });
}

start('dashboard', 'pnpm', ['--filter', '@flowpr/dashboard', 'start']);
start('worker', 'pnpm', ['worker:dev']);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    for (const entry of processes) {
      entry.child.kill(signal);
    }
  });
}
