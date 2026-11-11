// Copies Three.js (installed from npm) into public/vendor so the browser can load it
// from the same origin. Runs automatically after `npm install`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'node_modules', 'three', 'build', 'three.module.js');
const dstDir = path.join(root, 'public', 'vendor');
if (!fs.existsSync(src)) { console.warn('[vendor] three not installed yet; run `npm install`'); process.exit(0); }
fs.mkdirSync(dstDir, { recursive: true });
fs.copyFileSync(src, path.join(dstDir, 'three.module.js'));
console.log('[vendor] copied three.module.js');
