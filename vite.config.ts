/// <reference types="vitest" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';

/**
 * Generates dist/sw.js from src/sw-template.js with the full precache list of the build output,
 * so the installed app (shell, code, fonts, offline map data) works with no network.
 */
function serviceWorker(): Plugin {
  let outDir = 'dist';
  return {
    name: 'last-beacon-sw',
    apply: 'build',
    configResolved(c) {
      outDir = c.build.outDir;
    },
    closeBundle() {
      const files: string[] = [];
      const walk = (d: string) => {
        for (const f of readdirSync(d)) {
          const p = join(d, f);
          if (statSync(p).isDirectory()) walk(p);
          else files.push(relative(outDir, p).split('\\').join('/'));
        }
      };
      walk(outDir);
      const list = files.filter((f) => f !== 'sw.js' && !f.endsWith('.map'));
      const hash = createHash('sha1');
      for (const f of list.sort()) hash.update(f).update(readFileSync(join(outDir, f)));
      const version = hash.digest('hex').slice(0, 10);
      const tpl = readFileSync('src/sw-template.js', 'utf8');
      const out = tpl.replace('__PRECACHE__', JSON.stringify(['./', ...list])).replace('__VERSION__', version);
      writeFileSync(join(outDir, 'sw.js'), out);
      console.log(`[sw] precache ${list.length + 1} files, version ${version}`);
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), serviceWorker()],
  build: { target: 'es2020', chunkSizeWarningLimit: 1200 },
  test: { environment: 'node', include: ['src/tests/**/*.test.ts'] },
});
