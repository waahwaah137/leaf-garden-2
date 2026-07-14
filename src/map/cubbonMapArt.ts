// A stylized vector recreation of the illustrated Cubbon Park map (evokes the reference: a cream
// field with a pink frame, a mint-green park, cream paths, scattered trees, the six landmarks as
// little pink/teal/yellow icons + labels, and a CUBBON PARK · BANGALORE banner). Drawn as a scalable
// SVG so no image asset is needed. The interactive markers are overlaid separately by cubbonMap.ts.
// viewBox is 667 × 1000 (portrait), matching the map field's aspect ratio.

const C = {
  cream: '#f3efe1',
  creamLine: '#e7e0cb',
  frame: '#c8396f',
  frameSoft: '#e0d3b8',
  park: '#84ddb0',
  parkEdge: '#54c491',
  path: '#f3efe1',
  tree: '#3cb884',
  treeDark: '#2c9a6c',
  bush: '#66cf9a',
  pink: '#ec5591',
  pinkDeep: '#c2356f',
  yellow: '#f6c944',
  yellowDeep: '#dca42a',
  teal: '#33b9b0',
  tealDeep: '#1f978f',
  ink: '#7a2a55',
};

const X = 667;
const Y = 1000;
const px = (n: number) => Math.round(n * X);
const py = (n: number) => Math.round(n * Y);

/** A little rounded tree (darker crown over a lighter base). */
function tree(nx: number, ny: number, r = 15): string {
  const x = px(nx);
  const y = py(ny);
  return `<g>
    <ellipse cx="${x}" cy="${y + r * 0.7}" rx="${r * 0.55}" ry="${r * 0.3}" fill="rgba(0,0,0,0.06)"/>
    <circle cx="${x}" cy="${y}" r="${r}" fill="${C.tree}"/>
    <circle cx="${x - r * 0.3}" cy="${y - r * 0.35}" r="${r * 0.62}" fill="${C.treeDark}"/>
  </g>`;
}

/** A tiny grass tuft. */
function bush(nx: number, ny: number): string {
  const x = px(nx);
  const y = py(ny);
  return `<path d="M${x - 6} ${y} q3 -8 6 0 q3 -8 6 0" fill="none" stroke="${C.bush}" stroke-width="3" stroke-linecap="round"/>`;
}

/** A neoclassical building (High Court / State Library): pediment + columns + base + flag. */
function building(nx: number, ny: number, w: number, fill: string, deep: string, flag = false): string {
  const cx = px(nx);
  const cy = py(ny);
  const h = w * 0.78;
  const left = cx - w / 2;
  const top = cy - h / 2;
  const colGap = w / 5;
  let cols = '';
  for (let i = 0; i < 4; i++) {
    const x = left + colGap * (i + 0.5) + colGap * 0.15;
    cols += `<rect x="${x}" y="${top + h * 0.34}" width="${colGap * 0.4}" height="${h * 0.4}" fill="${deep}"/>`;
  }
  const flagEl = flag
    ? `<line x1="${cx}" y1="${top - h * 0.28}" x2="${cx}" y2="${top}" stroke="${deep}" stroke-width="3"/>
       <path d="M${cx} ${top - h * 0.28} l${w * 0.16} ${h * 0.06} l${-w * 0.16} ${h * 0.06} z" fill="${C.pink}"/>`
    : '';
  return `<g>
    ${flagEl}
    <polygon points="${left - w * 0.06},${top + h * 0.34} ${cx},${top} ${left + w + w * 0.06},${top + h * 0.34}" fill="${fill}" stroke="${deep}" stroke-width="2.5"/>
    <rect x="${left}" y="${top + h * 0.34}" width="${w}" height="${h * 0.5}" fill="${fill}" stroke="${deep}" stroke-width="2.5"/>
    ${cols}
    <rect x="${left - w * 0.06}" y="${top + h * 0.84}" width="${w * 1.12}" height="${h * 0.14}" rx="3" fill="${fill}" stroke="${deep}" stroke-width="2.5"/>
  </g>`;
}

