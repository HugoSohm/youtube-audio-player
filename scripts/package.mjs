// SPDX-License-Identifier: AGPL-3.0-or-later
// ============================================================
// scripts/package.mjs — ZIP à envoyer sur le Chrome Web Store
// ============================================================
// Usage :  npm run package
//   1. build de production sans sourcemaps (RELEASE=true)
//   2. crée release/youtube-audio-player-v<version>.zip
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const OUT = path.join(ROOT, 'release', `youtube-audio-player-v${version}.zip`);

execSync('npx vite build', { cwd: ROOT, stdio: 'inherit', env: { ...process.env, RELEASE: 'true' } });

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.rmSync(OUT, { force: true });

// Le manifest doit être à la racine du ZIP : on zippe le contenu de dist/.
// Sous Windows on utilise tar.exe (bsdtar) : Compress-Archive de PowerShell 5
// écrit des chemins avec "\" que le Chrome Web Store peut refuser.
const entries = fs.readdirSync(DIST);
if (process.platform === 'win32') {
  execFileSync(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe'),
    ['-a', '-c', '-f', OUT, ...entries], { cwd: DIST, stdio: 'inherit' });
} else {
  execFileSync('zip', ['-r', '-X', OUT, ...entries], { cwd: DIST, stdio: 'inherit' });
}

const kb = (fs.statSync(OUT).size / 1024).toFixed(1);
console.log(`\n✓ ${path.relative(ROOT, OUT)} (${kb} Ko)`);
