/* ═══════════════════════════════════════════════════════════════
   MILESTONE-GUARD.JS  —  羁绊档案 · 游玩时长验证
   挂载：在 milestone.html </body> 前（其他 script 之前）加入
   <script src="milestone-guard.js"></script>
   依赖：IndexedDB 'tsukiphonepromax' / store 'config'
   目标时长：TARGET_SEC = 4.4h = 15840s
═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── 配置 ── */
  const TARGET_SEC  = 4.4 * 3600;   // 15840s = 4.4h
  const IDB_NAME    = 'tsukiphonepromax';
  const STORE       = 'config';
  const DUR_KEY     = 'auth_play_duration';   // 与 auth.js 同步
  const CELL_COUNT  = 12;                     // 电量格子数
  const FILL_MS     = 2000;                   // 充满动画总时长

  /* ──────────────────────────────────────────────
     1. 立即注入蒙版（同步阻塞，防止页面闪现）
  ────────────────────────────────────────────── */
  const style = document.createElement('style');
  style.textContent = `
    @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@1,9..144,200;0,9..144,300&family=Geist+Mono:wght@300;400;500;600&display=swap');

    /* ── 蒙版基础 ── */
    #_mg_mask {
      position: fixed; inset: 0; z-index: 2147483647;
      background: #0c0b0a;
      display: flex; align-items: center; justify-content: center;
      flex-direction: column;
      font-family: 'Geist Mono', monospace;
      overflow: hidden;
    }

    /* 点阵背景 */
    #_mg_mask::before {
      content: '';
      position: absolute; inset: 0; pointer-events: none;
      background-image: radial-gradient(circle, rgba(255,255,255,.045) 1px, transparent 1px);
      background-size: 20px 20px;
    }

    /* 四角装饰框线 */
    #_mg_mask::after {
      content: '';
      position: absolute;
      inset: 16px;
      border: 1px solid rgba(255,255,255,.05);
      pointer-events: none;
    }

    /* ── 顶部胶片条 ── */
    #_mg_film {
      position: absolute; top: 0; left: 0; right: 0;
      height: 22px;
      border-bottom: 1px solid rgba(255,255,255,.06);
      display: flex; align-items: center; overflow: hidden;
      background: rgba(0,0,0,.4);
    }
    #_mg_film_holes {
      display: flex; align-items: center; gap: 5px; padding: 0 10px; flex-shrink: 0;
    }
    .mg-hole {
      width: 9px; height: 7px; border-radius: 2px;
      background: rgba(255,255,255,.12); flex-shrink: 0;
    }
    #_mg_film_txt {
      flex: 1; white-space: nowrap; overflow: hidden;
      font-size: 6px; letter-spacing: .18em; color: rgba(255,255,255,.5);
      animation: _mg_scroll 20s linear infinite;
    }
    @keyframes _mg_scroll { from { transform: translateX(0) } to { transform: translateX(-50%) } }

    /* ── 四角坐标装饰 ── */
    .mg-corner {
      position: absolute; font-size: 6px; letter-spacing: .1em;
      color: rgba(255,255,255,.5); font-family: 'Geist Mono', monospace;
    }
    .mg-corner.tl { top: 28px; left: 22px; }
    .mg-corner.tr { top: 28px; right: 22px; text-align: right; }
    .mg-corner.bl { bottom: 22px; left: 22px; }
    .mg-corner.br { bottom: 22px; right: 22px; text-align: right; }

    /* ── 中央卡片 ── */
    #_mg_card {
      position: relative;
      width: min(320px, calc(100vw - 48px));
      background: #111010;
      border: 1px solid rgba(255,255,255,.1);
      box-shadow: 4px 4px 0 rgba(253,164,175,.15);
      padding: 28px 26px 24px;
      display: flex; flex-direction: column; gap: 0;
    }
    /* 卡片左侧竖条 */
    #_mg_card::before {
      content: '';
      position: absolute; left: 0; top: 0; bottom: 0; width: 3px;
      background: linear-gradient(180deg, #fda4af, #93c5fd 50%, #c4b5fd);
    }

    /* ── 标题区 ── */
    #_mg_eyebrow {
      font-size: 6.5px; letter-spacing: .26em;
      color: rgba(253,164,175,.7); margin-bottom: 6px; font-weight: 500;
    }
    #_mg_title {
      font-family: 'Fraunces', serif; font-style: italic; font-weight: 200;
      font-size: 28px; color: #fff; letter-spacing: -.02em; line-height: 1.1;
      margin-bottom: 4px;
    }
    #_mg_subtitle {
      font-size: 7.5px; letter-spacing: .08em; color: rgba(255,255,255,.5);
      margin-bottom: 22px;
    }

    /* ── 时长显示 ── */
    #_mg_dur_row {
      display: flex; align-items: baseline; justify-content: space-between;
      margin-bottom: 8px;
    }
    #_mg_dur_cur {
      font-family: 'Fraunces', serif; font-style: italic; font-weight: 200;
      font-size: 36px; color: #fff; letter-spacing: -.02em; line-height: 1;
    }
    #_mg_dur_cur .mg-unit { font-size: 11px; color: rgba(255,255,255,.5); margin-left: 3px; }
    #_mg_dur_target {
      font-size: 7px; letter-spacing: .1em; color: rgba(255,255,255,.5);
    }

    /* ── 进度条轨道 ── */
    #_mg_track {
      height: 3px; background: rgba(255,255,255,.08);
      margin-bottom: 6px; position: relative; overflow: hidden;
    }
    #_mg_fill {
      height: 100%; width: 0%;
      background: linear-gradient(90deg, #fda4af, #93c5fd);
      transition: width .6s cubic-bezier(.22,1,.36,1);
    }
    #_mg_pct_row {
      display: flex; justify-content: space-between;
      font-size: 6.5px; letter-spacing: .1em;
      color: rgba(255,255,255,.5); margin-bottom: 20px;
    }
    #_mg_pct_val { color: rgba(253,164,175,.8); }

    /* ── 分割线 ── */
    .mg-sep {
      height: 1px; background: rgba(255,255,255,.15); margin-bottom: 16px;
    }

    /* ── 未解锁提示框 ── */
    #_mg_locked_box {
      background: rgba(255,255,255,.03);
      border: 1px solid rgba(255,255,255,.07);
      padding: 14px 16px; position: relative;
    }
    #_mg_locked_box::before {
      content: '[ LOCKED ]';
      position: absolute; top: -6px; left: 14px;
      font-size: 6px; letter-spacing: .2em; color: rgba(255,255,255,.5);
      background: #111010; padding: 0 6px;
    }
    #_mg_lock_icon {
      font-size: 9px; letter-spacing: .14em; color: rgba(255,255,255,.5);
      margin-bottom: 8px; display: flex; align-items: center; gap: 6px;
    }
    #_mg_lock_icon::before {
      content: '';
      width: 16px; height: 1px; background: rgba(255,255,255,.35);
    }
    #_mg_lock_icon::after {
      content: '';
      flex: 1; height: 1px; background: rgba(255,255,255,.35);
    }
    #_mg_remain_label {
      font-size: 7px; letter-spacing: .12em; color: rgba(255,255,255,.5);
      margin-bottom: 10px;
    }
    #_mg_remain_val {
      font-family: 'Fraunces', serif; font-style: italic; font-weight: 200;
      font-size: 30px; color: rgba(253,164,175,.9); letter-spacing: -.02em;
      line-height: 1; margin-bottom: 4px;
    }
    #_mg_remain_val .mg-unit { font-size: 11px; color: rgba(253,164,175,.45); margin-left: 3px; }
    #_mg_unlock_tip {
      font-size: 7px; letter-spacing: .08em; color: rgba(255,255,255,.5);
      border-top: 1px solid rgba(255,255,255,.05); padding-top: 10px; margin-top: 10px;
    }
    /* 闪烁光标 */
    #_mg_unlock_tip::after {
      content: '_';
      animation: _mg_blink 1.1s step-end infinite;
    }
    @keyframes _mg_blink { 0%,100%{opacity:1} 50%{opacity:0} }

    /* ── 解锁成功：电池格子 ── */
    #_mg_battery_box {
      display: none; flex-direction: column; gap: 10px;
    }
    #_mg_battery_label {
      font-size: 6.5px; letter-spacing: .2em; color: rgba(253,164,175,.7);
      display: flex; align-items: center; gap: 6px;
    }
    #_mg_battery_label::before, #_mg_battery_label::after {
      content: ''; flex: 1; height: 1px; background: rgba(253,164,175,.15);
    }
    #_mg_cells {
      display: flex; gap: 4px; align-items: flex-end;
    }
    .mg-cell {
      flex: 1; height: 18px;
      border: 1px solid rgba(255,255,255,.1);
      background: transparent;
      position: relative; overflow: hidden;
      transition: border-color .15s;
    }
    /* 格子按位置染色：rose → blue → violet */
    .mg-cell.lit {
      border-color: rgba(253,164,175,.55);
    }
    .mg-cell.lit::after {
      content: '';
      position: absolute; inset: 0;
      background: linear-gradient(180deg, rgba(253,164,175,.55), rgba(253,164,175,.18));
      animation: _mg_cell_in .18s ease forwards;
    }
    .mg-cell.lit.mid {
      border-color: rgba(147,197,253,.55);
    }
    .mg-cell.lit.mid::after {
      background: linear-gradient(180deg, rgba(147,197,253,.55), rgba(147,197,253,.18));
    }
    .mg-cell.lit.last {
      border-color: rgba(196,181,253,.75);
    }
    .mg-cell.lit.last::after {
      background: linear-gradient(180deg, rgba(196,181,253,.65), rgba(196,181,253,.2));
    }
    @keyframes _mg_cell_in { from{opacity:0;transform:scaleY(.2)} to{opacity:1;transform:scaleY(1)} }
    #_mg_battery_tip {
      font-size: 6.5px; letter-spacing: .14em; color: rgba(196,181,253,.5);
      text-align: center;
    }

    /* ── 底部装饰行 ── */
    #_mg_footer {
      position: absolute; bottom: 28px; left: 0; right: 0;
      display: flex; justify-content: center; align-items: center; gap: 12px;
    }
    .mg-dot-row {
      display: flex; gap: 5px; align-items: center;
    }
    .mg-mini-dot {
      width: 3px; height: 3px; border-radius: 50%;
      background: rgba(255,255,255,.35);
    }
    .mg-mini-dot.rose { background: rgba(253,164,175,.4); }
    .mg-mini-dot.blue { background: rgba(147,197,253,.4); }
    .mg-mini-dot.violet { background: rgba(196,181,253,.4); }
    #_mg_ver {
      font-size: 6px; letter-spacing: .18em; color: rgba(255,255,255,.5);
    }
  `;
  document.head.appendChild(style);

  /* 创建蒙版 DOM */
  const mask = document.createElement('div');
  mask.id = '_mg_mask';
  mask.innerHTML = `
    <!-- 胶片条 -->
    <div id="_mg_film">
      <div id="_mg_film_holes">
        <div class="mg-hole"></div><div class="mg-hole"></div>
        <div class="mg-hole"></div><div class="mg-hole"></div>
      </div>
      <div id="_mg_film_txt">
        CHRONICLE · 羁绊档案 · BOND ARCHIVE · TSUKIMI · PLAY RECORD · CHRONICLE · 羁绊档案 · BOND ARCHIVE · TSUKIMI · PLAY RECORD ·&nbsp;&nbsp;&nbsp;
        CHRONICLE · 羁绊档案 · BOND ARCHIVE · TSUKIMI · PLAY RECORD · CHRONICLE · 羁绊档案 · BOND ARCHIVE · TSUKIMI · PLAY RECORD ·&nbsp;&nbsp;&nbsp;
      </div>
    </div>

    <!-- 四角坐标 -->
    <div class="mg-corner tl">SYS:01 / REC-A</div>
    <div class="mg-corner tr">CHRONICLE.v1</div>
    <div class="mg-corner bl">BOND · ARCHIVE</div>
    <div class="mg-corner br">READ ONLY</div>

    <!-- 中央卡片 -->
    <div id="_mg_card">
      <div id="_mg_eyebrow">- - AUTHENTICATION REQUIRED - -</div>
      <div id="_mg_title">Chronicle</div>
      <div id="_mg_subtitle">羁绊档案 · 访问验证</div>

      <!-- 时长数字 -->
      <div id="_mg_dur_row">
        <div id="_mg_dur_cur">
          <span id="_mg_cur_val">0</span><span class="mg-unit" id="_mg_cur_unit">h</span>
        </div>
        <div id="_mg_dur_target">/ 4.4h</div>
      </div>

      <!-- 进度条 -->
      <div id="_mg_track">
        <div id="_mg_fill"></div>
      </div>
      <div id="_mg_pct_row">
        <span>游玩进度</span>
        <span id="_mg_pct_val" class="mg-pct-val">0%</span>
      </div>

      <div class="mg-sep"></div>

      <!-- 未解锁提示 -->
      <div id="_mg_locked_box">
        <div id="_mg_lock_icon">UNLOCK CONDITION</div>
        <div id="_mg_remain_label">距解锁「羁绊档案」还差</div>
        <div id="_mg_remain_val">
          <span id="_mg_rem_val">—</span><span class="mg-unit" id="_mg_rem_unit">h</span>
        </div>
        <div id="_mg_unlock_tip">累计游玩达 4.4h 后自动解锁</div>
      </div>

      <!-- 解锁中：电池格子 -->
      <div id="_mg_battery_box">
        <div id="_mg_battery_label">LOADING BOND ARCHIVE</div>
        <div id="_mg_cells"></div>
        <div id="_mg_battery_tip">正在载入羁绊档案...</div>
      </div>
    </div>

    <!-- 底部装饰 -->
    <div id="_mg_footer">
      <div class="mg-dot-row">
        <div class="mg-mini-dot rose"></div>
        <div class="mg-mini-dot"></div>
        <div class="mg-mini-dot blue"></div>
        <div class="mg-mini-dot"></div>
        <div class="mg-mini-dot violet"></div>
      </div>
      <div id="_mg_ver">TSUKI · CHRONICLE</div>
      <div class="mg-dot-row">
        <div class="mg-mini-dot violet"></div>
        <div class="mg-mini-dot"></div>
        <div class="mg-mini-dot blue"></div>
        <div class="mg-mini-dot"></div>
        <div class="mg-mini-dot rose"></div>
      </div>
    </div>
  `;

  function mountMask() {
    if (document.body) {
      document.body.appendChild(mask);
    } else {
      document.addEventListener('DOMContentLoaded', () => document.body.appendChild(mask), { once: true });
    }
  }
  mountMask();

  /* ──────────────────────────────────────────────
     2. 工具函数
  ────────────────────────────────────────────── */
  function openDB() {
    return new Promise((res, rej) => {
      const req = indexedDB.open(IDB_NAME);
      req.onsuccess  = e => res(e.target.result);
      req.onerror    = e => rej(e.target.error);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE))
          db.createObjectStore(STORE, { keyPath: 'id' });
      };
    });
  }

  async function idbGet(key) {
    try {
      const db = await (window.tsukiDbReady || openDB());
      return new Promise((res) => {
        try {
          const tx  = db.transaction(STORE, 'readonly');
          const req = tx.objectStore(STORE).get(key);
          req.onsuccess = e => res(e.target.result?.value ?? null);
          req.onerror   = () => res(null);
        } catch { res(null); }
      });
    } catch {
      return null;
    }
  }

  async function getLoggedInQQ() {
    return await idbGet('auth_logged_in_qq');   // 与 auth.js K.qq 同步
  }

  async function getDuration() {
    const raw = await idbGet(DUR_KEY);
    return Number(raw) || 0;
  }

  /* 格式化秒数显示 */
  function fmtH(sec) {
    const h = (sec / 3600).toFixed(2);
    return { val: h, unit: 'h' };
  }
  function fmtRemain(sec) {
    if (sec <= 0) return { val: '0', unit: 'h' };
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) return { val: `${h}:${String(m).padStart(2,'0')}`, unit: 'h' };
    if (m > 0) return { val: `${m}:${String(s).padStart(2,'0')}`, unit: 'min' };
    return { val: String(s), unit: 's' };
  }

  /* ──────────────────────────────────────────────
     3. 渲染蒙版内容
  ────────────────────────────────────────────── */
  function renderMask(durSec) {
    const pct    = Math.min(100, (durSec / TARGET_SEC) * 100);
    const remSec = Math.max(0, Math.ceil(TARGET_SEC - durSec));
    const cur    = fmtH(durSec);
    const rem    = fmtRemain(remSec);

    /* 当前时长 */
    document.getElementById('_mg_cur_val').textContent  = cur.val;
    document.getElementById('_mg_cur_unit').textContent = cur.unit;

    /* 进度条 */
    requestAnimationFrame(() => {
      setTimeout(() => {
        document.getElementById('_mg_fill').style.width = pct.toFixed(1) + '%';
      }, 80);
    });
    document.getElementById('_mg_pct_val').textContent = pct.toFixed(1) + '%';

    if (durSec < TARGET_SEC) {
      /* ── 未达标：显示还差多少 ── */
      document.getElementById('_mg_rem_val').textContent  = rem.val;
      document.getElementById('_mg_rem_unit').textContent = rem.unit;
    }
  }

  /* ──────────────────────────────────────────────
     4. 解锁动画（电池格子 loading）
  ────────────────────────────────────────────── */
  function runUnlockAnimation(isAdmin = false) {
    /* 隐藏锁定框，显示电池框 */
    document.getElementById('_mg_locked_box').style.display = 'none';
    const batteryBox = document.getElementById('_mg_battery_box');
    batteryBox.style.display = 'flex';

    /* 生成格子 */
    const cellsEl = document.getElementById('_mg_cells');
    cellsEl.innerHTML = '';
    const cells = [];
    for (let i = 0; i < CELL_COUNT; i++) {
      const c = document.createElement('div');
      c.className = 'mg-cell';
      if (i === CELL_COUNT - 1)           c.classList.add('last');       // violet
      else if (i >= Math.floor(CELL_COUNT * 0.42) &&
               i < CELL_COUNT - 1)        c.classList.add('mid');        // blue
      // else: default rose
      cellsEl.appendChild(c);
      cells.push(c);
    }

    /* 管理员身份提示 */
    if (isAdmin) {
      document.getElementById('_mg_battery_label').textContent = 'ADMINISTRATOR ACCESS';
      document.getElementById('_mg_battery_tip').textContent   = '管理员身份 · 已跳过时长验证';
      document.getElementById('_mg_battery_tip').style.color   = 'rgba(253,164,175,.6)';
    }

    /* 逐格点亮 */
    const interval = FILL_MS / CELL_COUNT;
    let idx = 0;
    const ticker = setInterval(() => {
      if (idx < cells.length) {
        cells[idx].classList.add('lit');
        idx++;
      } else {
        clearInterval(ticker);
        /* 全亮后稍等，移除蒙版 */
        setTimeout(() => {
          mask.style.transition = 'opacity .5s ease';
          mask.style.opacity = '0';
          setTimeout(() => mask.remove(), 520);
        }, 300);
      }
    }, interval);
  }

  /* ──────────────────────────────────────────────
     5. 主流程
  ────────────────────────────────────────────── */
  async function run() {
    /* 等 DB 就绪（给 db-schema.js 时间执行）*/
    if (window.tsukiDbReady) {
      try { await window.tsukiDbReady; } catch { /* ignore */ }
    }

    /* ── 管理员直通：Tsukimi44 跳过时长验证，走 loading 但标注身份 ── */
    const qq = await getLoggedInQQ();
    const isAdmin = (qq === 'Tsukimi44');
    if (isAdmin) {
      setTimeout(() => runUnlockAnimation(true), 200);
      return;
    }

    const durSec = await getDuration();
    renderMask(durSec);

    if (durSec >= TARGET_SEC) {
      /* 达标 → 直接播放解锁动画 */
      setTimeout(() => runUnlockAnimation(), 400);
    }
    /* 未达标 → 锁定框持续显示，无需额外操作 */
  }

  /* DOMContentLoaded 后执行（确保蒙版已挂载） */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run, { once: true });
  } else {
    run();
  }

})();