/** A temple gopuram (stepped yellow tiers with a finial). */
function temple(nx: number, ny: number, w: number): string {
  const cx = px(nx);
  const cy = py(ny);
  const base = cy + w * 0.5;
  let tiers = '';
  for (let i = 0; i < 3; i++) {
    const tw = w * (1 - i * 0.24);
    const ty = base - w * 0.3 - i * w * 0.28;
    tiers += `<polygon points="${cx - tw / 2},${ty + w * 0.28} ${cx},${ty} ${cx + tw / 2},${ty + w * 0.28}" fill="${C.yellow}" stroke="${C.yellowDeep}" stroke-width="2.5"/>`;
  }
  return `<g>
    <rect x="${cx - w * 0.34}" y="${base - w * 0.28}" width="${w * 0.68}" height="${w * 0.3}" fill="${C.yellow}" stroke="${C.yellowDeep}" stroke-width="2.5"/>
    ${tiers}
    <circle cx="${cx}" cy="${base - w * 0.86}" r="4" fill="${C.pink}"/>
  </g>`;
}

/** A gate: two posts + a lintel, optionally an "M" (metro). */
function gate(nx: number, ny: number, w: number, metro = false): string {
  const cx = px(nx);
  const cy = py(ny);
  const h = w * 0.7;
  const post = w * 0.22;
  const sign = metro
    ? `<rect x="${cx - w * 0.16}" y="${cy - h * 0.62}" width="${w * 0.32}" height="${w * 0.32}" rx="4" fill="${C.tealDeep}"/>
       <text x="${cx}" y="${cy - h * 0.4}" text-anchor="middle" font-family="Arial, sans-serif" font-size="${w * 0.24}" font-weight="700" fill="#fff">M</text>`
    : '';
  return `<g>
    ${sign}
    <rect x="${cx - w / 2}" y="${cy - h * 0.34}" width="${w}" height="${post * 0.7}" rx="3" fill="${C.teal}" stroke="${C.tealDeep}" stroke-width="2.5"/>
    <rect x="${cx - w / 2}" y="${cy - h * 0.2}" width="${post}" height="${h * 0.5}" rx="3" fill="${C.teal}" stroke="${C.tealDeep}" stroke-width="2.5"/>
    <rect x="${cx + w / 2 - post}" y="${cy - h * 0.2}" width="${post}" height="${h * 0.5}" rx="3" fill="${C.teal}" stroke="${C.tealDeep}" stroke-width="2.5"/>
  </g>`;
}

/** The central garden: a mint disc ringed in cream with a little flower cluster + sparkles. */
function centralGarden(nx: number, ny: number, r: number): string {
  const cx = px(nx);
  const cy = py(ny);
  const petal = (a: number, col: string) =>
    `<circle cx="${cx + Math.cos(a) * r * 0.32}" cy="${cy + Math.sin(a) * r * 0.32}" r="${r * 0.2}" fill="${col}"/>`;
  let petals = '';
  const cols = [C.pink, C.yellow, '#ff8a3d', C.pink, C.yellow, '#ff8a3d'];
  for (let i = 0; i < 6; i++) petals += petal((i / 6) * Math.PI * 2, cols[i]);
  const spark = (dx: number, dy: number) =>
    `<path d="M${cx + dx} ${cy + dy - 6} l2 4 4 2 -4 2 -2 4 -2 -4 -4 -2 4 -2 z" fill="${C.yellow}"/>`;
  return `<g>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="${C.park}" stroke="${C.path}" stroke-width="6"/>
    <circle cx="${cx}" cy="${cy}" r="${r * 0.72}" fill="${C.parkEdge}" opacity="0.5"/>
    ${petals}
    <circle cx="${cx}" cy="${cy}" r="${r * 0.16}" fill="#ff8a3d"/>
    ${spark(-r * 0.7, -r * 0.4)} ${spark(r * 0.7, r * 0.5)} ${spark(r * 0.75, -r * 0.5)}
  </g>`;
}

/** A cream label pill with pink text, centred at (nx,ny). */
function label(nx: number, ny: number, text: string): string {
  const cx = px(nx);
  const cy = py(ny);
  const w = text.length * 8.2 + 20;
  return `<g>
    <rect x="${cx - w / 2}" y="${cy - 12}" width="${w}" height="24" rx="7" fill="${C.cream}" stroke="${C.frame}" stroke-width="2"/>
    <text x="${cx}" y="${cy + 4.5}" text-anchor="middle" font-family="Arial, sans-serif" font-size="12" font-weight="700" letter-spacing="0.5" fill="${C.pinkDeep}">${text}</text>
  </g>`;
}

