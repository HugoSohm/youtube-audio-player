// SPDX-License-Identifier: AGPL-3.0-or-later
// ============================================================
// store-assets/render.mjs — Logo + visuels Chrome Web Store
// ============================================================
// Usage :  npm run build && node store-assets/render.mjs [--icons] [--lang=fr|en|es]
//          (sans --lang : les 3 langues)
//          (--icons : uniquement le logo et les icônes)
//
// Génère avec Chrome headless (aucune dépendance) :
//   public/icons/icon{16,48,128}.png     icônes de l'extension
//   store-assets/out/store-icon-128.png  icône de la fiche (96px + marge 16px)
//   store-assets/out/<lang>/screenshot-*.png         captures 1280×800
//   store-assets/out/<lang>/promo-small-440x280.png
//   store-assets/out/<lang>/promo-marquee-1400x560.png
//   store-assets/out/kofi-cover-1200x400.png         cover Ko-fi (sans --lang)
//   store-assets/out/kofi-avatar-1024.png            avatar Ko-fi, fond plein cadre (sans --lang)
//
// Les maquettes réutilisent les vrais templates HTML (player.ts,
// tracklist.ts, toggle.ts) et le CSS compilé de dist/ : relancer le
// script après une modification de l'interface suffit à les mettre à jour.
// Les titres, artistes et pochettes sont fictifs.
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'store-assets', 'out');
const BUILD = path.join(ROOT, 'store-assets', '.build');
const ICONS = path.join(ROOT, 'public', 'icons');

const CHROME = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find((p) => p && fs.existsSync(p));

if (!CHROME) throw new Error('Chrome introuvable : définir CHROME_PATH');

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// ── Rendu ─────────────────────────────────────────────────────

function shot(name, html, width, height, outFile, { transparent = false } = {}) {
  const htmlFile = path.join(BUILD, `${name}.html`);
  fs.writeFileSync(htmlFile, html);
  execFileSync(CHROME, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    `--window-size=${width},${height}`,
    '--virtual-time-budget=5000', // polices Google Fonts + animations d'entrée
    ...(transparent ? ['--default-background-color=00000000'] : []),
    `--screenshot=${outFile}`,
    pathToFileURL(htmlFile).href,
  ], { stdio: 'ignore' });
  console.log('✓', path.relative(ROOT, outFile));
}

// ── Sources de l'interface ────────────────────────────────────

const distCssFile = fs.existsSync(path.join(ROOT, 'dist', 'assets'))
  ? fs.readdirSync(path.join(ROOT, 'dist', 'assets')).find((f) => /^content-.*\.css$/.test(f))
  : null;
if (!distCssFile) throw new Error('CSS compilé introuvable : lancer "npm run build" avant');
const EXT_CSS = read(`dist/assets/${distCssFile}`);
const LOGO_SVG = read('store-assets/logo.svg');
const svgUri = (svg) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
const LOGO_URI = svgUri(LOGO_SVG);

function template(file, marker) {
  const src = read(file);
  const start = src.indexOf(marker);
  if (start < 0) throw new Error(`Template "${marker}" introuvable dans ${file}`);
  const from = start + marker.length;
  return src.slice(from, src.indexOf('`;', from));
}

// Langues générées : toutes par défaut, ou --lang=fr|en|es
const LANGS = ['fr', 'en', 'es'];
const LANG_ARG = process.argv.find((a) => a.startsWith('--lang='))?.slice(7);
/** Langue en cours de rendu */
let CURRENT_LANG = 'en';
if (LANG_ARG && !LANGS.includes(LANG_ARG)) throw new Error(`Langue inconnue : ${LANG_ARG}`);

/** Textes de l'interface (public/_locales) pour la langue en cours de rendu */
let MESSAGES = {};

/** Équivalent de src/i18n.ts, à partir des fichiers _locales */
function t(key, ...subs) {
  const entry = MESSAGES[key];
  if (!entry) return key;
  // "$arg1$" → contenu du placeholder ("$1") → substitution
  return entry.message
    .replace(/\$(\w+)\$/g, (_, name) => entry.placeholders?.[name]?.content ?? '')
    .replace(/\$(\d)/g, (_, i) => String(subs[Number(i) - 1] ?? ''));
}

