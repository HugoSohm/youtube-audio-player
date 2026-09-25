// SPDX-License-Identifier: AGPL-3.0-or-later
// ============================================================
// store-assets/render.mjs — Logo + visuels Chrome Web Store
// ============================================================
// Usage :  npm run build && node store-assets/render.mjs [--icons] [--lang=fr|en|es] [--gif]
//          (sans --lang : les 3 langues)
//          (--icons : uniquement le logo et les icônes)
//          (--gif : uniquement le GIF promotionnel, nécessite gifenc + pngjs)
//
// Génère avec Chrome headless :
//   public/icons/icon{16,48,128}.png     icônes de l'extension
//   store-assets/out/store-icon-128.png  icône de la fiche (plein cadre)
//   store-assets/out/<lang>/screenshot-*.png         captures 1280×800
//   store-assets/out/<lang>/promo-small-440x280.png
//   store-assets/out/<lang>/promo-marquee-1400x560.png
//   store-assets/out/kofi-cover-1200x400.png         cover Ko-fi (sans --lang)
//   store-assets/out/kofi-avatar-1024.png            avatar Ko-fi, fond plein cadre (sans --lang)
//   store-assets/out/promo-en.gif                    GIF promotionnel (--gif uniquement)
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

/** Format du GIF promotionnel (--gif) */
const GIF = { width: 960, height: 600, fps: 20, duration: 9.8 };

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

// GIF promotionnel : rendu séparé (plus long), uniquement avec --gif
if (process.argv.includes('--gif')) {
  await renderPromoGif();
  fs.rmSync(BUILD, { recursive: true, force: true });
  process.exit(0);
}

// Icônes de l'extension (fond transparent)
for (const size of [16, 48, 128]) {
  shot(`icon${size}`, `<!doctype html><body style="margin:0;background:transparent">
    <img src="${LOGO_URI}" width="${size}" height="${size}" style="display:block"></body>`,
    size, size, path.join(ICONS, `icon${size}.png`), { transparent: true });
}

