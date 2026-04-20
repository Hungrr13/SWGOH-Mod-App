// Render ModForge icon concepts to PNGs.
// Usage:
//   node tools/icon-gen.js preview        -> writes 512x512 previews for all concepts
//   node tools/icon-gen.js apply <name>   -> writes full Android density set + assets/

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const PREVIEW_DIR = path.join(ROOT, 'assets', 'icon-previews');
const ASSETS_DIR = path.join(ROOT, 'assets');
const RES_DIR = path.join(ROOT, 'android', 'app', 'src', 'main', 'res');

// All concepts paint on a 1024x1024 canvas.
// `bg` is rendered as the adaptive-icon background color.
// `foreground` is the SVG drawn at full canvas; the central 66% (≈672px)
// must contain the meaningful art so it survives Android's adaptive masking.
const CONCEPTS = {
  // Concept A: Hex Anvil. Hexagonal mod silhouette over a stylised anvil.
  // Amber spark suggests forging/upgrading. Bold + readable at 48px.
  hexanvil: {
    bg: '#0a0e17',
    foreground: `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
        <defs>
          <linearGradient id="hexFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#3b82f6"/>
            <stop offset="100%" stop-color="#1e40af"/>
          </linearGradient>
          <radialGradient id="spark" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0%" stop-color="#fde68a" stop-opacity="1"/>
            <stop offset="60%" stop-color="#f59e0b" stop-opacity="0.85"/>
            <stop offset="100%" stop-color="#f59e0b" stop-opacity="0"/>
          </radialGradient>
        </defs>
        <!-- anvil base -->
        <rect x="288" y="704" width="448" height="48" rx="10" fill="#475569"/>
        <path d="M 224 600 L 800 600 L 752 704 L 272 704 Z" fill="#64748b"/>
        <rect x="320" y="560" width="384" height="56" rx="8" fill="#94a3b8"/>
        <!-- hex mod silhouette -->
        <path d="M 512 152 L 808 320 L 808 540 L 512 568 L 216 540 L 216 320 Z"
              fill="url(#hexFill)" stroke="#93c5fd" stroke-width="14" stroke-linejoin="round"/>
        <!-- inner stat band -->
        <path d="M 512 232 L 712 348 L 712 504 L 512 524 L 312 504 L 312 348 Z"
              fill="#0a0e17" opacity="0.55"/>
        <!-- forge spark -->
        <circle cx="512" cy="430" r="120" fill="url(#spark)"/>
        <path d="M 512 350 L 540 420 L 612 420 L 552 462 L 576 532 L 512 488 L 448 532 L 472 462 L 412 420 L 484 420 Z"
              fill="#fbbf24"/>
      </svg>
    `,
  },

  // Concept B: Crit Bolt. Geometric chevron with a power bolt through it.
  // Cyan-on-navy, very techy / scanner-feel. Reads as "power up + targeting".
  critbolt: {
    bg: '#0b1226',
    foreground: `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
        <defs>
          <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#22d3ee"/>
            <stop offset="100%" stop-color="#0ea5e9"/>
          </linearGradient>
        </defs>
        <!-- outer ring -->
        <circle cx="512" cy="512" r="372" fill="none"
                stroke="url(#ringGrad)" stroke-width="34" opacity="0.85"/>
        <!-- ring tick marks (8 cardinal/inter points) -->
        <g stroke="#67e8f9" stroke-width="14" stroke-linecap="round">
          <line x1="512" y1="108" x2="512" y2="160"/>
          <line x1="512" y1="864" x2="512" y2="916"/>
          <line x1="108" y1="512" x2="160" y2="512"/>
          <line x1="864" y1="512" x2="916" y2="512"/>
        </g>
        <!-- chevron (mod shape suggestion) -->
        <path d="M 312 592 L 512 312 L 712 592 L 632 592 L 512 432 L 392 592 Z"
              fill="#0b1226" stroke="#22d3ee" stroke-width="18" stroke-linejoin="round"/>
        <!-- crit bolt through center -->
        <path d="M 560 360 L 432 552 L 520 552 L 464 712 L 624 488 L 528 488 L 596 360 Z"
              fill="#fde047" stroke="#facc15" stroke-width="6" stroke-linejoin="round"/>
      </svg>
    `,
  },

  // Concept D: Mod Mark. Bold geometric "M" centered in an amber hex frame
  // over a cosmic navy backdrop with a subtle starfield + nebula glow.
  // Space-adjacent, brand-readable, matches the splash wordmark.
  modmark: {
    bg: '#070b18',
    foreground: `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
        <defs>
          <radialGradient id="nebula" cx="0.5" cy="0.5" r="0.55">
            <stop offset="0%" stop-color="#312e81" stop-opacity="0.85"/>
            <stop offset="60%" stop-color="#1e1b4b" stop-opacity="0.5"/>
            <stop offset="100%" stop-color="#070b18" stop-opacity="0"/>
          </radialGradient>
          <linearGradient id="frame" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#fde68a"/>
            <stop offset="55%" stop-color="#f59e0b"/>
            <stop offset="100%" stop-color="#b45309"/>
          </linearGradient>
          <linearGradient id="mGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#a5f3fc"/>
            <stop offset="55%" stop-color="#22d3ee"/>
            <stop offset="100%" stop-color="#0e7490"/>
          </linearGradient>
          <clipPath id="hexClip">
            <path d="M 512 132 L 836 312 L 836 712 L 512 892 L 188 712 L 188 312 Z"/>
          </clipPath>
        </defs>
        <!-- nebula glow + starfield, clipped to the hex interior -->
        <g clip-path="url(#hexClip)">
          <rect x="0" y="0" width="1024" height="1024" fill="url(#nebula)"/>
          <g fill="#e0f2fe">
            <circle cx="280" cy="260" r="3"/>
            <circle cx="360" cy="780" r="2.5"/>
            <circle cx="700" cy="240" r="3.5"/>
            <circle cx="780" cy="640" r="2"/>
            <circle cx="240" cy="560" r="2"/>
            <circle cx="620" cy="820" r="2.5"/>
            <circle cx="820" cy="420" r="2"/>
            <circle cx="220" cy="420" r="2.5"/>
            <circle cx="460" cy="220" r="2"/>
            <circle cx="560" cy="780" r="2"/>
          </g>
          <!-- 4-point sparkle accent -->
          <g fill="#fef3c7" opacity="0.9">
            <path d="M 760 300 L 770 320 L 790 330 L 770 340 L 760 360 L 750 340 L 730 330 L 750 320 Z"/>
            <path d="M 280 700 L 286 712 L 298 718 L 286 724 L 280 736 L 274 724 L 262 718 L 274 712 Z"/>
          </g>
        </g>
        <!-- bold geometric M -->
        <path d="M 290 730 L 290 320 L 380 320 L 512 540 L 644 320 L 734 320 L 734 730 L 644 730 L 644 470 L 540 644 L 484 644 L 380 470 L 380 730 Z"
              fill="url(#mGrad)" stroke="#0e7490" stroke-width="10" stroke-linejoin="round"/>
        <!-- M highlight -->
        <path d="M 290 320 L 380 320 L 512 540 L 484 588 Z" fill="#ecfeff" opacity="0.25"/>
        <!-- hex frame on top -->
        <path d="M 512 132 L 836 312 L 836 712 L 512 892 L 188 712 L 188 312 Z"
              fill="none" stroke="url(#frame)" stroke-width="42" stroke-linejoin="round"/>
      </svg>
    `,
  },

  // Concept C: Forge Ring. Hammer-meets-gem mark. Cleanest, most app-icon-y:
  // a slate gem in a glowing hex frame, hammer crossed behind. Reads at any size.
  forgering: {
    bg: '#111827',
    foreground: `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
        <defs>
          <linearGradient id="gem" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#a5f3fc"/>
            <stop offset="55%" stop-color="#22d3ee"/>
            <stop offset="100%" stop-color="#0e7490"/>
          </linearGradient>
          <linearGradient id="frame" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#fbbf24"/>
            <stop offset="100%" stop-color="#b45309"/>
          </linearGradient>
        </defs>
        <!-- hex frame -->
        <path d="M 512 132 L 836 312 L 836 712 L 512 892 L 188 712 L 188 312 Z"
              fill="none" stroke="url(#frame)" stroke-width="42" stroke-linejoin="round"/>
        <!-- gem -->
        <path d="M 512 280 L 716 462 L 512 744 L 308 462 Z" fill="url(#gem)"
              stroke="#0e7490" stroke-width="12" stroke-linejoin="round"/>
        <!-- gem facet highlight -->
        <path d="M 512 280 L 716 462 L 512 462 Z" fill="#ecfeff" opacity="0.35"/>
        <!-- hammer (in front, rotated) -->
        <g transform="rotate(-32 512 512)">
          <rect x="244" y="490" width="360" height="44" rx="12" fill="#3f3f46"/>
          <rect x="252" y="496" width="344" height="14" rx="6" fill="#71717a"/>
          <rect x="588" y="418" width="180" height="188" rx="22" fill="#d4d4d8"
                stroke="#18181b" stroke-width="12"/>
          <rect x="608" y="438" width="140" height="20" rx="6" fill="#fafafa" opacity="0.7"/>
        </g>
      </svg>
    `,
  },
};