/** Évalue un template literal TS avec les variables données (+ t) */
function fill(tpl, vars = {}) {
  const all = { t, ...vars };
  return new Function(...Object.keys(all), `return \`${tpl}\`;`)(...Object.values(all));
}

const WIDGET_TPL = template('src/player.ts', 'widget.innerHTML = `');
const ROW_TPL = template('src/tracklist.ts', 'row.innerHTML = `');
const THEAD_TPL = template('src/tracklist.ts', 'thead.innerHTML = `');
const TOGGLE_TPL = template('src/toggle.ts', 'btn.innerHTML = `');

// ── Données fictives ──────────────────────────────────────────

const TRACKS = [
  ['[FREE] Dark Trap Type Beat - "Nightfall"', 'Kairo Beats', '3:12'],
  ['Melodic Drill Type Beat - "Glass Heart"', 'Nova Sound', '2:58'],
  ['[FREE] Afro Type Beat - "Sunset Drive"', 'Luxe Prod', '3:24'],
  ['Lo-Fi Chill Type Beat - "Rainy Window"', 'Midnight Keys', '2:41'],
  ['Hard Trap Type Beat - "Blackout"', 'Velvet 808', '2:49'],
  ['[FREE] R&B Type Beat - "Velvet"', 'Hazel Beats', '3:35'],
  ['Jersey Club Type Beat - "Pulse"', 'Orbit Prod', '2:22'],
  ['Boom Bap Type Beat - "Old Tapes"', 'Saint Loops', '3:08'],
  ['Pluggnb Type Beat - "Pink Skies"', 'Cold Sample', '2:55'],
  ['[FREE] Rage Type Beat - "Overdrive"', 'Kairo Beats', '2:37'],
].map(([title, artist, duration], index) => ({ title, artist, duration, index, id: `demo${index}` }));

const HUES = [[265, 320], [200, 250], [20, 45], [170, 210], [0, 330], [290, 340], [185, 140], [35, 15], [320, 280], [220, 190]];