const TREES: Array<[number, number]> = [
  [0.13, 0.24], [0.27, 0.2], [0.62, 0.29], [0.7, 0.36], [0.86, 0.27], [0.88, 0.42], [0.8, 0.5],
  [0.66, 0.44], [0.6, 0.57], [0.72, 0.6], [0.85, 0.58], [0.3, 0.42], [0.23, 0.36], [0.12, 0.44],
  [0.3, 0.62], [0.42, 0.64], [0.54, 0.68], [0.28, 0.71], [0.4, 0.8], [0.56, 0.82], [0.69, 0.78],
  [0.82, 0.72], [0.35, 0.87], [0.62, 0.88],
];
const BUSHES: Array<[number, number]> = [
  [0.2, 0.47], [0.5, 0.4], [0.74, 0.5], [0.44, 0.56], [0.34, 0.76], [0.66, 0.66], [0.5, 0.86],
];

/** Returns the full illustrated-map SVG as a string, sized to the field via CSS. */
export function buildCubbonMapSvg(): string {
  return `<svg viewBox="0 0 ${X} ${Y}" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Illustrated map of Cubbon Park">
    <rect x="0" y="0" width="${X}" height="${Y}" fill="${C.cream}"/>
    <rect x="14" y="14" width="${X - 28}" height="${Y - 28}" rx="16" fill="none" stroke="${C.frame}" stroke-width="4"/>
    <rect x="26" y="26" width="${X - 52}" height="${Y - 52}" rx="12" fill="none" stroke="${C.frame}" stroke-width="1.5" stroke-dasharray="2 7" opacity="0.7"/>

    <!-- park body -->
    <path d="M96 168 Q120 150 200 156 T360 150 Q470 146 520 168 Q600 200 596 320 T590 520 Q596 660 540 740 Q470 830 340 838 Q210 846 150 760 Q86 660 90 500 T96 168 Z"
      fill="${C.park}" stroke="${C.parkEdge}" stroke-width="4"/>

    <!-- paths: gates + landmarks radiate to the central garden -->
    <g fill="none" stroke="${C.path}" stroke-width="18" stroke-linecap="round" stroke-linejoin="round">
      <path d="M${px(0.5)} ${py(0.3)} L${px(0.5)} ${py(0.5)}"/>
      <path d="M${px(0.76)} ${py(0.16)} Q${px(0.66)} ${py(0.34)} ${px(0.52)} ${py(0.48)}"/>
      <path d="M${px(0.18)} ${py(0.55)} Q${px(0.32)} ${py(0.52)} ${px(0.47)} ${py(0.5)}"/>
      <path d="M${px(0.2)} ${py(0.73)} Q${px(0.34)} ${py(0.64)} ${px(0.47)} ${py(0.53)}"/>
      <path d="M${px(0.84)} ${py(0.66)} Q${px(0.68)} ${py(0.6)} ${px(0.54)} ${py(0.53)}"/>
      <path d="M${px(0.5)} ${py(0.14)} L${px(0.5)} ${py(0.28)}"/>
      <path d="M${px(0.5)} ${py(0.53)} Q${px(0.46)} ${py(0.72)} ${px(0.5)} ${py(0.84)}"/>
    </g>

    ${BUSHES.map(([a, b]) => bush(a, b)).join('')}
    ${TREES.map(([a, b]) => tree(a, b)).join('')}

    ${centralGarden(0.5, 0.5, 52)}
    ${building(0.76, 0.14, 150, C.pink, C.pinkDeep, true)}
    ${building(0.48, 0.3, 118, C.yellow, C.yellowDeep, false)}
    ${temple(0.17, 0.73, 92)}
    ${gate(0.17, 0.54, 96, true)}
    ${gate(0.85, 0.66, 96, false)}

    ${label(0.47, 0.21, 'STATE LIBRARY')}
    ${label(0.78, 0.22, 'HIGH COURT')}
    ${label(0.5, 0.6, 'CENTRAL GARDEN')}
    ${label(0.16, 0.61, 'METRO STATION GATE')}
    ${label(0.16, 0.8, 'TEMPLE')}
    ${label(0.85, 0.72, 'MG ROAD GATE')}

    <!-- title banner -->
    <g>
      <rect x="${px(0.16)}" y="${py(0.9)}" width="${px(0.68)}" height="${py(0.07)}" rx="12" fill="${C.cream}" stroke="${C.frame}" stroke-width="3"/>
      <text x="${px(0.5)}" y="${py(0.932)}" text-anchor="middle" font-family="Arial, sans-serif" font-size="34" font-weight="800" letter-spacing="1.5" fill="${C.pinkDeep}">CUBBON PARK</text>
      <text x="${px(0.5)}" y="${py(0.956)}" text-anchor="middle" font-family="Arial, sans-serif" font-size="14" font-weight="700" letter-spacing="4" fill="${C.frame}">BANGALORE</text>
    </g>
  </svg>`;
}