// Icône de la fiche : plein cadre comme l'icône 128 de l'extension (une marge de
// 16px la ferait paraître plus petite que les autres icônes du tableau de bord)
shot('store-icon', `<!doctype html><body style="margin:0;background:transparent">
  <img src="${LOGO_URI}" width="128" height="128" style="display:block"></body>`,
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

// ── GIF promotionnel ──────────────────────────────────────────
// Usage : node store-assets/render.mjs --gif
// Scène animée pilotée par une fonction setTime(t) dans la page, capturée
// image par image via le protocole DevTools de Chrome (headless), puis
// encodée en GIF (gifenc + pngjs).

async function renderPromoGif() {
  // Paquets CommonJS : leurs exports sont sous default en import ESM
  const gifenc = await import('gifenc');
  const { GIFEncoder, quantize, applyPalette } = gifenc.default ?? gifenc;
  const { PNG } = (await import('pngjs')).default;

  MESSAGES = JSON.parse(read('public/_locales/en/messages.json'));
  const htmlFile = path.join(BUILD, 'promo-gif.html');
  fs.writeFileSync(htmlFile, promoGifHtml());

  const frames = await captureFrames(htmlFile);

  // Debug : GIF_FRAMES_DIR=<dossier> exporte une image par seconde en PNG
  if (process.env.GIF_FRAMES_DIR) {
    fs.mkdirSync(process.env.GIF_FRAMES_DIR, { recursive: true });
    frames.forEach((f, i) => {
      if (i % GIF.fps === 0) fs.writeFileSync(path.join(process.env.GIF_FRAMES_DIR, `t${i / GIF.fps}.png`), f);
    });
  }

  // Palette commune (échantillon de quelques images) : évite le scintillement.
  // Le dernier index est réservé à la transparence.
  const size = GIF.width * GIF.height * 4;
  const sample = frames.filter((_, i) => i % Math.ceil(frames.length / 8) === 0);
  const sampleData = new Uint8Array(sample.length * size);
  sample.forEach((f, i) => sampleData.set(PNG.sync.read(f).data, i * size));
  const palette = quantize(sampleData, 255);
  const transparentIndex = palette.length;
  palette.push([255, 0, 255]);

  // Chaque image ne contient que les pixels qui changent : le reste est
  // transparent et laisse voir l'image précédente (dispose = 1). Divise
  // fortement le poids, la scène restant majoritairement immobile.
  const gif = GIFEncoder();
  const frameDelay = Math.round(1000 / GIF.fps);
  let previous = null; // indices de la dernière image affichée
  let pending = null; // image en attente, allongée tant qu'elle se répète
  const flush = () => {
    if (!pending) return;
    const index = applyPalette(PNG.sync.read(pending.png).data, palette);
    let toWrite = index;
    if (previous) {
      toWrite = new Uint8Array(index);
      for (let i = 0; i < index.length; i++) if (index[i] === previous[i]) toWrite[i] = transparentIndex;
    }
    gif.writeFrame(toWrite, GIF.width, GIF.height, {
      ...(previous ? { transparent: true, transparentIndex } : { palette, repeat: 0 }),
      dispose: 1,
      delay: pending.delay,
    });
    previous = index;
  };
  for (const png of frames) {
    if (pending && pending.png.equals(png)) {
      pending.delay += frameDelay;
      continue;
    }
    flush();
    pending = { png, delay: frameDelay };
  }
  flush();
  gif.finish();

  const out = path.join(OUT, 'promo-en.gif');
  fs.writeFileSync(out, gif.bytes());
  const mb = (fs.statSync(out).size / 1024 / 1024).toFixed(1);
  console.log('✓', path.relative(ROOT, out), `(${mb} Mo, ${frames.length} images)`);
}

/** Lance Chrome headless et capture chaque image de la scène */
async function captureFrames(htmlFile) {
  const { spawn } = await import('node:child_process');
  const port = 9333;
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    `--remote-debugging-port=${port}`, `--user-data-dir=${path.join(BUILD, 'chrome-profile')}`,
    `--window-size=${GIF.width},${GIF.height}`, 'about:blank',
  ], { stdio: 'ignore' });

  try {
    // Attend que DevTools réponde
    let target;
    for (let i = 0; i < 50 && !target; i++) {
      await new Promise((r) => setTimeout(r, 200));
      try {
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        target = list.find((t) => t.type === 'page');
      } catch { /* Chrome démarre */ }
    }
    if (!target) throw new Error('Chrome DevTools injoignable');

    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    let nextId = 0;
    const calls = new Map();
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      const call = calls.get(msg.id);
      if (!call) return;
      calls.delete(msg.id);
      if (msg.error) call.reject(new Error(msg.error.message));
      else call.resolve(msg.result);
    };
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++nextId;
      calls.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async (expression) =>
      (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result.value;

    await send('Emulation.setDeviceMetricsOverride', {
      width: GIF.width, height: GIF.height, deviceScaleFactor: 1, mobile: false,
    });
    await send('Page.navigate', { url: pathToFileURL(htmlFile).href });
    for (let i = 0; i < 100; i++) {
      if (await evaluate(`document.readyState === 'complete' && typeof setTime === 'function'`)) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    await evaluate('document.fonts.ready.then(() => { initScene(); return true; })');

    const frames = [];
    const total = Math.round(GIF.duration * GIF.fps);
    for (let i = 0; i < total; i++) {
      await evaluate(`setTime(${(i / GIF.fps).toFixed(3)})`);
      const { data } = await send('Page.captureScreenshot', { format: 'png' });
      frames.push(Buffer.from(data, 'base64'));
    }
    ws.close();
    return frames;
  } finally {
    chrome.kill();
  }
}

