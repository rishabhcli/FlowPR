import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const stylesPath = join(process.cwd(), 'apps', 'demo-target', 'app', 'styles.css');
const current = readFileSync(stylesPath, 'utf8');
const next = current
  .replace(/z-index: 30;\n  border-radius: 999px;\n  background: #111827;/, 'z-index: 10;\n  border-radius: 999px;\n  background: #111827;')
  .replace(/z-index: 12;\n  display: flex;/, 'z-index: 20;\n  display: flex;');

if (next === current) {
  console.log('Demo target was already in the broken checkout state.');
} else {
  writeFileSync(stylesPath, next);
  console.log('Demo target checkout bug enabled: cookie banner covers the mobile Pay button.');
}