/** Pochette abstraite (SVG en data URI) */
function cover(i, w = 160, h = 160) {
  const [a, b] = HUES[i % HUES.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid slice">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="hsl(${a},70%,45%)"/><stop offset="1" stop-color="hsl(${b},75%,18%)"/>
      </linearGradient>
      <radialGradient id="r" cx="0.7" cy="0.3" r="0.6">
        <stop offset="0" stop-color="hsl(${a},90%,70%)" stop-opacity="0.55"/><stop offset="1" stop-color="hsl(${a},90%,70%)" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="${w}" height="${h}" fill="url(#g)"/>
    <rect width="${w}" height="${h}" fill="url(#r)"/>
    <circle cx="${w * 0.3}" cy="${h * 0.68}" r="${Math.min(w, h) * 0.22}" fill="none" stroke="rgba(255,255,255,0.35)" stroke-width="${Math.min(w, h) * 0.02}"/>
    <path d="M0 ${h * 0.82} Q ${w * 0.25} ${h * 0.62} ${w * 0.5} ${h * 0.8} T ${w} ${h * 0.74}" fill="none" stroke="rgba(255,255,255,0.25)" stroke-width="${Math.min(w, h) * 0.015}"/>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

/** Date de publication façon YouTube ("il y a 3 jours"), dans la langue rendue */
const AGES = [[2, 'day'], [5, 'day'], [1, 'week'], [2, 'week'], [3, 'week'], [1, 'month'], [2, 'month'], [4, 'month'], [6, 'month'], [1, 'year']];
const published = (i) => new Intl.RelativeTimeFormat(CURRENT_LANG).format(-AGES[i % AGES.length][0], AGES[i % AGES.length][1]);

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ── Blocs d'interface ─────────────────────────────────────────

function tracklist(tracks, activeIndex = -1) {
  const rows = tracks.map((t) => {
    const safe = {
      id: t.id, title: escapeHtml(t.title), artist: escapeHtml(t.artist),
      duration: t.duration, thumbnail: cover(t.index), published: published(t.index),
    };
    const cls = t.index === activeIndex ? 'ytp-tl-row ytp-tl-row--active ytp-tl-row--playing' : 'ytp-tl-row';
    return `<div class="${cls}" role="row">${fill(ROW_TPL, {
      displayIndex: t.index + 1, safe, liked: false, watched: false, watchedLabel: '', track: { watchedPercent: null },
    })}</div>`;
  }).join('');
  return `<div id="ytp-tracklist-root" style="animation:none">
    <div class="ytp-tl-table"><div class="ytp-tl-thead">${fill(THEAD_TPL)}</div>
    <div class="ytp-tl-tbody">${rows}</div></div></div>`;
}

/** Widget lecteur dans un état "en lecture" réaliste */
function widget(track, { volumeOpen = false } = {}) {
  return `<div id="ytp-player-widget" class="ytp-w--visible">${fill(WIDGET_TPL, { SKIP_SECONDS: 10 })}</div>
  <script>
    (() => {
      const w = document.currentScript.previousElementSibling;
      const $ = (id) => w.querySelector('#' + id);
      $('ytp-page-player').innerHTML = '<img src="${cover(track.index, 348, 196)}" style="width:100%;height:100%;object-fit:cover;display:block">';
      $('ytp-w-title').textContent = ${JSON.stringify(track.title)};
      $('ytp-w-artist').textContent = ${JSON.stringify(track.artist)};
      $('ytp-w-artist').setAttribute('href', '#');
      w.querySelector('.ytp-icon-play').style.display = 'none';
      w.querySelector('.ytp-icon-pause').style.display = 'block';
      $('ytp-w-progress').style.setProperty('--progress', '38%');
      $('ytp-w-current').textContent = '1:13';
      $('ytp-w-duration').textContent = ${JSON.stringify(track.duration)};
      $('ytp-w-volume').style.setProperty('--volume', '72%');
      $('ytp-w-quality-btn').textContent = '1080p';
      $('ytp-w-repeat').classList.add('ytp-w-btn--on');
      ${volumeOpen ? "$('ytp-w-vol').classList.add('ytp-w-vol--dragging');" : ''}
    })();
  </script>`;
}

function toggle(on = true) {
  return `<button id="ytp-mode-toggle" class="${on ? 'ytp-toggle--on' : ''}" type="button">${fill(TOGGLE_TPL)}</button>`;
}

/** Fenêtre de navigateur stylisée contenant une fausse page de résultats */
function browserWindow(content, { width, height, query = 'type beat', toggleOn = true }) {
  return `<div class="browser" style="width:${width}px;height:${height}px">
    <div class="browser__bar">
      <span class="browser__dot" style="background:#ff5f57"></span>
      <span class="browser__dot" style="background:#febc2e"></span>
      <span class="browser__dot" style="background:#28c840"></span>
      <div class="browser__url">youtube.com/results?search_query=${encodeURIComponent(query).replace(/%20/g, '+')}</div>
    </div>
    <div class="browser__page">
      <div class="masthead">
        <div class="masthead__search"><span>${escapeHtml(query)}</span>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        </div>
        <div class="masthead__end">${toggle(toggleOn)}<span class="masthead__avatar"></span></div>
      </div>
      <div class="browser__content">${content}</div>
    </div>
  </div>`;
}

// ── Mise en page commune ──────────────────────────────────────

// Couleurs de marque, alignées sur le logo (rouge sur fond nuit)
const BRAND = { red: '#ff4a42', redGlow: 'rgba(255,40,40,0.18)', night: '#0a0f1c' };

const BASE_CSS = `
  ${EXT_CSS}
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body {
    font-family: 'Inter', system-ui, sans-serif;
    color: #fff;
    background:
      radial-gradient(900px 600px at 85% 20%, ${BRAND.redGlow}, transparent 60%),
      radial-gradient(700px 500px at 0% 100%, rgba(59,130,246,0.10), transparent 60%),
      ${BRAND.night};
    overflow: hidden;
    -webkit-font-smoothing: antialiased;
  }
  .brand { display: flex; align-items: center; gap: 12px; font-weight: 700; font-size: 20px; letter-spacing: -0.01em; }
  .brand img { width: 40px; height: 40px; }
  h1 { font-size: 46px; line-height: 1.08; letter-spacing: -0.03em; margin: 0; font-weight: 800; }
  h1 em { font-style: normal; color: ${BRAND.red}; }
  .lead { font-size: 19px; line-height: 1.5; color: #b3b3b3; margin: 0; }
  .features { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 14px; }
  .features li { display: flex; gap: 12px; align-items: flex-start; font-size: 17px; line-height: 1.4; color: #e5e5e5; }
  .features li::before {
    content: ''; flex-shrink: 0; width: 20px; height: 20px; margin-top: 1px; border-radius: 50%;
    background: ${BRAND.red} url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23fff' stroke-width='3.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 12.5 4 4 8-9'/%3E%3C/svg%3E") center/12px no-repeat;
  }

  /* Fenêtre navigateur */
  .browser {
    position: relative; border-radius: 14px; overflow: hidden; background: #0f0f0f;
    border: 1px solid rgba(255,255,255,0.10);
    box-shadow: 0 30px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(0,0,0,0.4);
  }
  .browser__bar { height: 40px; display: flex; align-items: center; gap: 8px; padding: 0 14px; background: #1f1f1f; border-bottom: 1px solid rgba(255,255,255,0.06); }
  .browser__dot { width: 11px; height: 11px; border-radius: 50%; }
  .browser__url { margin-left: 14px; flex: 1; max-width: 460px; height: 26px; border-radius: 13px; background: #2b2b2b; color: #9aa0a6; font-size: 12px; display: flex; align-items: center; padding: 0 14px; }
  .browser__page { position: relative; height: calc(100% - 40px); overflow: hidden; }
  .browser__content { padding: 16px 20px 0; }
  .masthead { height: 56px; display: flex; align-items: center; justify-content: center; position: relative; padding: 0 20px; }
  .masthead__search { width: 38%; height: 38px; border: 1px solid #303030; border-radius: 19px; background: #121212; display: flex; align-items: center; justify-content: space-between; padding: 0 16px; color: #aaa; font-size: 14px; }
  .masthead__end { position: absolute; right: 20px; display: flex; align-items: center; gap: 12px; }
  .masthead__avatar { width: 32px; height: 32px; border-radius: 50%; background: linear-gradient(135deg, #7c3aed, #2563eb); }
  #ytp-mode-toggle { --yt-spec-text-primary: #f1f1f1; }

  /* Le widget est "fixed" dans l'extension : ici relatif à la fausse page */
  .browser__page #ytp-player-widget { position: absolute; }

  /* Les colonnes de la tracklist suivent la largeur de la fenêtre (@media de
     tracklist.scss) : on rejoue ces paliers sur la largeur de la fausse fenêtre */
  .browser__page { container-type: inline-size; }
  @container (max-width: 1100px) {
    .ytp-tl-thead, .ytp-tl-row { grid-template-columns: 52px minmax(0, 1fr) minmax(0, 116px) 60px 108px; }
    .ytp-tl-cell--info, .ytp-tl-th--info { display: none; }
  }
  @container (max-width: 860px) {
    .ytp-tl-thead, .ytp-tl-row { grid-template-columns: 44px minmax(0, 1fr) 60px 108px; }
    .ytp-tl-cell--published, .ytp-tl-th--published { display: none; }
  }
  @container (max-width: 620px) {
    .ytp-tl-thead, .ytp-tl-row { grid-template-columns: 40px minmax(0, 1fr) 60px; }
    .ytp-tl-cell--actions, .ytp-tl-th--actions { display: none; }
  }
`;

// ── Textes marketing des visuels ──────────────────────────────
// Les textes de l'interface viennent de public/_locales ; ceux-ci
// n'existent que sur les visuels du Web Store.

const COPY = {
  fr: {
    s1Title: 'Parcourez musiques et <em>type beats</em> en un clin d\'œil',
    s1Lead: 'Les résultats de recherche, les chaînes et les playlists deviennent une tracklist compacte, lisible d\'un coup d\'œil.',
    s1Features: ['Une ligne par son : titre, artiste, durée', 'Écoute instantanée dans un lecteur flottant', 'Chargement infini au scroll'],
    s2Title: 'Un lecteur flottant <em>complet</em>',
    s2Lead: 'Écoutez sans quitter la liste : la vidéo et les pubs restent visibles, sans l\'overlay de YouTube.',
    s2Features: [
      'Barre de progression glissable, ±10 secondes',
      'Lecture en boucle et volume vertical au survol',
      'Qualité vidéo au choix, mémorisée',
      'Accès direct à la vidéo et à la chaîne de l\'artiste',
      'Raccourcis clavier : Espace, ← →, R, M',
    ],
    s3Title: 'Activez ou désactivez <em>en un clic</em>',
    s3Lead: 'L\'interrupteur « Mode liste » bascule entre la tracklist et l\'affichage classique de YouTube, sur tous les onglets.',
    s3Off: '<b>Désactivé</b> — YouTube classique',
    s3On: '<b>Activé</b> — tracklist',
    views: '12 k vues',
    smallTagline: 'Musiques et <em>type beats</em>, en tracklist',
    marqueeTagline: 'Parcourez musiques et <em>type beats</em> plus facilement, sans quitter la page.',
  },
  en: {
    s1Title: 'Browse music and <em>type beats</em> at a glance',
    s1Lead: 'Search results, channels and playlists become a compact tracklist you can scan in seconds.',
    s1Features: ['One line per track: title, artist, duration', 'Instant playback in a floating player', 'Infinite scroll loading'],
    s2Title: 'A <em>complete</em> floating player',
    s2Lead: 'Listen without leaving the list: the video and ads stay visible, without the YouTube overlay.',
    s2Features: [
      'Draggable progress bar, ±10 seconds',
      'Repeat and vertical volume on hover',
      'Pick your video quality, remembered',
      'Direct access to the video and the artist\'s channel',
      'Keyboard shortcuts: Space, ← →, R, M',
    ],
    s3Title: 'Turn it on or off <em>in one click</em>',
    s3Lead: 'The “List mode” switch toggles between the tracklist and the classic YouTube view, across all tabs.',
    s3Off: '<b>Off</b> — classic YouTube',
    s3On: '<b>On</b> — tracklist',
    views: '12K views',
    smallTagline: 'Music and <em>type beats</em>, as a tracklist',
    marqueeTagline: 'Browse music and <em>type beats</em> more easily, without leaving the page.',
  },
  es: {
    s1Title: 'Explora música y <em>type beats</em> de un vistazo',
    s1Lead: 'Los resultados de búsqueda, los canales y las playlists se convierten en una lista de pistas compacta y fácil de leer.',
    s1Features: ['Una línea por pista: título, artista, duración', 'Reproducción instantánea en un reproductor flotante', 'Carga infinita al hacer scroll'],
    s2Title: 'Un reproductor flotante <em>completo</em>',
    s2Lead: 'Escucha sin salir de la lista: el vídeo y los anuncios siguen visibles, sin la superposición de YouTube.',
    s2Features: [
      'Barra de progreso deslizable, ±10 segundos',
      'Repetición y volumen vertical al pasar el ratón',
      'Calidad de vídeo a elegir, guardada',
      'Acceso directo al vídeo y al canal del artista',
      'Atajos de teclado: Espacio, ← →, R, M',
    ],
    s3Title: 'Actívalo o desactívalo <em>en un clic</em>',
    s3Lead: 'El interruptor «Modo lista» alterna entre la lista de pistas y la vista clásica de YouTube, en todas las pestañas.',
    s3Off: '<b>Desactivado</b> — YouTube clásico',
    s3On: '<b>Activado</b> — lista de pistas',
    views: '12 mil vistas',
    smallTagline: 'Música y <em>type beats</em>, en lista de pistas',
    marqueeTagline: 'Explora música y <em>type beats</em> más fácilmente, sin salir de la página.',
  },
};

const features = (items) => `<ul class="features">${items.map((f) => `<li>${f}</li>`).join('')}</ul>`;

// ── Génération ────────────────────────────────────────────────

fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(BUILD, { recursive: true });

// Icônes de l'extension (fond transparent)
for (const size of [16, 48, 128]) {
  shot(`icon${size}`, `<!doctype html><body style="margin:0;background:transparent">
    <img src="${LOGO_URI}" width="${size}" height="${size}" style="display:block"></body>`,
    size, size, path.join(ICONS, `icon${size}.png`), { transparent: true });
}

// Icône de la fiche : 96×96 + 16px de marge transparente (recommandation du Web Store)
shot('store-icon', `<!doctype html><body style="margin:0;background:transparent;padding:16px">
  <img src="${LOGO_URI}" width="96" height="96" style="display:block"></body>`,
  128, 128, path.join(OUT, 'store-icon-128.png'), { transparent: true });

if (process.argv.includes('--icons')) {
  fs.rmSync(BUILD, { recursive: true, force: true });
  process.exit(0);
}

for (const lang of LANG_ARG ? [LANG_ARG] : LANGS) renderLocale(lang);
if (!LANG_ARG) renderKofiCover();

fs.rmSync(BUILD, { recursive: true, force: true });

/**
 * Cover Ko-fi (1200×400, ratio 3:1) → store-assets/out/kofi-cover-1200x400.png
 * En anglais (public international). Textes gardés au centre-gauche, loin des
 * bords : Ko-fi recadre la cover sur mobile et y superpose l'avatar.
 */
function renderKofiCover() {
  MESSAGES = JSON.parse(read('public/_locales/en/messages.json'));

  // Avatar (photo de profil recadrée en cercle) : fond plein cadre sans coins
  // arrondis ni transparence, glyphe réduit pour rester centré dans le cercle
  const avatarSvg = LOGO_SVG
    .replace(' rx="28"', '')
    .replace('<g transform="translate(2 -3)">', '<g transform="translate(64 64) scale(0.8) translate(-64 -64) translate(2 -3)">');
  shot('kofi-avatar', `<!doctype html><body style="margin:0">
    <img src="${svgUri(avatarSvg)}" width="1024" height="1024" style="display:block"></body>`,
    1024, 1024, path.join(OUT, 'kofi-avatar-1024.png'));

  shot('kofi-cover', `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${BASE_CSS}
    body {
      background:
        radial-gradient(520px 320px at 78% 30%, ${BRAND.redGlow}, transparent 70%),
        radial-gradient(420px 300px at 8% 110%, rgba(59,130,246,0.14), transparent 70%),
        ${BRAND.night};
    }
    .wrap { position: relative; width: 1200px; height: 400px; overflow: hidden; }
    .copy { position: absolute; left: 150px; top: 50%; transform: translateY(-50%); width: 470px; display: flex; flex-direction: column; gap: 14px; }
    .copy .brand { gap: 16px; font-size: 38px; font-weight: 800; letter-spacing: -0.03em; }
    .copy .brand img { width: 64px; height: 64px; }
    .copy .tagline { margin: 0; font-size: 22px; line-height: 1.35; color: #d4d4d8; }
    .copy .tagline em { font-style: normal; color: ${BRAND.red}; font-weight: 700; }
    .copy .chips { display: flex; gap: 8px; margin-top: 6px; }
    .copy .chip { font-size: 13px; font-weight: 600; color: #e4e4e7; padding: 6px 12px; border-radius: 99px; background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.10); }
    .stage { position: absolute; left: 660px; top: 38px; }
    .stage .browser { box-shadow: 0 20px 60px rgba(0,0,0,0.6); }
    .stage #ytp-player-widget { right: 14px; top: 70px; bottom: auto; transform: scale(0.88) !important; transform-origin: top right; }
    .stage .masthead__search { width: 36%; }
    .stage .masthead__end #ytp-mode-toggle .ytp-toggle__label { display: none; }
    .stage .ytp-tl-row, .stage .ytp-tl-thead { grid-template-columns: 40px 1fr 0 44px 0 !important; padding: 0 8px !important; }
    .stage .ytp-tl-cell--info, .stage .ytp-tl-th--info, .stage .ytp-tl-cell--link { display: none !important; }
  </style></head><body><div class="wrap">
    <div class="copy">
      <div class="brand"><img src="${LOGO_URI}">YouTube Audio Player</div>
      <p class="tagline">Browse music and <em>type beats</em> on YouTube, as easily as in a streaming app.</p>
      <div class="chips"><span class="chip">Free</span><span class="chip">Open source</span><span class="chip">Privacy-friendly</span></div>
    </div>
    <div class="stage">${browserWindow(`${tracklist(TRACKS.slice(0, 7), 1)}${widget(TRACKS[1])}`, { width: 520, height: 400 })}</div>
  </div></body></html>`,
  1200, 400, path.join(OUT, 'kofi-cover-1200x400.png'));
}

/** Captures et visuels promotionnels d'une langue → store-assets/out/<lang>/ */
function renderLocale(lang) {
  CURRENT_LANG = lang;
  MESSAGES = JSON.parse(read(`public/_locales/${lang}/messages.json`));
  const c = COPY[lang];
  const dir = path.join(OUT, lang);
  fs.mkdirSync(dir, { recursive: true });

  const page = (css, body) => `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">
    <style>${BASE_CSS}${css}</style></head><body>${body}</body></html>`;

  // 1. Vue d'ensemble : tracklist + lecteur
  shot(`${lang}-screenshot-1`, page(`
    .wrap { display: grid; grid-template-columns: 380px 1fr; gap: 40px; align-items: center; height: 800px; padding: 0 48px 0 64px; }
    .copy { display: flex; flex-direction: column; gap: 28px; }
    .stage { position: relative; height: 800px; }
    .stage .browser { position: absolute; top: 70px; left: 0; }
  `, `<div class="wrap">
    <div class="copy">
      <div class="brand"><img src="${LOGO_URI}">YouTube Audio Player</div>
      <h1>${c.s1Title}</h1>
      <p class="lead">${c.s1Lead}</p>
      ${features(c.s1Features)}
    </div>
    <div class="stage">${browserWindow(`${tracklist(TRACKS.slice(0, 9), 1)}${widget(TRACKS[1])}`, { width: 748, height: 660 })}</div>
  </div>
  <style>.stage #ytp-player-widget { right: 18px; bottom: 18px; }</style>`),
  1280, 800, path.join(dir, 'screenshot-1-tracklist.png'));

  // 2. Le lecteur flottant
  shot(`${lang}-screenshot-2`, page(`
    .wrap { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; align-items: center; height: 800px; padding: 0 72px; }
    .copy { display: flex; flex-direction: column; gap: 28px; }
    .stage { display: flex; justify-content: center; align-items: center; }
    .stage #ytp-player-widget {
      position: relative; right: auto; bottom: auto; transform: scale(1.55) !important;
      box-shadow: 0 30px 80px rgba(0,0,0,0.7);
    }
  `, `<div class="wrap">
    <div class="copy">
      <div class="brand"><img src="${LOGO_URI}">YouTube Audio Player</div>
      <h1>${c.s2Title}</h1>
      <p class="lead">${c.s2Lead}</p>
      ${features(c.s2Features)}
    </div>
    <div class="stage">${widget(TRACKS[5], { volumeOpen: true })}</div>
  </div>`),
  1280, 800, path.join(dir, 'screenshot-2-player.png'));

  // 3. Activer / désactiver
  const nativeGrid = `<div class="native">${TRACKS.slice(0, 6).map((track) => `
    <div class="native__card"><img src="${cover(track.index, 320, 180)}">
      <div class="native__title">${escapeHtml(track.title)}</div>
      <div class="native__meta">${escapeHtml(track.artist)} · ${c.views}</div></div>`).join('')}</div>`;

  shot(`${lang}-screenshot-3`, page(`
    .wrap { height: 800px; padding: 56px 64px 0; display: flex; flex-direction: column; align-items: center; gap: 18px; text-align: center; }
    .wrap h1 { font-size: 42px; }
    .wrap .lead { max-width: 760px; }
    .panels { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; width: 100%; margin-top: 18px; text-align: left; }
    .panel__label { display: flex; align-items: center; gap: 10px; font-size: 15px; font-weight: 600; color: #b3b3b3; margin-bottom: 12px; }
    .panel__label b { color: #fff; }
    .native { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px 12px; }
    .native__card img { width: 100%; aspect-ratio: 16/9; border-radius: 8px; display: block; }
    .native__title { margin-top: 8px; font-size: 12px; font-weight: 600; line-height: 1.3; color: #f1f1f1; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .native__meta { margin-top: 3px; font-size: 11px; color: #aaa; }
    .browser__content { padding-top: 10px; }
    .ytp-tl-row, .ytp-tl-thead { grid-template-columns: 40px 1fr 110px 48px 0 !important; padding: 0 8px !important; }
    .ytp-tl-cell--link { display: none !important; }
  `, `<div class="wrap">
    <div class="brand"><img src="${LOGO_URI}">YouTube Audio Player</div>
    <h1>${c.s3Title}</h1>
    <p class="lead">${c.s3Lead}</p>
    <div class="panels">
      <div><div class="panel__label">${toggle(false)}<span>${c.s3Off}</span></div>
        ${browserWindow(nativeGrid, { width: 560, height: 430, toggleOn: false })}</div>
      <div><div class="panel__label">${toggle(true)}<span>${c.s3On}</span></div>
        ${browserWindow(tracklist(TRACKS.slice(0, 6), 0), { width: 560, height: 430 })}</div>
    </div>
  </div>
  <style>
    .panel__label #ytp-mode-toggle { margin: 0; }
    .browser .masthead__search { width: 40%; }
    .browser .masthead__end #ytp-mode-toggle .ytp-toggle__label { display: none; }
  </style>`),
  1280, 800, path.join(dir, 'screenshot-3-list-mode.png'));

  // Petite vignette promotionnelle
  shot(`${lang}-promo-small`, page(`
    body { background: radial-gradient(360px 240px at 80% 0%, rgba(255,40,40,0.30), transparent 70%), radial-gradient(300px 220px at 0% 100%, rgba(59,130,246,0.14), transparent 70%), ${BRAND.night}; }
    .tile { width: 440px; height: 280px; padding: 34px 36px; display: flex; flex-direction: column; justify-content: center; gap: 16px; }
    .tile img { width: 76px; height: 76px; }
    .tile h2 { margin: 0; font-size: 31px; font-weight: 800; letter-spacing: -0.02em; line-height: 1.1; }
    .tile p { margin: 0; font-size: 16px; color: #b3b3b3; line-height: 1.4; }
    .tile p em { font-style: normal; color: ${BRAND.red}; font-weight: 600; }
  `, `<div class="tile"><img src="${LOGO_URI}"><h2>YouTube Audio Player</h2>
    <p>${c.smallTagline}</p></div>`),
  440, 280, path.join(dir, 'promo-small-440x280.png'));

  // Grande bannière (marquee)
  shot(`${lang}-promo-marquee`, page(`
    .wrap { display: grid; grid-template-columns: 520px 1fr; height: 560px; padding-left: 80px; align-items: center; }
    .copy { display: flex; flex-direction: column; gap: 22px; }
    .copy img { width: 88px; height: 88px; }
    .copy h2 { margin: 0; font-size: 50px; font-weight: 800; letter-spacing: -0.03em; line-height: 1.05; }
    .copy .lead { font-size: 21px; }
    .copy .lead em { font-style: normal; color: ${BRAND.red}; font-weight: 600; }
    .stage { position: relative; height: 560px; }
    .stage .browser { position: absolute; top: 56px; left: 20px; }
    .stage #ytp-player-widget { right: 18px; bottom: 40px; }
  `, `<div class="wrap">
    <div class="copy"><img src="${LOGO_URI}"><h2>YouTube Audio Player</h2>
      <p class="lead">${c.marqueeTagline}</p></div>
    <div class="stage">${browserWindow(`${tracklist(TRACKS.slice(2, 9), 3)}${widget(TRACKS[3])}`, { width: 760, height: 540 })}</div>
  </div>`),
  1400, 560, path.join(dir, 'promo-marquee-1400x560.png'));
}
