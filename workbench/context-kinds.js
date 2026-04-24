/* ================================================================
   context-kinds.js
   Type-aware context pane for the Pytheum workbench.

   Exposes window.ContextKinds.render(kind, cursorIdx, { N })
   which returns HTML for the right pane. The main workbench file
   swaps #rp-econ for #rp-kind whenever the active query's kind !== 'econ'.

   Kinds: 'esports' (Dota 2), 'sports_trad' (NFL), 'nba', 'football'.
   All maps are schematic — colored geometry + mono labels, no team
   logos or game assets.
   ================================================================ */
(function () {

  // ========================================================
  // Shared palette (matches workbench dark theme)
  // ========================================================
  const CYAN  = '#7fc8ff';
  const GREEN = '#52e9a7';
  const RED   = '#f06b6b';
  const GOLD  = '#d5b65a';
  const INK   = '#e8ecef';
  const MUTED = '#8a9199';
  const MUTED2= '#5a6068';
  const PAPER = 'rgba(15,18,21,0.6)';

  function fmtK(n) {
    if (Math.abs(n) >= 1000) return (n / 1000).toFixed(1) + 'k';
    return String(n);
  }
  function seed(n) { n = (Math.sin(n) * 43758.5453) % 1; return n < 0 ? n + 1 : n; }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // ========================================================
  // DOTA 2 — schematic minimap matching reference landmarks
  //   Radiant bottom-left, Dire top-right, river SW→NE,
  //   three lanes (top/mid/bot), Roshan pit top-side of river,
  //   ancients at the back of each base.
  // Coordinate space: 0..200 square.
  // ========================================================

  // Towers — positions approximate real map geometry
  const DOTA_TOWERS = [
    // Radiant bottom-left quadrant
    // safe (bot) lane — runs along bottom
    { s:'r', lane:'bot', tier:1, x:150, y:182 },
    { s:'r', lane:'bot', tier:2, x:105, y:182 },
    { s:'r', lane:'bot', tier:3, x: 58, y:175 },
    // mid lane — diagonal, defender tower in middle of base
    { s:'r', lane:'mid', tier:1, x: 95, y:125 },
    { s:'r', lane:'mid', tier:2, x: 70, y:150 },
    { s:'r', lane:'mid', tier:3, x: 52, y:165 },
    // off (top) lane — runs up the left side
    { s:'r', lane:'top', tier:1, x: 18, y: 58 },
    { s:'r', lane:'top', tier:2, x: 20, y:100 },
    { s:'r', lane:'top', tier:3, x: 30, y:148 },
    // Radiant base T4s + ancient
    { s:'r', lane:'base', tier:4, x: 32, y:178 },
    { s:'r', lane:'base', tier:4, x: 42, y:188 },
    { s:'r', lane:'anc',  tier:5, x: 24, y:188 },

    // Dire top-right quadrant (mirror)
    // safe (top) lane — runs across the top
    { s:'d', lane:'top', tier:1, x: 50, y: 18 },
    { s:'d', lane:'top', tier:2, x: 95, y: 18 },
    { s:'d', lane:'top', tier:3, x:142, y: 25 },
    // mid
    { s:'d', lane:'mid', tier:1, x:105, y: 75 },
    { s:'d', lane:'mid', tier:2, x:130, y: 50 },
    { s:'d', lane:'mid', tier:3, x:148, y: 35 },
    // off (bot) lane
    { s:'d', lane:'bot', tier:1, x:182, y:142 },
    { s:'d', lane:'bot', tier:2, x:180, y:100 },
    { s:'d', lane:'bot', tier:3, x:170, y: 52 },
    // Dire base T4s + ancient
    { s:'d', lane:'base', tier:4, x:168, y: 22 },
    { s:'d', lane:'base', tier:4, x:158, y: 12 },
    { s:'d', lane:'anc',  tier:5, x:176, y: 12 },
  ];

  const ROSH = { x: 82, y: 78 }; // top side of river

  const RADIANT = [
    { slot:1, role:'Carry',    hero:'PA',   nw:18240, k:7, d:2, a:4,  cs:212 },
    { slot:2, role:'Mid',      hero:'Puck', nw:14820, k:5, d:3, a:8,  cs:168 },
    { slot:3, role:'Offlane',  hero:'Mars', nw:12410, k:3, d:4, a:11, cs:140 },
    { slot:4, role:'Soft Sup', hero:'Hood', nw: 9120, k:2, d:6, a:13, cs: 38 },
    { slot:5, role:'Hard Sup', hero:'Dzk',  nw: 7840, k:1, d:7, a:14, cs: 22 },
  ];
  const DIRE = [
    { slot:1, role:'Carry',    hero:'TB',   nw:15480, k:4, d:5, a:3,  cs:188 },
    { slot:2, role:'Mid',      hero:'Inv',  nw:13610, k:6, d:4, a:6,  cs:172 },
    { slot:3, role:'Offlane',  hero:'Brew', nw:11020, k:2, d:4, a:9,  cs:132 },
    { slot:4, role:'Soft Sup', hero:'ES',   nw: 8420, k:3, d:5, a:11, cs: 41 },
    { slot:5, role:'Hard Sup', hero:'CM',   nw: 6930, k:0, d:8, a:10, cs: 18 },
  ];

  // Per-minute rough anchor positions for each hero — so when you scrub,
  // heroes drift along plausible paths (laning → fighting → pushing).
  function heroAnchor(side, slot, minute) {
    // Returns {x,y} in 0..200. Radiant hero anchors:
    const R = {
      1: [ [150,178],[120,165],[95,140],[80,120],[105,150],[60,160],[60,160] ],   // carry: safe lane → rotate → push
      2: [ [95,118],[90,100],[100,90],[110,80],[100,100],[115,85],[130,70] ],      // mid
      3: [ [25,70],[25,95],[40,95],[65,100],[75,95],[90,75],[110,55] ],            // offlane → rotate
      4: [ [70,155],[95,135],[75,100],[90,85],[110,95],[95,105],[115,85] ],        // roam support
      5: [ [140,175],[155,175],[130,150],[110,140],[90,130],[85,100],[90,85] ],    // sup rotate up
    };
    const D = {
      1: [ [50,22],[78,32],[105,55],[118,78],[90,52],[135,60],[135,60] ],
      2: [ [102,78],[108,88],[100,100],[92,108],[100,90],[85,108],[70,125] ],
      3: [ [175,130],[172,110],[155,100],[130,95],[120,98],[105,120],[88,138] ],
      4: [ [128,45],[102,68],[122,95],[108,110],[88,100],[98,92],[82,108] ],
      5: [ [58,18],[40,25],[68,45],[88,55],[108,65],[112,92],[108,108] ],
    };
    const table = side === 'r' ? R : D;
    const row = table[slot];
    const pos = clamp(minute / 10, 0, row.length - 1);
    const i0 = Math.floor(pos);
    const i1 = Math.min(row.length - 1, i0 + 1);
    const t = pos - i0;
    return {
      x: row[i0][0] * (1 - t) + row[i1][0] * t,
      y: row[i0][1] * (1 - t) + row[i1][1] * t,
    };
  }

  function dotaSnapshot(idx, N) {
    const t = idx / Math.max(1, N - 1);
    const gameSec = Math.round(t * 60 * 60);
    const minute = gameSec / 60;

    const radMult = 0.7 + t * 2.5 + (t > 0.65 ? (t - 0.65) * 2.8 : 0);
    const direMult = 0.95 + t * 2.0 + (t < 0.55 ? (0.55 - t) * 1.0 : 0);

    const mkTrail = (side, slot) => [1, 2].map(back => {
      const p = heroAnchor(side, slot, Math.max(0, minute - back * 2.5));
      return { x: p.x, y: p.y };
    });
    const radiant = RADIANT.map(h => {
      const a = heroAnchor('r', h.slot, minute);
      const jx = (seed(h.slot * 31 + idx) - 0.5) * 8;
      const jy = (seed(h.slot * 47 + idx) - 0.5) * 8;
      const hp = Math.max(0.18, Math.min(1.0, 0.92 - seed(h.slot * 89 + idx) * 0.58));
      return { ...h, nw: Math.round(h.nw * radMult), x: clamp(a.x + jx, 10, 190), y: clamp(a.y + jy, 10, 190), hp, trail: mkTrail('r', h.slot) };
    });
    const dire = DIRE.map(h => {
      const a = heroAnchor('d', h.slot, minute);
      const jx = (seed(h.slot * 53 + idx) - 0.5) * 8;
      const jy = (seed(h.slot * 71 + idx) - 0.5) * 8;
      const hp = Math.max(0.18, Math.min(1.0, 0.92 - seed(h.slot * 103 + idx) * 0.58));
      return { ...h, nw: Math.round(h.nw * direMult), x: clamp(a.x + jx, 10, 190), y: clamp(a.y + jy, 10, 190), hp, trail: mkTrail('d', h.slot) };
    });

    // Tower fall schedule (minute-of-game). Anything unset never falls.
    const fallAt = {
      'd-bot-1': 11, 'r-top-1': 14, 'r-mid-1': 22, 'd-top-1': 26, 'd-mid-1': 29,
      'r-top-2': 30, 'd-bot-2': 34, 'r-mid-2': 41, 'd-mid-2': 46,
      'd-bot-3': 48,
    };
    const towers = DOTA_TOWERS.map(tw => {
      const key = `${tw.s}-${tw.lane}-${tw.tier}`;
      const fall = fallAt[key];
      let hp;
      if (fall != null && minute >= fall) hp = 0;
      else if (fall != null && minute >= fall - 1.5) hp = Math.round((1 - (minute - (fall - 1.5)) / 1.5) * 100);
      else hp = 100;
      return { ...tw, hp };
    });

    const radNw = radiant.reduce((s, h) => s + h.nw, 0);
    const direNw = dire.reduce((s, h) => s + h.nw, 0);

    let rosh;
    if (minute < 15) rosh = { state: 'alive', note: 'first spawn, unclaimed' };
    else if (minute < 26) rosh = { state: 'dead', note: 'killed by Radiant @15:32, aegis on PA' };
    else if (minute < 38) rosh = { state: 'respawn', note: 'respawn window 26–37m' };
    else if (minute < 48) rosh = { state: 'dead', note: 'killed by Dire @38:10, cheese' };
    else rosh = { state: 'respawn', note: 'respawn window open' };

    return { minute, gameSec, radiant, dire, towers, radNw, direNw, rosh };
  }

  function dotaMinimapSVG(snap) {
    const { radiant, dire, towers, rosh } = snap;

    const tower = (tw) => {
      const c = tw.s === 'r' ? GREEN : RED;
      if (tw.lane === 'anc') {
        const alive = tw.hp > 0;
        const s = 5;
        return `<g>
          <polygon points="${tw.x},${tw.y-s} ${tw.x+s},${tw.y} ${tw.x},${tw.y+s} ${tw.x-s},${tw.y}"
            fill="${alive ? c : 'none'}" fill-opacity="0.75" stroke="${c}" stroke-width="0.9"/>
          ${alive ? `<polygon points="${tw.x},${tw.y-s-2} ${tw.x+s+2},${tw.y} ${tw.x},${tw.y+s+2} ${tw.x-s-2},${tw.y}" fill="none" stroke="${c}" stroke-width="0.3" stroke-opacity="0.45"/>` : ''}
        </g>`;
      }
      if (tw.hp <= 0) {
        return `<g stroke="${c}" stroke-width="0.7" opacity="0.35">
          <line x1="${tw.x-2.8}" y1="${tw.y-2.8}" x2="${tw.x+2.8}" y2="${tw.y+2.8}"/>
          <line x1="${tw.x+2.8}" y1="${tw.y-2.8}" x2="${tw.x-2.8}" y2="${tw.y+2.8}"/>
        </g>`;
      }
      const alpha = 0.35 + (tw.hp / 100) * 0.55;
      return `<rect x="${tw.x-3}" y="${tw.y-3}" width="6" height="6" rx="0.5"
        fill="${c}" fill-opacity="${alpha}" stroke="${c}" stroke-width="0.5"/>`;
    };

    const hero = (h, col) => {
      const r = 4.2;
      const circ = 2 * Math.PI * r;
      const off = circ * (1 - h.hp);
      return `
      <g>
        ${h.trail.map((tp, i) => `<circle cx="${tp.x}" cy="${tp.y}" r="1.6" fill="${col}" opacity="${0.26 - i * 0.1}"/>`).join('')}
        <circle cx="${h.x}" cy="${h.y}" r="${r}" fill="none" stroke="${col}" stroke-width="0.6" stroke-opacity="0.22"/>
        <circle cx="${h.x}" cy="${h.y}" r="${r}" fill="none" stroke="${col}" stroke-width="1.1"
                stroke-dasharray="${circ.toFixed(2)}" stroke-dashoffset="${off.toFixed(2)}"
                transform="rotate(-90 ${h.x} ${h.y})" stroke-linecap="round"/>
        <circle cx="${h.x}" cy="${h.y}" r="3.0" fill="${col}" stroke="#0b0e10" stroke-width="0.7"/>
        <text x="${h.x}" y="${h.y + 1.3}" fill="#0b0e10" font-family="JetBrains Mono" font-size="3.4" text-anchor="middle" font-weight="700">${h.slot}</text>
      </g>`;
    };

    return `
      <svg viewBox="0 0 200 200" class="mm-svg" preserveAspectRatio="xMidYMid meet">
        <defs>
          <pattern id="mm-grid" width="20" height="20" patternUnits="userSpaceOnUse">
            <path d="M 20 0 L 0 0 0 20" fill="none" stroke="rgba(232,236,239,0.06)" stroke-width="0.4"/>
          </pattern>
        </defs>

        <!-- Base + grid -->
        <rect width="200" height="200" fill="${PAPER}"/>
        <rect width="200" height="200" fill="url(#mm-grid)"/>

        <!-- Territory tints: diagonal halves (Radiant bot-left, Dire top-right) -->
        <polygon points="0,0 0,200 200,200" fill="${GREEN}" fill-opacity="0.05"/>
        <polygon points="0,0 200,0 200,200" fill="${RED}" fill-opacity="0.05"/>

        <!-- River (diagonal band NW → SE, perpendicular to Rad↔Dire axis) -->
        <polygon points="10,-10 -10,10 190,210 210,190" fill="${CYAN}" fill-opacity="0.09"
          stroke="${CYAN}" stroke-width="0.4" stroke-opacity="0.35"/>

        <!-- Lanes (dashed guides) -->
        <g stroke="rgba(232,236,239,0.2)" stroke-width="0.7" fill="none" stroke-dasharray="2,3">
          <!-- Top (radiant off → dire safe): left up, across top -->
          <path d="M 30 178 L 20 80 L 50 20 L 170 22"/>
          <!-- Mid: SW → NE diagonal -->
          <path d="M 42 172 L 170 36"/>
          <!-- Bot (radiant safe → dire off): across bottom, up right -->
          <path d="M 50 182 L 150 182 L 182 140 L 178 40"/>
        </g>

        <!-- Roshan pit -->
        <g>
          <circle cx="${ROSH.x}" cy="${ROSH.y}" r="7" fill="none" stroke="${GOLD}" stroke-width="0.8" stroke-dasharray="1.4,1.4"/>
          <text x="${ROSH.x}" y="${ROSH.y - 9}" fill="${GOLD}" font-family="JetBrains Mono" font-size="5.2" text-anchor="middle" letter-spacing="0.12em">RSH</text>
          ${rosh.state === 'alive' ? `<circle cx="${ROSH.x}" cy="${ROSH.y}" r="2.4" fill="${GOLD}"/>` : ''}
          ${rosh.state === 'respawn' ? `<circle cx="${ROSH.x}" cy="${ROSH.y}" r="2.4" fill="none" stroke="${GOLD}" stroke-width="0.6" stroke-dasharray="1,1"/>` : ''}
        </g>

        <!-- Towers -->
        ${towers.map(tower).join('')}

        <!-- Heroes on top -->
        ${radiant.map(h => hero(h, GREEN)).join('')}
        ${dire.map(h => hero(h, RED)).join('')}

        <!-- Corner labels -->
        <text x="6" y="195" fill="${GREEN}" font-family="JetBrains Mono" font-size="6" letter-spacing="0.14em">RADIANT</text>
        <text x="194" y="9" fill="${RED}" font-family="JetBrains Mono" font-size="6" letter-spacing="0.14em" text-anchor="end">DIRE</text>

        <!-- Compass hint -->
        <g opacity="0.4" transform="translate(185, 188)">
          <circle r="6" fill="none" stroke="${MUTED}" stroke-width="0.4"/>
          <text y="-7" fill="${MUTED}" font-family="JetBrains Mono" font-size="4" text-anchor="middle">N</text>
        </g>
      </svg>`;
  }

  function renderDotaPane(cursorIdx, ctx) {
    const { N } = ctx;
    const s = dotaSnapshot(cursorIdx, N);
    const mins = Math.floor(s.minute);
    const secs = Math.round((s.minute - mins) * 60);
    const clock = `${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;

    const diff = s.radNw - s.direNw;
    const total = s.radNw + s.direNw;
    const radPct = (s.radNw / total) * 100;
    const advSide = diff >= 0 ? 'RAD' : 'DIRE';
    const advCol  = diff >= 0 ? GREEN : RED;
    const nwDiffStr = (diff >= 0 ? '+' : '−') + fmtK(Math.abs(diff));

    const heroRow = (h, side) => {
      const col = side === 'r' ? GREEN : RED;
      return `
        <div class="hero-row">
          <span class="slot" style="color:${col}">${h.slot}</span>
          <span class="hero">${h.hero}</span>
          <span class="role">${h.role}</span>
          <span class="nw">${fmtK(h.nw)}</span>
          <span class="kda">${h.k}/${h.d}/${h.a}</span>
          <span class="cs">${h.cs}</span>
        </div>`;
    };

    const roshPill = s.rosh.state === 'alive' ? 'ROSH ALIVE'
                   : s.rosh.state === 'respawn' ? 'ROSH RESPAWN'
                   : 'ROSH DEAD';
    const roshCol = s.rosh.state === 'alive' ? GOLD : (s.rosh.state === 'respawn' ? GOLD : MUTED);

    return `
      <div class="ctx-stamp">
        <div>
          <div class="ts-big" id="ctx-ts">${clock}</div>
          <div class="cross" id="ctx-sync">game clock · ${advSide} ${nwDiffStr} net worth</div>
        </div>
        <div class="ts-meta">GAME 3 / TI15 GF</div>
      </div>

      <div class="ctx-block esports-nwbar">
        <div class="ctx-head">
          <div class="name"><span class="n">Net worth</span>${fmtK(total)} total</div>
          <div class="delta" style="color:${advCol}">${advSide} ${nwDiffStr}</div>
        </div>
        <div class="nwbar">
          <div class="nwbar-fill-r" style="width:${radPct}%; background:${GREEN}"></div>
          <div class="nwbar-mid"></div>
        </div>
        <div class="nwbar-labels">
          <span style="color:${GREEN}">${fmtK(s.radNw)}</span>
          <span style="color:${RED}">${fmtK(s.direNw)}</span>
        </div>
      </div>

      <div class="ctx-block">
        <div class="ctx-head">
          <div class="name"><span class="n">Map</span>positions</div>
          <div class="delta" style="color:${roshCol}">${roshPill}</div>
        </div>
        <div class="mm-wrap">${dotaMinimapSVG(s)}</div>
        <div class="mm-note">${s.rosh.note}</div>
      </div>

      <div class="ctx-block">
        <div class="ctx-head">
          <div class="name"><span class="n" style="color:${GREEN}">Radiant</span>5 heroes</div>
          <div class="delta">nw ${fmtK(s.radNw)}</div>
        </div>
        <div class="hero-list">
          <div class="hero-head"><span>#</span><span>HERO</span><span>ROLE</span><span>NW</span><span>K/D/A</span><span>CS</span></div>
          ${s.radiant.map(h => heroRow(h, 'r')).join('')}
        </div>
      </div>

      <div class="ctx-block">
        <div class="ctx-head">
          <div class="name"><span class="n" style="color:${RED}">Dire</span>5 heroes</div>
          <div class="delta">nw ${fmtK(s.direNw)}</div>
        </div>
        <div class="hero-list">
          <div class="hero-head"><span>#</span><span>HERO</span><span>ROLE</span><span>NW</span><span>K/D/A</span><span>CS</span></div>
          ${s.dire.map(h => heroRow(h, 'd')).join('')}
        </div>
      </div>

      <div class="ctx-block">
        <div class="ctx-head">
          <div class="name"><span class="n">Signal</span>news / social</div>
          <div class="delta pos">+${142 + (cursorIdx % 40)}/min</div>
        </div>
        ${dotaEvents(cursorIdx, N).map(e => `
          <div class="hl-item"><div class="src">${e.src}</div><div class="body">${e.txt}<span class="tm">${e.tm}</span></div></div>
        `).join('')}
      </div>
    `;
  }

  function dotaEvents(idx, N) {
    const min = Math.floor((idx / Math.max(1, N - 1)) * 60);
    const all = [
      { min:  8, src:'tw',  txt:'first blood mid, Puck dodges 3 hooks' },
      { min: 14, src:'DT',  txt:'Radiant top T1 falls, net worth even' },
      { min: 22, src:'RED', txt:'r/DotA2 megathread: "PA is cracked"' },
      { min: 31, src:'tw',  txt:'Dire bot T2 taken, teamfight 4-1 Radiant' },
      { min: 38, src:'DT',  txt:'Roshan dance, Radiant secures aegis' },
      { min: 44, src:'REU', txt:'betting odds shift 0.61 → 0.72 Radiant' },
      { min: 51, src:'tw',  txt:'Puck blink-out baits Dire into smoke trap' },
      { min: 55, src:'RED', txt:'r/DotA2 "GG this is over"' },
    ];
    return all
      .map(e => ({ ...e, delta: e.min - min }))
      .sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta))
      .slice(0, 3)
      .sort((a, b) => a.min - b.min)
      .map(e => ({ ...e, tm: `${String(e.min).padStart(2,'0')}:00 · ${e.delta === 0 ? 'now' : (e.delta > 0 ? '+' : '') + e.delta + 'm'}` }));
  }

  // ========================================================
  // NFL — 2D field schematic with line of scrimmage + ball track
  //   Field is 200×90 viewBox. Endzones at each end, yard lines.
  //   Ball moves 2D: x is yardline, y is hash (left/center/right).
  // ========================================================

  function nflFormation(idx, s) {
    // 200x90 viewbox. Ball at (bx, by). Offense attacks toward +x if KC (right endzone), -x if BUF.
    const bx = 20 + s.driveX * 1.6;
    const by = 10 + (s.hashY / 53.3) * 70;
    const dir = s.possession === 'KC' ? 1 : -1;
    const off = s.possession;
    const def = s.possession === 'KC' ? 'BUF' : 'KC';
    // Offense: 5 OL at LOS + QB + RB + 2 WR
    const offense = [
      { x: bx, y: by - 14 }, { x: bx, y: by - 7 }, { x: bx, y: by },
      { x: bx, y: by + 7 }, { x: bx, y: by + 14 },
      { x: bx - dir * 6,  y: by },       // QB
      { x: bx - dir * 10, y: by + 5 },   // RB
      { x: bx + dir * 3,  y: 12 },       // WR wide top
      { x: bx + dir * 3,  y: 78 },       // WR wide bot
    ].map(p => ({ ...p, t: off }));
    // Defense: 4 DL + 3 LB + 4 DB
    const defense = [
      { x: bx + dir * 2, y: by - 10 }, { x: bx + dir * 2, y: by - 3 },
      { x: bx + dir * 2, y: by + 3 },  { x: bx + dir * 2, y: by + 10 },
      { x: bx + dir * 7, y: by - 8 }, { x: bx + dir * 7, y: by },
      { x: bx + dir * 7, y: by + 8 },
      { x: bx + dir * 15, y: 16 }, { x: bx + dir * 15, y: by - 4 },
      { x: bx + dir * 15, y: by + 4 }, { x: bx + dir * 15, y: 74 },
    ].map(p => ({ ...p, t: def }));
    // Jitter + clamp
    const jit = (p, k) => ({
      ...p,
      x: clamp(p.x + (seed(idx * k + p.x) - 0.5) * 3, 22, 178),
      y: clamp(p.y + (seed(idx * k + p.y) - 0.5) * 3, 8, 82),
    });
    return { offense: offense.map(p => jit(p, 11)), defense: defense.map(p => jit(p, 17)) };
  }

  function nflBallTrail(idx, s) {
    const trail = [];
    for (let k = 1; k <= 4; k++) {
      const back = Math.max(0, idx - k * 2);
      const bt = back / Math.max(1, 260 - 1);
      const dx = 50 + Math.sin(cursorWave(back, 1, 0.11)) * 32 + (bt - 0.5) * 10;
      const dy = 26.6 + Math.sin(cursorWave(back, 2, 0.22)) * 14;
      trail.push({
        x: 20 + dx * 1.6,
        y: 10 + (dy / 53.3) * 70,
        opacity: 0.35 - k * 0.07,
      });
    }
    return trail;
  }

  function nflSnapshot(idx, N) {
    const t = idx / Math.max(1, N - 1);
    const totalSec = Math.round(t * 60 * 60);
    const qIdx = Math.min(3, Math.floor(totalSec / (15 * 60)));
    const quarter = qIdx + 1;
    const qSec = 15 * 60 - (totalSec - qIdx * 15 * 60);
    const clock = `${String(Math.floor(qSec / 60)).padStart(2,'0')}:${String(qSec % 60).padStart(2,'0')}`;

    // Ball field position along x (0 = KC endzone, 100 = BUF endzone).
    // Oscillate with drives, include a couple scoring events.
    const driveX = 50 + Math.sin(cursorWave(idx, 1, 0.11)) * 32 + (t - 0.5) * 10;
    // Hash position y in yards from left sideline (0..53.3 standard)
    const hashY = 26.6 + Math.sin(cursorWave(idx, 2, 0.22)) * 14;

    // Possession flips on sign change of driveX derivative — simplify:
    const possession = Math.sin(cursorWave(idx, 1, 0.11)) > 0 ? 'KC' : 'BUF';

    const down = 1 + (idx % 4);
    const toGo = [10, 7, 3, 12, 1][idx % 5];

    // Scoring — stepped with small bursts
    const kcScore  = stepScore(idx, N, [0.10, 0.28, 0.45, 0.63, 0.80], [7, 10, 17, 24, 27]);
    const bufScore = stepScore(idx, N, [0.18, 0.38, 0.55, 0.72, 0.92], [3, 10, 13, 20, 27]);

    // Win prob — crude softmax on score diff + field position
    const edge = (kcScore - bufScore) * 5 + (possession === 'KC' ? (driveX - 50) : (50 - driveX)) * 0.5 + (t) * 2;
    const kcWP = clamp(50 + edge, 3, 97);

    // A short recent-plays list that slides with cursor
    const playFeed = [
      { q:1, c:'12:45', txt:'KC 24-yd completion to Rice, LOS KC-41' },
      { q:1, c:'07:20', txt:'BUF sack on 3rd & 8, punt' },
      { q:2, c:'14:02', txt:'BUF 6-yd TD run, 2pt no-good' },
      { q:2, c:'03:12', txt:'KC FG from 46 good' },
      { q:3, c:'10:44', txt:'KC 48-yd TD pass, Rice' },
      { q:3, c:'02:05', txt:'BUF 11-play drive, stalls at 18' },
      { q:4, c:'09:50', txt:'BUF TD, 2pt attempt fails' },
      { q:4, c:'01:32', txt:'KC kneel decision pending' },
    ];
    // plays that have happened by now
    const elapsedPlays = playFeed.filter(p =>
      p.q < quarter || (p.q === quarter && parseClock(p.c) >= qSec));
    const recent = elapsedPlays.slice(-3);

    const base = { t, quarter, clock, driveX, hashY, possession, down, toGo, kcScore, bufScore, kcWP, recent };
    return { ...base, formation: nflFormation(idx, base), trail: nflBallTrail(idx, base) };
  }

  function cursorWave(idx, k, freq) { return idx * freq + k * 2.1; }
  function parseClock(c) { const [m,s] = c.split(':').map(Number); return m*60+s; }
  function stepScore(idx, N, thresholds, values) {
    const t = idx / Math.max(1, N - 1);
    let v = 0;
    for (let i = 0; i < thresholds.length; i++) if (t >= thresholds[i]) v = values[i];
    return v;
  }

  function nflFieldSVG(s) {
    // 200 wide × 90 tall. Endzones 20 wide each. Playing field 160 wide = 100 yds.
    // Ball (driveX 0..100) → px = 20 + driveX * 1.6
    const bx = 20 + s.driveX * 1.6;
    const by = 10 + (s.hashY / 53.3) * 70;
    const posCol = s.possession === 'KC' ? RED : CYAN;

    const yardLines = [10,20,30,40,50,40,30,20,10];

    return `
      <svg viewBox="0 0 200 90" class="mm-svg" preserveAspectRatio="xMidYMid meet">
        <rect width="200" height="90" fill="${PAPER}"/>
        <!-- Endzones -->
        <rect x="0" y="0" width="20" height="90" fill="${RED}" fill-opacity="0.18"/>
        <rect x="180" y="0" width="20" height="90" fill="${CYAN}" fill-opacity="0.18"/>
        <text x="10" y="50" fill="${RED}" font-family="JetBrains Mono" font-size="7" text-anchor="middle" font-weight="700" transform="rotate(-90 10 50)" letter-spacing="0.14em">KC</text>
        <text x="190" y="50" fill="${CYAN}" font-family="JetBrains Mono" font-size="7" text-anchor="middle" font-weight="700" transform="rotate(90 190 50)" letter-spacing="0.14em">BUF</text>

        <!-- Playing field border -->
        <rect x="20" y="5" width="160" height="80" fill="none" stroke="${MUTED2}" stroke-width="0.6"/>

        <!-- Yard lines every 10 -->
        ${yardLines.map((n, i) => {
          const x = 20 + (i + 1) * 16;
          return `<line x1="${x}" y1="5" x2="${x}" y2="85" stroke="${MUTED2}" stroke-width="0.5" stroke-opacity="0.6"/>
                  <text x="${x}" y="12" fill="${MUTED}" font-family="JetBrains Mono" font-size="4.5" text-anchor="middle">${n}</text>
                  <text x="${x}" y="84" fill="${MUTED}" font-family="JetBrains Mono" font-size="4.5" text-anchor="middle">${n}</text>`;
        }).join('')}

        <!-- Hash marks top/bottom -->
        ${Array.from({length: 20}, (_, i) => {
          const x = 20 + 8 + i * 8;
          return `<line x1="${x}" y1="28" x2="${x}" y2="31" stroke="${MUTED2}" stroke-width="0.4"/>
                  <line x1="${x}" y1="59" x2="${x}" y2="62" stroke="${MUTED2}" stroke-width="0.4"/>`;
        }).join('')}

        <!-- 50 yard line emphasized -->
        <line x1="100" y1="5" x2="100" y2="85" stroke="${INK}" stroke-width="0.6" stroke-opacity="0.4"/>
        <circle cx="100" cy="45" r="5" fill="none" stroke="${INK}" stroke-width="0.4" stroke-opacity="0.35"/>

        <!-- Line of scrimmage -->
        <line x1="${bx}" y1="6" x2="${bx}" y2="84" stroke="${posCol}" stroke-width="0.8" stroke-dasharray="2,2" opacity="0.7"/>

        <!-- 1st down marker (yellow) -->
        ${(() => {
          const ydOffset = s.possession === 'KC' ? s.toGo : -s.toGo;
          const fdX = 20 + clamp(s.driveX + ydOffset, 1, 99) * 1.6;
          return `<line x1="${fdX}" y1="6" x2="${fdX}" y2="84" stroke="${GOLD}" stroke-width="0.8" opacity="0.85"/>`;
        })()}

        <!-- Formation: offense solid, defense ringed -->
        ${s.formation.offense.map(p => `<circle cx="${p.x}" cy="${p.y}" r="1.6" fill="${p.t === 'KC' ? RED : CYAN}" fill-opacity="0.85" stroke="#0b0e10" stroke-width="0.3"/>`).join('')}
        ${s.formation.defense.map(p => `<circle cx="${p.x}" cy="${p.y}" r="1.6" fill="none" stroke="${p.t === 'KC' ? RED : CYAN}" stroke-width="0.7" stroke-opacity="0.85"/>`).join('')}

        <!-- Ball trail -->
        ${s.trail.map(t => `<ellipse cx="${t.x}" cy="${t.y}" rx="2.2" ry="1.5" fill="${posCol}" opacity="${t.opacity}"/>`).join('')}

        <!-- Ball -->
        <g>
          <ellipse cx="${bx}" cy="${by}" rx="3.2" ry="2.2" fill="${posCol}" stroke="#0b0e10" stroke-width="0.6"/>
          <circle cx="${bx}" cy="${by}" r="6.5" fill="none" stroke="${posCol}" stroke-width="0.4" opacity="0.5"/>
        </g>

        <!-- Direction of drive -->
        ${(() => {
          const dx = s.possession === 'KC' ? 10 : -10;
          return `<line x1="${bx}" y1="${by}" x2="${bx+dx}" y2="${by}" stroke="${posCol}" stroke-width="0.6" opacity="0.7"/>
                  <polygon points="${bx+dx},${by} ${bx+dx-2},${by-1.5} ${bx+dx-2},${by+1.5}" fill="${posCol}" opacity="0.7" transform="${dx < 0 ? `rotate(180 ${bx+dx} ${by})` : ''}"/>`;
        })()}

        <!-- Sidelines: offense/defense hint -->
        <text x="22" y="89" fill="${MUTED}" font-family="JetBrains Mono" font-size="4" letter-spacing="0.14em">WEST SIDELINE</text>
      </svg>`;
  }

  function renderNflPane(cursorIdx, ctx) {
    const { N } = ctx;
    const s = nflSnapshot(cursorIdx, N);
    const KC_C = RED, BUF_C = CYAN;
    const posC = s.possession === 'KC' ? KC_C : BUF_C;

    const INJURIES = [
      { team:'KC',  pos:'WR', name:'Rice',    stat:'Q',   note:'hamstring, returned 2Q' },
      { team:'KC',  pos:'LT', name:'Taylor',  stat:'OUT', note:'concussion protocol' },
      { team:'BUF', pos:'CB', name:'Benford', stat:'D',   note:'ankle, jogged sideline' },
      { team:'BUF', pos:'RB', name:'Cook',    stat:'Q',   note:'ribs, returned' },
    ];
    const WEATHER = { wind:'18mph NE', precip:'light snow', temp:'27°F', vis:'clear' };

    // Field position string
    const yd = Math.round(s.driveX);
    const side = yd < 50 ? 'KC' : 'BUF';
    const toMid = yd < 50 ? yd : 100 - yd;
    const fpStr = yd === 50 ? 'MID 50' : `${side} ${toMid}`;

    return `
      <div class="ctx-stamp">
        <div>
          <div class="ts-big" id="ctx-ts">Q${s.quarter} ${s.clock}</div>
          <div class="cross" id="ctx-sync">game clock · KC ${s.kcScore} \u2013 BUF ${s.bufScore}</div>
        </div>
        <div class="ts-meta">ARROWHEAD</div>
      </div>

      <div class="ctx-block sports-score">
        <div class="sb-row">
          <span class="team" style="color:${KC_C}">KC</span>
          <span class="sc">${s.kcScore}</span>
          <span class="sep">\u2013</span>
          <span class="sc">${s.bufScore}</span>
          <span class="team" style="color:${BUF_C}">BUF</span>
        </div>
        <div class="sb-sub">
          <span>Q${s.quarter}</span><span>${s.clock}</span>
          <span style="color:${posC}">\u25cf ${s.possession} ${s.down}/${s.toGo} · ${fpStr}</span>
        </div>
      </div>

      <div class="ctx-block">
        <div class="ctx-head">
          <div class="name"><span class="n">Field</span>ball track</div>
          <div class="delta" style="color:${posC}">${s.possession} ball</div>
        </div>
        <div class="mm-wrap" style="aspect-ratio: 200/90;">${nflFieldSVG(s)}</div>
        <div class="mm-note">WP KC ${s.kcWP.toFixed(0)} · BUF ${(100 - s.kcWP).toFixed(0)}</div>
      </div>

      <div class="ctx-block">
        <div class="ctx-head">
          <div class="name"><span class="n">Recent plays</span>last 3</div>
          <div class="delta">${s.recent.length} logged</div>
        </div>
        ${s.recent.map(p => `
          <div class="hl-item"><div class="src">PBP</div><div class="body">${p.txt}<span class="tm">Q${p.q} ${p.c}</span></div></div>
        `).join('')}
      </div>

      <div class="ctx-block">
        <div class="ctx-head">
          <div class="name"><span class="n">Injuries</span>active / questionable</div>
          <div class="delta">${INJURIES.length} flags</div>
        </div>
        ${INJURIES.map(i => `
          <div class="inj-row">
            <span class="tm" style="color:${i.team === 'KC' ? KC_C : BUF_C}">${i.team}</span>
            <span class="pos">${i.pos}</span>
            <span class="nm">${i.name}</span>
            <span class="st st-${i.stat.toLowerCase()}">${i.stat}</span>
            <span class="note">${i.note}</span>
          </div>
        `).join('')}
      </div>

      <div class="ctx-block">
        <div class="ctx-head">
          <div class="name"><span class="n">Weather</span>venue</div>
          <div class="delta">${WEATHER.precip}</div>
        </div>
        <div class="wx-grid">
          <div><div class="k">wind</div><div class="v">${WEATHER.wind}</div></div>
          <div><div class="k">temp</div><div class="v">${WEATHER.temp}</div></div>
          <div><div class="k">precip</div><div class="v">${WEATHER.precip}</div></div>
          <div><div class="k">vis</div><div class="v">${WEATHER.vis}</div></div>
        </div>
      </div>
    `;
  }

  // ========================================================
  // NBA — half-court schematic with ball + shot markers
  //   Half-court 100 wide × 94 tall (scaled). Paint, 3pt arc,
  //   free throw circle, backboard + rim.
  // ========================================================

  function nbaLineups(idx, ball, poss) {
    // Full court 200x100. LAL attacks RIGHT (rim x=190). BOS attacks LEFT (rim x=10).
    // Players cluster in the offensive half near ball.
    const bx = ball.x, by = ball.y;
    const dirX = poss === 'LAL' ? 1 : -1; // direction ball is moving toward opponent rim
    // Offensive formation relative to ball (5-out, one near rim)
    const offFormation = [
      [ 0,            0 ],      // ball-handler
      [ dirX * 18,  -22 ],      // wing strong-side
      [ dirX * 12,   22 ],      // wing weak-side
      [ dirX * 30,    2 ],      // near rim
      [-dirX * 10,  -16 ],      // top
    ];
    // Defensive formation relative to ball (tighter spacing, more inside)
    const defFormation = [
      [-dirX * 5,    2 ],
      [ dirX * 14, -18 ],
      [ dirX * 10,  18 ],
      [ dirX * 24,   4 ],
      [-dirX * 2,  -12 ],
    ];
    const LAL_NUMS = ['23', '15', '3', '40', '1'];
    const BOS_NUMS = ['0',  '7',  '9', '42', '8'];
    const lalOffense = poss === 'LAL';
    const lalFormation = lalOffense ? offFormation : defFormation;
    const bosFormation = lalOffense ? defFormation : offFormation;
    const jit = (formation, nums, k) => formation.map(([dx, dy], i) => ({
      n: nums[i],
      x: clamp(bx + dx + (seed(idx * k + i * 7) - 0.5) * 6, 6, 194),
      y: clamp(by + dy + (seed(idx * k + i * 11) - 0.5) * 5, 8, 92),
    }));
    return {
      lal: jit(lalFormation, LAL_NUMS, 13),
      bos: jit(bosFormation, BOS_NUMS, 19),
    };
  }

  function nbaBallTrail(idx) {
    const trail = [];
    for (let k = 1; k <= 4; k++) {
      const bi = Math.max(0, idx - k * 2);
      trail.push({
        x: 100 + Math.sin(bi * 0.13) * 80,
        y: 50 + Math.sin(bi * 0.11) * 30,
        opacity: 0.38 - k * 0.08,
      });
    }
    return trail;
  }

  function nbaSnapshot(idx, N) {
    const t = idx / Math.max(1, N - 1);
    // Single quarter (Q4) — 12 minutes
    const qSec = 12 * 60 - Math.round(t * 12 * 60);
    const clock = `${String(Math.floor(qSec / 60)).padStart(2,'0')}:${String(qSec % 60).padStart(2,'0')}`;

    const lal = 78 + Math.floor(t * 28) + ((idx % 6 === 0) ? 2 : 0);
    const bos = 80 + Math.floor(t * 26) + ((idx % 7 === 0) ? 3 : 0);

    const poss = Math.sin(idx * 0.18) > 0 ? 'LAL' : 'BOS';
    // Ball position on full court — LAL attacks right rim (190,50), BOS attacks left rim (10,50)
    const bx = 100 + Math.sin(idx * 0.13) * 80;
    const by = 50 + Math.sin(idx * 0.11) * 30;
    const shotClock = Math.max(0, 24 - (idx % 24));

    // Shot spray — LAL shoots at right rim, BOS at left rim
    const shots = [];
    const rng = (k) => seed(k * 13 + 7);
    for (let i = 0; i < 14; i++) {
      const progress = i / 14;
      if (progress > t) break;
      const team = i % 2 === 0 ? 'LAL' : 'BOS';
      const rimX = team === 'LAL' ? 190 : 10;
      const dir  = team === 'LAL' ? -1 : 1; // shots fan away from rim toward midcourt
      const kind = rng(i) > 0.62 ? '3' : (rng(i + 1) > 0.7 ? '2MID' : '2PAINT');
      let x, y;
      if (kind === '3') {
        const ang = rng(i + 2) * Math.PI; // 0..pi
        x = rimX + dir * Math.abs(Math.cos(ang)) * 40;
        y = 50 + (rng(i + 7) - 0.5) * 82;
      } else if (kind === '2MID') {
        x = rimX + dir * (8 + rng(i + 3) * 22);
        y = 50 + (rng(i + 4) - 0.5) * 36;
      } else {
        x = rimX + dir * (2 + rng(i + 5) * 10);
        y = 50 + (rng(i + 6) - 0.5) * 16;
      }
      const made = rng(i + 9) > (kind === '3' ? 0.62 : kind === '2MID' ? 0.55 : 0.4);
      shots.push({ team, x, y, made, kind });
    }

    const plays = [
      { c:'11:12', txt:'LAL open 3 right wing, good', team:'LAL' },
      { c:'10:05', txt:'BOS drive & kick, 2 of 2 FT', team:'BOS' },
      { c:'08:48', txt:'LAL turnover on screen, fast break 3 BOS', team:'BOS' },
      { c:'06:30', txt:'BOS mid-range J off the elbow, good', team:'BOS' },
      { c:'04:02', txt:'LAL and-1 at the rim', team:'LAL' },
      { c:'02:10', txt:'LAL corner 3 good, one possession game', team:'LAL' },
      { c:'00:42', txt:'BOS isolation miss, rebound LAL', team:'BOS' },
    ];
    const nowSec = qSec;
    const recent = plays.filter(p => parseClock(p.c) >= nowSec).slice(-3);

    return { t, clock, qSec, lal, bos, poss, bx, by, shotClock, shots, recent, lineups: nbaLineups(idx, { x: bx, y: by }, poss), trail: nbaBallTrail(idx) };
  }

  function nbaCourtSVG(s) {
    // viewBox 200x100 — full court, horizontal. Baskets at left (x=10) and right (x=190).
    // Each end mirrors the other.
    const halfMarkup = (baseX, mirror) => {
      const sign = mirror ? -1 : 1;  // sign pushes geometry toward midcourt
      const paintX = mirror ? baseX - 40 : baseX + 2;
      const ftX = baseX + sign * 40;
      const bbX = baseX + sign * -2; // backboard slightly inside baseline
      const paint = `<rect x="${paintX}" y="34" width="38" height="32" fill="${CYAN}" fill-opacity="0.05" stroke="${MUTED2}" stroke-width="0.4"/>`;
      const ftCircle = `<circle cx="${ftX}" cy="50" r="10" fill="none" stroke="${MUTED2}" stroke-width="0.4"/>`;
      const ftDash = `<line x1="${ftX - 10}" y1="50" x2="${ftX + 10}" y2="50" stroke="${MUTED2}" stroke-width="0.4" stroke-dasharray="1.5,1.5"/>`;
      // 3pt: straight corner lines from baseline out to x=baseX+sign*26, then arc to opposite corner
      const corner1X = baseX + sign * 26;
      const sweep = mirror ? 0 : 1;
      const threePt = `<path d="M ${baseX} 8 L ${corner1X} 8 A 50 50 0 0 ${sweep} ${corner1X} 92 L ${baseX} 92" fill="none" stroke="${INK}" stroke-width="0.6" stroke-opacity="0.55"/>`;
      const restrictedSweep = mirror ? 1 : 0;
      const restricted = `<path d="M ${bbX} 46 A 4 4 0 0 ${restrictedSweep} ${bbX} 54" fill="none" stroke="${MUTED2}" stroke-width="0.4"/>`;
      const backboard = `<line x1="${bbX}" y1="44" x2="${bbX}" y2="56" stroke="${INK}" stroke-width="0.7"/>`;
      const rim = `<circle cx="${baseX}" cy="50" r="1.4" fill="none" stroke="${GOLD}" stroke-width="0.7"/>`;
      return [paint, ftCircle, ftDash, threePt, restricted, backboard, rim].join('');
    };

    return `
      <svg viewBox="0 0 200 100" class="mm-svg" preserveAspectRatio="xMidYMid meet">
        <rect width="200" height="100" fill="${PAPER}"/>

        <!-- Court border -->
        <rect x="2" y="2" width="196" height="96" fill="none" stroke="${MUTED2}" stroke-width="0.5"/>

        <!-- Midcourt line -->
        <line x1="100" y1="2" x2="100" y2="98" stroke="${MUTED2}" stroke-width="0.5"/>

        <!-- Center circles -->
        <circle cx="100" cy="50" r="10" fill="none" stroke="${MUTED2}" stroke-width="0.4"/>
        <circle cx="100" cy="50" r="4" fill="none" stroke="${MUTED2}" stroke-width="0.4"/>

        <!-- Left half (BOS basket) -->
        ${halfMarkup(10, false)}

        <!-- Right half (LAL basket) -->
        ${halfMarkup(190, true)}

        <!-- Shot spray -->
        ${s.shots.map(sh => {
          const col = sh.team === 'LAL' ? GOLD : GREEN;
          const r = sh.kind === '3' ? 1.2 : 1.4;
          if (sh.made) {
            return `<circle cx="${sh.x}" cy="${sh.y}" r="${r}" fill="${col}" fill-opacity="0.85"/>`;
          }
          return `<g stroke="${col}" stroke-width="0.5" opacity="0.55">
            <line x1="${sh.x - r}" y1="${sh.y - r}" x2="${sh.x + r}" y2="${sh.y + r}"/>
            <line x1="${sh.x + r}" y1="${sh.y - r}" x2="${sh.x - r}" y2="${sh.y + r}"/>
          </g>`;
        }).join('')}

        <!-- Players LAL -->
        ${s.lineups.lal.map(p => `
          <g>
            <circle cx="${p.x}" cy="${p.y}" r="2.3" fill="${GOLD}" fill-opacity="0.85" stroke="#0b0e10" stroke-width="0.5"/>
            <text x="${p.x}" y="${p.y + 0.9}" fill="#0b0e10" font-family="JetBrains Mono" font-size="2.5" text-anchor="middle" font-weight="700">${p.n}</text>
          </g>`).join('')}

        <!-- Players BOS -->
        ${s.lineups.bos.map(p => `
          <g>
            <circle cx="${p.x}" cy="${p.y}" r="2.3" fill="none" stroke="${GREEN}" stroke-width="0.8"/>
            <text x="${p.x}" y="${p.y + 0.9}" fill="${GREEN}" font-family="JetBrains Mono" font-size="2.5" text-anchor="middle" font-weight="700">${p.n}</text>
          </g>`).join('')}

        <!-- Ball trail -->
        ${s.trail.map(t => `<circle cx="${t.x}" cy="${t.y}" r="1.3" fill="${s.poss === 'LAL' ? GOLD : GREEN}" opacity="${t.opacity}"/>`).join('')}

        <!-- Live ball -->
        <g>
          <circle cx="${s.bx}" cy="${s.by}" r="2.4" fill="${s.poss === 'LAL' ? GOLD : GREEN}" stroke="#0b0e10" stroke-width="0.5"/>
          <circle cx="${s.bx}" cy="${s.by}" r="5" fill="none" stroke="${s.poss === 'LAL' ? GOLD : GREEN}" stroke-width="0.3" opacity="0.55"/>
        </g>

        <!-- Labels -->
        <text x="4" y="97" fill="${GREEN}" font-family="JetBrains Mono" font-size="3.5" letter-spacing="0.12em">\u2190 BOS</text>
        <text x="100" y="97" fill="${MUTED}" font-family="JetBrains Mono" font-size="3.2" letter-spacing="0.12em" text-anchor="middle">FULL COURT · Q4</text>
        <text x="196" y="97" fill="${GOLD}" font-family="JetBrains Mono" font-size="3.5" letter-spacing="0.12em" text-anchor="end">LAL \u2192</text>
      </svg>`;
  }

  function renderNbaPane(cursorIdx, ctx) {
    const { N } = ctx;
    const s = nbaSnapshot(cursorIdx, N);
    const LAL_C = GOLD, BOS_C = GREEN;
    const posC = s.poss === 'LAL' ? LAL_C : BOS_C;
    const diff = s.lal - s.bos;
    const leader = diff > 0 ? 'LAL' : diff < 0 ? 'BOS' : 'TIE';
    const leaderCol = diff > 0 ? LAL_C : diff < 0 ? BOS_C : MUTED;

    // Shot chart summary
    const lalMade = s.shots.filter(x => x.team === 'LAL' && x.made).length;
    const lalTot  = s.shots.filter(x => x.team === 'LAL').length;
    const bosMade = s.shots.filter(x => x.team === 'BOS' && x.made).length;
    const bosTot  = s.shots.filter(x => x.team === 'BOS').length;

    return `
      <div class="ctx-stamp">
        <div>
          <div class="ts-big" id="ctx-ts">Q4 ${s.clock}</div>
          <div class="cross" id="ctx-sync">game clock · LAL ${s.lal} \u2013 BOS ${s.bos}</div>
        </div>
        <div class="ts-meta">TD GARDEN</div>
      </div>

      <div class="ctx-block sports-score">
        <div class="sb-row">
          <span class="team" style="color:${LAL_C}">LAL</span>
          <span class="sc">${s.lal}</span>
          <span class="sep">\u2013</span>
          <span class="sc">${s.bos}</span>
          <span class="team" style="color:${BOS_C}">BOS</span>
        </div>
        <div class="sb-sub">
          <span>Q4</span><span>${s.clock}</span>
          <span style="color:${posC}">\u25cf ${s.poss} ball · shot ${s.shotClock}</span>
          <span style="color:${leaderCol}">${leader === 'TIE' ? 'TIED' : leader + ' +' + Math.abs(diff)}</span>
        </div>
      </div>

      <div class="ctx-block">
        <div class="ctx-head">
          <div class="name"><span class="n">Half-court</span>ball + shots</div>
          <div class="delta" style="color:${posC}">${s.poss} possession</div>
        </div>
        <div class="mm-wrap" style="aspect-ratio: 200/100;">${nbaCourtSVG(s)}</div>
        <div class="mm-note">LAL ${lalMade}/${lalTot} · BOS ${bosMade}/${bosTot} shots Q4</div>
      </div>

      <div class="ctx-block">
        <div class="ctx-head">
          <div class="name"><span class="n">Recent plays</span>last 3</div>
          <div class="delta">${s.recent.length} logged</div>
        </div>
        ${s.recent.map(p => `
          <div class="hl-item"><div class="src">PBP</div><div class="body">${p.txt}<span class="tm">Q4 ${p.c}</span></div></div>
        `).join('')}
      </div>

      <div class="ctx-block">
        <div class="ctx-head">
          <div class="name"><span class="n">On floor</span>starters</div>
          <div class="delta">9 active</div>
        </div>
        <div class="hero-list">
          <div class="hero-head"><span>TM</span><span>#</span><span>NAME</span><span>PTS</span><span>REB/AST</span><span>TS%</span></div>
          <div class="hero-row"><span class="slot" style="color:${LAL_C}">L</span><span class="hero">23</span><span class="role">James</span><span class="nw">28</span><span class="kda">8/11</span><span class="cs">61</span></div>
          <div class="hero-row"><span class="slot" style="color:${LAL_C}">L</span><span class="hero">15</span><span class="role">Reaves</span><span class="nw">19</span><span class="kda">4/3</span><span class="cs">58</span></div>
          <div class="hero-row"><span class="slot" style="color:${LAL_C}">L</span><span class="hero">3</span><span class="role">Davis</span><span class="nw">22</span><span class="kda">14/2</span><span class="cs">55</span></div>
          <div class="hero-row"><span class="slot" style="color:${BOS_C}">B</span><span class="hero">0</span><span class="role">Tatum</span><span class="nw">31</span><span class="kda">9/5</span><span class="cs">63</span></div>
          <div class="hero-row"><span class="slot" style="color:${BOS_C}">B</span><span class="hero">7</span><span class="role">Brown</span><span class="nw">24</span><span class="kda">6/4</span><span class="cs">59</span></div>
          <div class="hero-row"><span class="slot" style="color:${BOS_C}">B</span><span class="hero">9</span><span class="role">White</span><span class="nw">16</span><span class="kda">3/7</span><span class="cs">62</span></div>
        </div>
      </div>

      <div class="ctx-block">
        <div class="ctx-head">
          <div class="name"><span class="n">Signal</span>wire / social</div>
          <div class="delta pos">+${180 + (cursorIdx % 50)}/min</div>
        </div>
        <div class="hl-item"><div class="src">ESP</div><div class="body">Tatum 11-ft pull-up, Celtics up ${Math.max(0, s.bos - s.lal)}<span class="tm">Q4 ${s.clock}</span></div></div>
        <div class="hl-item"><div class="src">TW</div><div class="body">LAL timeout after turnover, draw up out-of-bounds</div></div>
        <div class="hl-item"><div class="src">RED</div><div class="body">r/nba megathread 14k comments, win prob swing ±8</div></div>
      </div>
    `;
  }

  // ========================================================
  // Football (soccer) — full pitch schematic with ball + players
  // ========================================================

  function footballSnapshot(idx, N) {
    const t = idx / Math.max(1, N - 1);
    // 2nd half, 45 minutes
    const mins = 45 + Math.floor(t * 45);
    const secs = Math.floor((t * 45 * 60) % 60);
    const clock = `${mins}'${String(secs).padStart(2,'0')}`;

    // Ball position on 200×128 pitch
    const bx = 100 + Math.sin(idx * 0.12) * 72;
    const by = 64  + Math.sin(idx * 0.19 + 1.3) * 38;
    const poss = bx < 100 ? 'RMA' : 'MCI';

    // Scores step through match events
    const rma = stepScore(idx, N, [0.12, 0.55, 0.82], [1, 2, 2]);
    const mci = stepScore(idx, N, [0.38, 0.70], [1, 2]);

    // Players: 11v11. Home (RMA) attacking right, away (MCI) attacking left.
    // Anchor formations (4-3-3) + small drift by idx.
    const home = homeFormation(idx);
    const away = awayFormation(idx);

    // xG flowing — tiny spark
    const xgR = (0.4 + t * 1.4).toFixed(2);
    const xgM = (0.5 + t * 1.3).toFixed(2);

    const plays = [
      { m:52, txt:'RMA opener, Vinicius cut-in from left', team:'RMA' },
      { m:58, txt:'MCI Haaland header wide' },
      { m:63, txt:'MCI yellow, tactical on Valverde' },
      { m:71, txt:'MCI equaliser, De Bruyne bending effort', team:'MCI' },
      { m:78, txt:'RMA sub: Rodrygo on, Brahim off' },
      { m:83, txt:'RMA restored lead, Bellingham finish', team:'RMA' },
      { m:88, txt:'MCI push, 3 set pieces in 2m' },
      { m:90, txt:'+4 added' },
    ];
    const recent = plays.filter(p => p.m <= mins).slice(-3);

    return { t, clock, mins, bx, by, poss, rma, mci, home, away, xgR, xgM, recent };
  }

  function homeFormation(idx) {
    // 4-3-3. Home attacks right. Field 200x128.
    const base = [
      { n:'1',  role:'GK', x: 15, y: 64 },
      { n:'2',  role:'RB', x: 40, y: 20 },
      { n:'4',  role:'CB', x: 38, y: 50 },
      { n:'5',  role:'CB', x: 38, y: 78 },
      { n:'3',  role:'LB', x: 40, y:108 },
      { n:'14', role:'CM', x: 80, y: 40 },
      { n:'8',  role:'CM', x: 80, y: 88 },
      { n:'10', role:'AM', x:115, y: 64 },
      { n:'11', role:'LW', x:130, y: 30 },
      { n:'9',  role:'ST', x:145, y: 64 },
      { n:'21', role:'RW', x:130, y: 98 },
    ];
    return base.map(p => ({
      ...p,
      x: clamp(p.x + (seed(idx + p.x) - 0.5) * 14, 8, 192),
      y: clamp(p.y + (seed(idx + p.y) - 0.5) * 14, 8, 120),
    }));
  }
  function awayFormation(idx) {
    const base = [
      { n:'1',  role:'GK', x:185, y: 64 },
      { n:'2',  role:'RB', x:160, y:108 },
      { n:'5',  role:'CB', x:162, y: 78 },
      { n:'4',  role:'CB', x:162, y: 50 },
      { n:'3',  role:'LB', x:160, y: 20 },
      { n:'6',  role:'CM', x:125, y: 88 },
      { n:'8',  role:'CM', x:125, y: 40 },
      { n:'17', role:'AM', x: 90, y: 64 },
      { n:'11', role:'LW', x: 72, y: 98 },
      { n:'9',  role:'ST', x: 58, y: 64 },
      { n:'7',  role:'RW', x: 72, y: 30 },
    ];
    return base.map(p => ({
      ...p,
      x: clamp(p.x + (seed(idx * 3 + p.x) - 0.5) * 14, 8, 192),
      y: clamp(p.y + (seed(idx * 3 + p.y) - 0.5) * 14, 8, 120),
    }));
  }

  function footballPitchSVG(s) {
    // 200x128 viewBox, horizontal pitch. Boxes on each end.
    return `
      <svg viewBox="0 0 200 128" class="mm-svg" preserveAspectRatio="xMidYMid meet">
        <rect width="200" height="128" fill="${PAPER}"/>

        <!-- Turf stripes -->
        ${Array.from({length: 10}, (_, i) => `<rect x="${i * 20}" y="2" width="20" height="124" fill="${GREEN}" fill-opacity="${i % 2 ? 0.03 : 0.06}"/>`).join('')}

        <!-- Pitch border -->
        <rect x="4" y="4" width="192" height="120" fill="none" stroke="${INK}" stroke-width="0.6" stroke-opacity="0.55"/>

        <!-- Center line + circle -->
        <line x1="100" y1="4" x2="100" y2="124" stroke="${INK}" stroke-width="0.5" stroke-opacity="0.55"/>
        <circle cx="100" cy="64" r="14" fill="none" stroke="${INK}" stroke-width="0.5" stroke-opacity="0.55"/>
        <circle cx="100" cy="64" r="1" fill="${INK}" fill-opacity="0.6"/>

        <!-- Penalty boxes -->
        <rect x="4" y="32" width="28" height="64" fill="none" stroke="${INK}" stroke-width="0.5" stroke-opacity="0.55"/>
        <rect x="168" y="32" width="28" height="64" fill="none" stroke="${INK}" stroke-width="0.5" stroke-opacity="0.55"/>

        <!-- 6-yard boxes -->
        <rect x="4" y="48" width="12" height="32" fill="none" stroke="${INK}" stroke-width="0.45" stroke-opacity="0.5"/>
        <rect x="184" y="48" width="12" height="32" fill="none" stroke="${INK}" stroke-width="0.45" stroke-opacity="0.5"/>

        <!-- Penalty arcs -->
        <path d="M 32 56 A 9 9 0 0 1 32 72" fill="none" stroke="${INK}" stroke-width="0.45" stroke-opacity="0.5"/>
        <path d="M 168 56 A 9 9 0 0 0 168 72" fill="none" stroke="${INK}" stroke-width="0.45" stroke-opacity="0.5"/>

        <!-- Penalty spots -->
        <circle cx="22" cy="64" r="0.8" fill="${INK}" fill-opacity="0.55"/>
        <circle cx="178" cy="64" r="0.8" fill="${INK}" fill-opacity="0.55"/>

        <!-- Corner arcs -->
        ${[[4,4],[196,4],[4,124],[196,124]].map(([x,y]) => `<path d="M ${x} ${y} m -2 0 a 2 2 0 0 1 2 -2" fill="none" stroke="${INK}" stroke-width="0.4" stroke-opacity="0.5"/>`).join('')}

        <!-- Goals -->
        <rect x="2" y="58" width="2" height="12" fill="${INK}" fill-opacity="0.6"/>
        <rect x="196" y="58" width="2" height="12" fill="${INK}" fill-opacity="0.6"/>

        <!-- Home players (RMA) -->
        ${s.home.map(p => `
          <g>
            <circle cx="${p.x}" cy="${p.y}" r="3.2" fill="${CYAN}" stroke="#0b0e10" stroke-width="0.6"/>
            <text x="${p.x}" y="${p.y + 1.2}" fill="#0b0e10" font-family="JetBrains Mono" font-size="3.2" text-anchor="middle" font-weight="700">${p.n}</text>
          </g>`).join('')}

        <!-- Away players (MCI) -->
        ${s.away.map(p => `
          <g>
            <circle cx="${p.x}" cy="${p.y}" r="3.2" fill="${RED}" stroke="#0b0e10" stroke-width="0.6"/>
            <text x="${p.x}" y="${p.y + 1.2}" fill="#0b0e10" font-family="JetBrains Mono" font-size="3.2" text-anchor="middle" font-weight="700">${p.n}</text>
          </g>`).join('')}

        <!-- Ball -->
        <g>
          <circle cx="${s.bx}" cy="${s.by}" r="2.2" fill="${INK}" stroke="#0b0e10" stroke-width="0.5"/>
          <circle cx="${s.bx}" cy="${s.by}" r="5" fill="none" stroke="${INK}" stroke-width="0.3" opacity="0.55"/>
        </g>

        <!-- Labels -->
        <text x="8" y="124" fill="${CYAN}" font-family="JetBrains Mono" font-size="4" letter-spacing="0.14em">RMA →</text>
        <text x="192" y="124" fill="${RED}" font-family="JetBrains Mono" font-size="4" letter-spacing="0.14em" text-anchor="end">← MCI</text>
      </svg>`;
  }

  function renderFootballPane(cursorIdx, ctx) {
    const { N } = ctx;
    const s = footballSnapshot(cursorIdx, N);
    const RMA_C = CYAN, MCI_C = RED;
    const posC = s.poss === 'RMA' ? RMA_C : MCI_C;
    const diff = s.rma - s.mci;
    const leader = diff > 0 ? 'RMA' : diff < 0 ? 'MCI' : 'DRAW';
    const leaderCol = diff > 0 ? RMA_C : diff < 0 ? MCI_C : MUTED;

    return `
      <div class="ctx-stamp">
        <div>
          <div class="ts-big" id="ctx-ts">${s.clock}</div>
          <div class="cross" id="ctx-sync">2H · RMA ${s.rma} \u2013 MCI ${s.mci}</div>
        </div>
        <div class="ts-meta">BERNABÉU</div>
      </div>

      <div class="ctx-block sports-score">
        <div class="sb-row">
          <span class="team" style="color:${RMA_C}">RMA</span>
          <span class="sc">${s.rma}</span>
          <span class="sep">\u2013</span>
          <span class="sc">${s.mci}</span>
          <span class="team" style="color:${MCI_C}">MCI</span>
        </div>
        <div class="sb-sub">
          <span>2H</span><span>${s.clock}</span>
          <span style="color:${posC}">\u25cf ${s.poss} ball</span>
          <span style="color:${leaderCol}">${leader === 'DRAW' ? 'DRAW' : leader + ' +' + Math.abs(diff)}</span>
        </div>
      </div>

      <div class="ctx-block">
        <div class="ctx-head">
          <div class="name"><span class="n">Pitch</span>22 players + ball</div>
          <div class="delta" style="color:${posC}">${s.poss} possession</div>
        </div>
        <div class="mm-wrap" style="aspect-ratio: 200/128;">${footballPitchSVG(s)}</div>
        <div class="mm-note">xG · RMA ${s.xgR} · MCI ${s.xgM}</div>
      </div>

      <div class="ctx-block">
        <div class="ctx-head">
          <div class="name"><span class="n">Key events</span>last 3</div>
          <div class="delta">${s.recent.length} logged</div>
        </div>
        ${s.recent.map(p => `
          <div class="hl-item"><div class="src">${p.team || 'OPT'}</div><div class="body">${p.txt}<span class="tm">${p.m}'</span></div></div>
        `).join('')}
      </div>

      <div class="ctx-block">
        <div class="ctx-head">
          <div class="name"><span class="n">Match stats</span>—</div>
          <div class="delta">updated ${s.clock}</div>
        </div>
        <div class="wx-grid">
          <div><div class="k">poss %</div><div class="v">56/44</div></div>
          <div><div class="k">shots</div><div class="v">14/11</div></div>
          <div><div class="k">on tgt</div><div class="v">5/4</div></div>
          <div><div class="k">corners</div><div class="v">6/8</div></div>
        </div>
      </div>

      <div class="ctx-block">
        <div class="ctx-head">
          <div class="name"><span class="n">Signal</span>wire / social</div>
          <div class="delta pos">+${160 + (cursorIdx % 45)}/min</div>
        </div>
        <div class="hl-item"><div class="src">OPT</div><div class="body">RMA xG surges past MCI after 78' sub<span class="tm">${s.clock}</span></div></div>
        <div class="hl-item"><div class="src">TW</div><div class="body">Bellingham goal clip trending, 1.2M views/min</div></div>
        <div class="hl-item"><div class="src">RED</div><div class="body">r/soccer match thread, odds move 2.10 → 1.55 home</div></div>
      </div>
    `;
  }

  // ========================================================
  // Dispatch
  // ========================================================
  window.ContextKinds = {
    render(kind, cursorIdx, ctx) {
      try {
        if (kind === 'esports')     return renderDotaPane(cursorIdx, ctx);
        if (kind === 'sports_trad') return renderNflPane(cursorIdx, ctx);
        if (kind === 'nba')         return renderNbaPane(cursorIdx, ctx);
        if (kind === 'football')    return renderFootballPane(cursorIdx, ctx);
      } catch (err) {
        console.error('ContextKinds render error', kind, err);
      }
      return null;
    },
  };
})();