/** Scène HTML du GIF (textes en anglais) */
function promoGifHtml() {
  const grid = `<div class="native">${TRACKS.slice(0, 6).map((track) => `
    <div class="native__card"><img src="${cover(track.index, 320, 180)}">
      <div class="native__title">${escapeHtml(track.title)}</div>
      <div class="native__meta">${escapeHtml(track.artist)} · 12K views</div></div>`).join('')}</div>`;

  const content = `
    <div class="views">
      <div class="view view--grid">${grid}</div>
      <div class="view view--list">${tracklist(TRACKS.slice(0, 8))}</div>
    </div>
    ${widget(TRACKS[1])}`;

  // Pistes jouées pendant la démo (lignes 2 puis 3)
  const demoTracks = [1, 2].map((i) => ({
    title: TRACKS[i].title,
    artist: TRACKS[i].artist,
    duration: TRACKS[i].duration,
    cover: cover(TRACKS[i].index, 348, 196),
  }));

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${BASE_CSS}
    body { background: radial-gradient(700px 420px at 90% 0%, ${BRAND.redGlow}, transparent 70%), ${BRAND.night}; }
    *, *::before, *::after { transition: none !important; }
    #ytp-tracklist-root { animation: none !important; }
    .ytp-tl-eq i { animation-play-state: paused !important; }
    .frame { position: absolute; inset: 16px; }
    .frame .browser { width: 100% !important; height: 100% !important; }
    .masthead__search { width: 38%; }
    .views { position: relative; }
    .view { position: absolute; inset: 0 0 auto 0; }
    .native { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px 14px; padding: 4px 8px; }
    .native__card img { width: 100%; aspect-ratio: 16/9; border-radius: 8px; display: block; }
    .native__title { margin-top: 8px; font-size: 13px; font-weight: 600; line-height: 1.3; color: #f1f1f1; }
    .native__meta { margin-top: 3px; font-size: 12px; color: #aaa; }
    /* Survol simulé : le curseur est dessiné, il n'y a pas de vraie souris */
    .ytp-tl-row.sim-hover { background: rgba(255,255,255,0.06); }
    .ytp-tl-row.sim-hover .ytp-tl-index-num { opacity: 0; }
    .ytp-tl-row.sim-hover .ytp-tl-play-btn { opacity: 1; transform: scale(1); }
    .ytp-w-btn.sim-hover { color: #fff; background: rgba(255,255,255,0.08); }
    /* Au-dessus du lecteur, dont le z-index est très élevé (99999) */
    #cursor { position: fixed; left: 0; top: 0; width: 22px; height: 22px; z-index: 2147483647; pointer-events: none;
      filter: drop-shadow(0 2px 3px rgba(0,0,0,0.6)); }
    #ripple { position: fixed; width: 34px; height: 34px; margin: -17px 0 0 -17px; border-radius: 50%;
      border: 2px solid rgba(255,255,255,0.9); z-index: 2147483646; pointer-events: none; opacity: 0; }
    .endcard { position: fixed; inset: 0; z-index: 2147483645; display: flex; flex-direction: column; align-items: center;
      justify-content: center; gap: 18px; opacity: 0;
      background: radial-gradient(600px 380px at 50% 30%, ${BRAND.redGlow}, transparent 70%), ${BRAND.night}; }
    .endcard img { width: 120px; height: 120px; }
    .endcard h2 { margin: 0; font-size: 52px; font-weight: 800; letter-spacing: -0.03em; }
    .endcard p { margin: 0; font-size: 22px; color: #d4d4d8; }
    .endcard p em { font-style: normal; color: ${BRAND.red}; font-weight: 700; }
    .endcard .chips { display: flex; gap: 10px; margin-top: 6px; }
    .endcard .chip { font-size: 15px; font-weight: 600; color: #e4e4e7; padding: 7px 14px; border-radius: 99px;
      background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.1); }
  </style></head><body>
    <div class="frame">${browserWindow(content, { width: GIF.width - 32, height: GIF.height - 32, toggleOn: false })}</div>
    <div class="endcard">
      <img src="${LOGO_URI}">
      <h2>YouTube Audio Player</h2>
      <p>Browse music and <em>type beats</em> on YouTube, faster.</p>
      <div class="chips"><span class="chip">Free</span><span class="chip">Open source</span><span class="chip">Chrome extension</span></div>
    </div>
    <div id="ripple"></div>
    <svg id="cursor" viewBox="0 0 24 24"><path d="M4 2l15 11.5-6.6.9 3.9 7.6-3 1.5-3.9-7.7L4 20.5z" fill="#fff" stroke="#111" stroke-width="1.3" stroke-linejoin="round"/></svg>
    <script>${promoGifScript(demoTracks)}</script>
  </body></html>`;
}

/** Animation de la scène : setTime(t) place tous les éléments à l'instant t (secondes) */
function promoGifScript(demoTracks) {
  return `
    const TRACK_DATA = ${JSON.stringify(demoTracks)};
    const $ = (s) => document.querySelector(s);
    const clamp = (v) => Math.max(0, Math.min(1, v));
    const ease = (p) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);
    const lerp = (a, b, p) => a + (b - a) * p;
    const fmt = (s) => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
    const toSec = (d) => d.split(':').reduce((a, b) => a * 60 + Number(b), 0);
    const center = (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };

    let T, KEYS, rows, widgetEl;

    function initScene() {
      widgetEl = $('#ytp-player-widget');
      rows = [...document.querySelectorAll('.ytp-tl-row')];
      // Positions mesurées avec le lecteur visible et la jauge de volume ouverte
      widgetEl.classList.add('ytp-w--visible');
      $('#ytp-w-vol').classList.add('ytp-w-vol--dragging');
      const bar = $('#ytp-w-volume').getBoundingClientRect();
      T = {
        start: { x: 560, y: 470 },
        toggle: center($('.masthead #ytp-mode-toggle .ytp-toggle__switch')),
        row2: center(rows[1].querySelector('.ytp-tl-cell--index')),
        vol: center($('#ytp-w-mute')),
        volLow: { x: bar.left + bar.width / 2, y: bar.bottom - bar.height * 0.55 },
        volHigh: { x: bar.left + bar.width / 2, y: bar.bottom - bar.height * 0.9 },
        next: center($('#ytp-w-next')),
        repeat: center($('#ytp-w-repeat')),
        bar: { bottom: bar.bottom, height: bar.height },
      };
      // Trajet du curseur : [temps, position]
      KEYS = [
        [0.0, T.start], [0.9, T.toggle], [1.3, T.toggle], [2.0, T.row2], [2.4, T.row2],
        [3.3, T.vol], [3.7, T.vol], [3.9, T.volLow], [4.7, T.volHigh], [4.9, T.volHigh],
        [5.5, T.next], [5.8, T.next], [6.6, T.repeat], [7.6, T.repeat],
      ];
    }

    function cursorAt(t) {
      for (let i = 0; i < KEYS.length - 1; i++) {
        const [t0, a] = KEYS[i];
        const [t1, b] = KEYS[i + 1];
        if (t <= t1) {
          const p = ease(clamp((t - t0) / (t1 - t0)));
          return { x: lerp(a.x, b.x, p), y: lerp(a.y, b.y, p) };
        }
      }
      return KEYS[KEYS.length - 1][1];
    }

    const CLICKS = [1.0, 2.2, 3.9, 5.7, 6.8];

    window.setTime = (t) => {
      const c = cursorAt(t);
      const cursor = $('#cursor');
      cursor.style.transform = 'translate(' + (c.x - 4) + 'px,' + (c.y - 2) + 'px)';
      cursor.style.opacity = String(1 - clamp((t - 7.6) / 0.3));

      // Onde de clic
      const click = CLICKS.find((ct) => t >= ct && t < ct + 0.35);
      const ripple = $('#ripple');
      if (click !== undefined) {
        const p = (t - click) / 0.35;
        ripple.style.left = c.x + 'px';
        ripple.style.top = c.y + 'px';
        ripple.style.opacity = String(1 - p);
        ripple.style.transform = 'scale(' + (0.4 + p) + ')';
      } else {
        ripple.style.opacity = '0';
      }

      // Mode liste
      $('.masthead #ytp-mode-toggle').classList.toggle('ytp-toggle--on', t >= 1.0);
      const pList = ease(clamp((t - 1.0) / 0.35));
      $('.view--grid').style.opacity = String(1 - pList);
      $('.view--list').style.opacity = String(pList);

      // Piste en cours
      const trackIdx = t >= 5.7 ? 2 : t >= 2.2 ? 1 : -1;
      rows.forEach((r, i) => {
        const active = i === trackIdx;
        r.classList.toggle('ytp-tl-row--active', active);
        r.classList.toggle('ytp-tl-row--playing', active);
        r.classList.toggle('sim-hover', i === 1 && t >= 2.0 && t < 2.2);
        r.querySelectorAll('.ytp-tl-eq i').forEach((b, j) => { b.style.animationDelay = (-(t + j * 0.37)) + 's'; });
      });

      // Lecteur
      const pWidget = ease(clamp((t - 2.2) / 0.3));
      widgetEl.classList.toggle('ytp-w--visible', t >= 2.2);
      widgetEl.style.opacity = String(pWidget);
      widgetEl.style.transform = 'translateY(' + (14 * (1 - pWidget)) + 'px)';
      if (trackIdx > 0) {
        const data = TRACK_DATA[trackIdx - 1];
        $('#ytp-w-title').textContent = data.title;
        $('#ytp-w-artist').textContent = data.artist;
        const img = $('#ytp-page-player img');
        if (img && img.dataset.cover !== data.cover) { img.src = data.cover; img.dataset.cover = data.cover; }
        const start = trackIdx === 1 ? 2.2 : 5.7;
        const shown = 3 + (t - start) * 9; // lecture accélérée pour que la progression se voie
        $('#ytp-w-progress').style.setProperty('--progress', (shown / toSec(data.duration) * 100) + '%');
        $('#ytp-w-current').textContent = fmt(shown);
        $('#ytp-w-duration').textContent = data.duration;
      }
      $('#ytp-w-repeat').classList.toggle('ytp-w-btn--on', t >= 6.8);

      // Volume : jauge ouverte au survol, glissée vers le haut
      const volOpen = t >= 3.6 && t < 5.0;
      $('#ytp-w-vol').classList.toggle('ytp-w-vol--dragging', volOpen);
      const vol = t < 3.9 ? 55 : t < 4.7 ? clamp((T.bar.bottom - c.y) / T.bar.height) * 100 : 90;
      $('#ytp-w-volume').style.setProperty('--volume', Math.round(vol) + '%');

      const near = (p) => Math.hypot(c.x - p.x, c.y - p.y) < 14;
      $('#ytp-w-next').classList.toggle('sim-hover', near(T.next));
      $('#ytp-w-repeat').classList.toggle('sim-hover', near(T.repeat) && t < 7.6);
      $('#ytp-w-mute').classList.toggle('sim-hover', near(T.vol) && !volOpen);

      // Écran de fin
      $('.endcard').style.opacity = String(ease(clamp((t - 7.7) / 0.4)));
      return true;
    };`;
}