const DENSITIES = [
  { dir: 'mipmap-mdpi', launcher: 48, foreground: 108 },
  { dir: 'mipmap-hdpi', launcher: 72, foreground: 162 },
  { dir: 'mipmap-xhdpi', launcher: 96, foreground: 216 },
  { dir: 'mipmap-xxhdpi', launcher: 144, foreground: 324 },
  { dir: 'mipmap-xxxhdpi', launcher: 192, foreground: 432 },
];

// Splash logo sizes per density (px). Expo's splashscreen plugin keeps these
// in drawable-*/splashscreen_logo.png. Sizes match the defaults from the
// expo-splash-screen template (200dp at each density).
const SPLASH_DENSITIES = [
  { dir: 'drawable-mdpi', size: 200 },
  { dir: 'drawable-hdpi', size: 300 },
  { dir: 'drawable-xhdpi', size: 400 },
  { dir: 'drawable-xxhdpi', size: 600 },
  { dir: 'drawable-xxxhdpi', size: 800 },
];

async function renderForeground(svg, size) {
  return sharp(Buffer.from(svg))
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function renderComposite(concept, size) {
  // Solid background + foreground centered.
  const fg = await renderForeground(concept.foreground, size);
  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: concept.bg,
    },
  })
    .composite([{ input: fg }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function renderRound(concept, size) {
  const composite = await renderComposite(concept, size);
  // Apply circular mask.
  const mask = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
       <circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="white"/>
     </svg>`
  );
  return sharp(composite)
    .composite([{ input: mask, blend: 'dest-in' }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function previewAll() {
  fs.mkdirSync(PREVIEW_DIR, { recursive: true });
  for (const [name, concept] of Object.entries(CONCEPTS)) {
    const buf = await renderComposite(concept, 512);
    const p = path.join(PREVIEW_DIR, `${name}.png`);
    fs.writeFileSync(p, buf);
    console.log('wrote', p);
  }
}

async function applyConcept(name) {
  const concept = CONCEPTS[name];
  if (!concept) {
    throw new Error(`Unknown concept: ${name}. Options: ${Object.keys(CONCEPTS).join(', ')}`);
  }

  // 1024x1024 master assets for Expo.
  const iconBuf = await renderComposite(concept, 1024);
  fs.writeFileSync(path.join(ASSETS_DIR, 'icon.png'), iconBuf);
  console.log('wrote assets/icon.png');

  const fgBuf = await renderForeground(concept.foreground, 1024);
  fs.writeFileSync(path.join(ASSETS_DIR, 'adaptive-icon.png'), fgBuf);
  console.log('wrote assets/adaptive-icon.png');

  const fav = await renderComposite(concept, 64);
  fs.writeFileSync(path.join(ASSETS_DIR, 'favicon.png'), fav);
  console.log('wrote assets/favicon.png');

  // Update Android background color so adaptive icon background matches.
  const colorsPath = path.join(RES_DIR, 'values', 'colors.xml');
  let colors = fs.readFileSync(colorsPath, 'utf8');
  colors = colors.replace(
    /<color name="iconBackground">[^<]*<\/color>/,
    `<color name="iconBackground">${concept.bg}</color>`
  );
  fs.writeFileSync(colorsPath, colors);
  console.log('updated', colorsPath);

  // Per-density mipmaps. Write .png and remove the existing .webp so the
  // new icon wins resolution.
  for (const { dir, launcher, foreground } of DENSITIES) {
    const dirPath = path.join(RES_DIR, dir);
    fs.mkdirSync(dirPath, { recursive: true });

    const launcherBuf = await renderComposite(concept, launcher);
    fs.writeFileSync(path.join(dirPath, 'ic_launcher.png'), launcherBuf);

    const roundBuf = await renderRound(concept, launcher);
    fs.writeFileSync(path.join(dirPath, 'ic_launcher_round.png'), roundBuf);

    const fgDensityBuf = await renderForeground(concept.foreground, foreground);
    fs.writeFileSync(path.join(dirPath, 'ic_launcher_foreground.png'), fgDensityBuf);

    for (const stale of ['ic_launcher.webp', 'ic_launcher_round.webp', 'ic_launcher_foreground.webp']) {
      const stalePath = path.join(dirPath, stale);
      if (fs.existsSync(stalePath)) fs.unlinkSync(stalePath);
    }
    console.log('wrote', dir);
  }

  // Splash: a centered logo on transparent for drawable-*, plus the
  // master assets/splash.png with the brand wordmark beneath the mark.
  const splashSvg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
      ${concept.foreground.replace(/<svg[^>]*>|<\/svg>/g, '')}
    </svg>
  `;
  for (const { dir, size } of SPLASH_DENSITIES) {
    const dirPath = path.join(RES_DIR, dir);
    fs.mkdirSync(dirPath, { recursive: true });
    const buf = await renderForeground(splashSvg, size);
    fs.writeFileSync(path.join(dirPath, 'splashscreen_logo.png'), buf);
    console.log('wrote splash', dir);
  }

  // Master splash.png: full-bleed dark canvas with the mark + wordmark.
  const masterSplash = await renderSplashMaster(concept, 1242, 2688);
  fs.writeFileSync(path.join(ASSETS_DIR, 'splash.png'), masterSplash);
  console.log('wrote assets/splash.png');

  console.log('\nDone. Now rebundle + rebuild + reinstall.');
}

async function renderSplashMaster(concept, width, height) {
  const markSize = Math.round(Math.min(width, height) * 0.5);
  const markX = Math.round((width - markSize) / 2);
  const markY = Math.round(height * 0.36);
  const mark = await renderForeground(concept.foreground, markSize);
  const wordSvg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="200">
      <text x="50%" y="120" text-anchor="middle"
            font-family="Helvetica, Arial, sans-serif"
            font-size="140" font-weight="800" fill="#f8fafc"
            letter-spacing="6">ModForge</text>
      <text x="50%" y="180" text-anchor="middle"
            font-family="Helvetica, Arial, sans-serif"
            font-size="40" font-weight="600" fill="#94a3b8"
            letter-spacing="14">MOD OPTIMIZER</text>
    </svg>
  `;
  const word = await sharp(Buffer.from(wordSvg)).png().toBuffer();
  return sharp({
    create: { width, height, channels: 4, background: concept.bg },
  })
    .composite([
      { input: mark, top: markY, left: markX },
      { input: word, top: markY + markSize + 40, left: 0 },
    ])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === 'preview') {
  previewAll().catch(err => { console.error(err); process.exit(1); });
} else if (cmd === 'apply') {
  applyConcept(arg).catch(err => { console.error(err); process.exit(1); });
} else {
  console.error('Usage: node tools/icon-gen.js preview | apply <hexanvil|critbolt|forgering>');
  process.exit(1);
}
