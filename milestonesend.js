/**
 * milestonesend.js
 * Chronicle · 羁绊档案 — AI 关系总结模块
 * ─────────────────────────────────────────────────────
 * 依赖：PromptHelper.js（assembleCharacterPrompts / buildFinalPromptStream / buildChatHistoryPrompt）
 *       db-schema.js（window.openDb / window.tsukiDbReady）
 * 功能：
 *   · 弹出聊天选择面板（含条数设定）
 *   · 组装系统提示词 + 角色人设 + 世界书 + 聊天历史
 *   · 调用 API（从 IDB config 读 url/key/model）
 *   · 解析 AI 返回 JSON → 渲染 10 个多样化关系卡片
 *   · NSFW 卡片锁定 + 解锁动画
 *   · 结果持久化到 IDB（milestone_relations 表）
 *   · 全程控制台打印：提示词 / 原始响应 / 解析结果
 * ─────────────────────────────────────────────────────
 */

(function () {
  'use strict';

  /* ════════════════════════════════════════════════════
     0. 常量 & 工具
  ════════════════════════════════════════════════════ */

  const STORE_NAME = 'milestone_relations';

  function esc(s) {
    if (!s) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async function getDb() {
    if (typeof window.openDb === 'function') return window.openDb();
    if (window.tsukiDbReady) return window.tsukiDbReady;
    return new Promise((res, rej) => {
      const r = indexedDB.open('tsukiphonepromax');
      r.onsuccess = e => res(e.target.result);
      r.onerror = e => rej(e.target.error);
    });
  }

  async function ensureRelationsStore() {
    // milestone_relations 现在由 db-schema.js 统一管理，直接返回连接即可
    return getDb();
  }

  async function idbGet(store, key) {
    const db = await getDb();
    return new Promise(res => {
      try {
        const tx = db.transaction(store, 'readonly');
        const req = tx.objectStore(store).get(key);
        req.onsuccess = () => res(req.result || null);
        req.onerror = () => res(null);
      } catch { res(null); }
    });
  }

  async function idbGetAll(store) {
    const db = await getDb();
    return new Promise(res => {
      try {
        const tx = db.transaction(store, 'readonly');
        const req = tx.objectStore(store).getAll();
        req.onsuccess = () => res(req.result || []);
        req.onerror = () => res([]);
      } catch { res([]); }
    });
  }

  async function idbPut(store, obj) {
    const db = await ensureRelationsStore();
    return new Promise((res, rej) => {
      const tx = db.transaction(store, 'readwrite');
      const req = tx.objectStore(store).put(obj);
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  }

  async function idbGetByIndex(store, index, val) {
    const db = await getDb();
    return new Promise(res => {
      try {
        const tx = db.transaction(store, 'readonly');
        const s = tx.objectStore(store);
        if (!s.indexNames.contains(index)) {
          const req = s.getAll();
          req.onsuccess = () => {
            const field = index.replace('by_', '');
            res((req.result || []).filter(r => r[field] === val));
          };
          req.onerror = () => res([]);
          return;
        }
        const req = s.index(index).getAll(IDBKeyRange.only(val));
        req.onsuccess = () => res(req.result || []);
        req.onerror = () => res([]);
      } catch { res([]); }
    });
  }

  /* ════════════════════════════════════════════════════
     1. 读取 API 配置（从 IDB config 表的 main_config）
  ════════════════════════════════════════════════════ */

  async function getApiConfig() {
    const cfg = await idbGet('config', 'main_config');
    if (!cfg || !cfg.api) {
      throw new Error('未找到 API 配置，请先在 Settings 页面配置 API URL / Key / Model');
    }
    const { url, key, model, temp } = cfg.api.temp || {};
    if (!url || !key) throw new Error('API URL 或 Key 为空，请先在 Settings 中填写');
    return {
      url: url.replace(/\/+$/, '').replace(/\/v1$/, ''),
      key,
      model: model || 'gpt-4o',
      temp: parseFloat(temp || 0.8),
    };
  }

  /* ════════════════════════════════════════════════════
     2. 系统提示词 — 关系分析专用（前置简短指令）
  ════════════════════════════════════════════════════ */

  function buildRelationSystemPromptHead() {
    return `You are a relationship analyst observing two people's conversation records from an outside perspective.
Your task: carefully read the character persona, world settings, and full conversation history provided below, then analyze the relationship between the two people.
RULES:
- All text values must be in Chinese.
- No emoji anywhere in your output.
- Narrative text should feel like a quiet observer recounting what they witnessed — not a report, not a verdict. Leave space for ambiguity. Let details speak.
- For NSFW fields, be observational and atmospheric, not explicit. Focus on tension, proximity, subtext.`;
  }

  function buildRelationSystemPromptTail() {
    return `Now analyze the character persona, world settings, and conversation history provided above, and return a strict JSON object.
CRITICAL: Return ONLY valid JSON. No markdown, no code fences, no commentary. Just the raw JSON object.

Return exactly this JSON structure:
{
  "relation_tag": "string — 2-6 char relationship qualifier, poetic (e.g. 深夜的共谋者)",
  "relation_narrative": "string — 80-120 char third-person narrative about this relationship, restraint + warmth",
  "radar": {
    "intimacy": 0-100,
    "trust": 0-100,
    "dependency": 0-100,
    "conflict": 0-100,
    "resonance": 0-100,
    "uniqueness": 0-100
  },
  "timeline": [
    { "phase": "起始期", "emotion_tag": "string 2-4 char", "summary": "string 25-40 char" },
    { "phase": "转折期", "emotion_tag": "string 2-4 char", "summary": "string 25-40 char" },
    { "phase": "当前期", "emotion_tag": "string 2-4 char", "summary": "string 25-40 char" }
  ],
  "emotion_words": [
    { "word": "string 2-5 char", "weight": 1-5 }
  ],
  "moments": [
    { "summary": "string 30-60 char — written as a quiet confession from inside the relationship. Not what happened, but how it felt. Warm, specific, personal — like something only the person who lived it would remember this way.", "floor_hint": "string e.g. 约在第20-35楼" }
  ],
  "shadow_line": "string or null — one quiet observation about hidden tension. null if none detected",
  "epitaph": "string — one sentence, poetic verdict on the relationship",
  "nsfw_polar": {
    "initiative": 0-100,
    "restraint": 0-100,
    "possessiveness": 0-100,
    "sensitivity": 0-100,
    "boundary": 0-100,
    "depth": 0-100
  },
  "nsfw_narrative": "string — 100-150 char atmospheric third-person observation of intimacy texture. No explicit acts. Tension, proximity, implication only.",
  "nsfw_codewords": [
    { "word": "string — a word, phrase, or small gesture that only the two of them have quietly charged with meaning through their closeness. Can be completely ordinary on the surface.", "reading": "string — what it means between them; the unspoken warmth, want, or tenderness behind it. Written softly, like something confided." }
  ]
}

emotion_words: exactly 5 items, weight 1-5 (5=most prominent).
moments: exactly 3 items.
nsfw_codewords: 3-5 items.`;
  }

  /* ════════════════════════════════════════════════════
     3. 组装完整提示词流
  ════════════════════════════════════════════════════ */

  async function buildFullPrompt(chatId, historyCount) {
    const chat = await idbGet('chats', chatId);
    if (!chat) throw new Error(`找不到 chatId: ${chatId}`);

    const charIds = chat.charIds || [];
    const chatUserId = chat.userId || null;

    // PromptHelper 负责：角色世界书前 / 人设 / 世界书后 / 用户人设
    const personaPrompts = await window.assembleCharacterPrompts(charIds, '', chatUserId);

    // buildFinalPromptStream：全局世界书 + 人设注入 + 历史记录
    const stream = await window.buildFinalPromptStream(
      charIds,
      personaPrompts,
      historyCount,
      '所有',
      '',
      chatId,
    );

    // ★ 结构：[前置系统指令] + [人设+世界书+历史记录] + [末尾格式要求]
    const systemPromptHead = buildRelationSystemPromptHead();
    const systemPromptTail = buildRelationSystemPromptTail();
    const finalSystemContent = [systemPromptHead, ...stream, systemPromptTail].join('\n\n');

    return finalSystemContent;
  }

  /* ════════════════════════════════════════════════════
     4. API 调用
  ════════════════════════════════════════════════════ */

  async function callApi(systemContent) {
    const cfg = await getApiConfig();

    const requestBody = {
      model: cfg.model,
      temperature: cfg.temp,
      messages: [
        { role: 'system', content: systemContent },
        { role: 'user', content: '请根据以上对话记录，返回关系分析 JSON。' },
      ],
    };

    // ─── 控制台打印：发送前 ───
    console.group('%c[milestonesend] API 请求详情', 'color:#c4b5fd;font-weight:bold;font-size:12px');
    console.log('%c[TARGET]', 'color:#fcd34d', `${cfg.url}/v1/chat/completions`);
    console.log('%c[MODEL]', 'color:#fcd34d', cfg.model);
    console.log('%c[SYSTEM PROMPT — 完整内容]', 'color:#93c5fd');
    console.log(systemContent);
    console.log('%c[REQUEST BODY]', 'color:#a78bfa');
    console.log(JSON.stringify(requestBody, null, 2));
    console.groupEnd();

    const res = await fetch(`${cfg.url}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.key}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('[milestonesend] API 错误', res.status, errText);
      throw new Error(`API 返回 HTTP ${res.status}: ${errText.slice(0, 200)}`);
    }

    const data = await res.json();
    const rawText = data.choices?.[0]?.message?.content || '';

    // ─── 控制台打印：原始响应 ───
    console.group('%c[milestonesend] API 原始响应', 'color:#5eead4;font-weight:bold;font-size:12px');
    console.log('%c[RAW TEXT]', 'color:#fcd34d');
    console.log(rawText);
    console.groupEnd();

    // 解析 JSON（清理 markdown 代码块包裹）
    let parsed;
    try {
      const clean = rawText.replace(/```json|```/g, '').trim();
      parsed = JSON.parse(clean);
    } catch (e) {
      console.error('[milestonesend] JSON 解析失败', e, rawText);
      throw new Error('AI 返回格式无法解析，请重试');
    }

    // ─── 控制台打印：解析结果 ───
    console.group('%c[milestonesend] 解析结果', 'color:#fda4af;font-weight:bold;font-size:12px');
    console.log(parsed);
    console.groupEnd();

    return parsed;
  }

  /* ════════════════════════════════════════════════════
     5. 持久化结果到 IDB
  ════════════════════════════════════════════════════ */

  async function saveResult(charId, chatId, result) {
    const id = `mrel_${chatId}_${Date.now()}`;
    const record = {
      id,
      charId,
      chatId,
      result,
      createdAt: Date.now(),
    };
    await idbPut(STORE_NAME, record);
    console.log(`%c[milestonesend] 结果已持久化 id=${id}`, 'color:#43d9a0');
    return id;
  }

  /* ════════════════════════════════════════════════════
     6. 渲染系统：预览卡片 + 全屏详情页
  ════════════════════════════════════════════════════ */

  // ── 渲染一张可点击的"摘要预览卡"，插入到 container ──
  function renderPreviewCard(record, container, charName, chatName) {
    const { result, id, createdAt } = record;
    const dateStr = createdAt ? new Date(createdAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric', year: 'numeric' }) : '—';

    // 雷达值：取前3高的维度作为摘要标签
    const radarEntries = Object.entries(result.radar || {}).sort((a,b) => b[1]-a[1]);
    const topDims = radarEntries.slice(0,3).map(([k,v]) => {
      const nameMap = { intimacy:'亲密', trust:'信任', dependency:'依赖', conflict:'冲突', resonance:'共鸣', uniqueness:'独特' };
      return `<span class="mrel-pc-dim">${nameMap[k]||k} <b>${v}</b></span>`;
    }).join('');

    // 情绪词（权重最高的2个）
    const topWords = (result.emotion_words||[]).sort((a,b)=>b.weight-a.weight).slice(0,2)
      .map(w=>`<span class="mrel-pc-emo">${esc(w.word)}</span>`).join('');

    // 预览卡样式变体：按 createdAt hash 选色
    const VARIANTS = ['mrel-pc--violet','mrel-pc--rose','mrel-pc--teal','mrel-pc--amber','mrel-pc--dark'];
    const variant = VARIANTS[Math.abs(createdAt % VARIANTS.length)];

    const card = document.createElement('div');
    card.className = `mrel-preview-card ${variant}`;
    card.dataset.recordId = id;
    card.innerHTML = `
      <div class="mrel-pc-film">
        <div class="mrel-pc-film-holes"><span></span><span></span><span></span></div>
        <div class="mrel-pc-film-txt">CHRONICLE · ${esc(charName)} · ${esc(chatName)} · RELATION ·&nbsp;</div>
      </div>
      <div class="mrel-pc-body">
        <div class="mrel-pc-top">
          <div class="mrel-pc-tag">${esc(result.relation_tag || '—')}</div>
          <div class="mrel-pc-date">${dateStr}</div>
        </div>
        <div class="mrel-pc-narrative">${esc(result.relation_narrative || '')}</div>
        <div class="mrel-pc-footer">
          <div class="mrel-pc-dims">${topDims}</div>
          <div class="mrel-pc-emos">${topWords}</div>
          <div class="mrel-pc-arrow"><i class="fa fa-arrow-right"></i></div>
        </div>
      </div>
      <div class="mrel-pc-epitaph">${esc(result.epitaph || '')}</div>
    `;
    card.addEventListener('click', () => openDetailPage(record, charName, chatName));
    container.appendChild(card);

    // 入场动画
    card.style.opacity = '0';
    card.style.transform = 'translateY(10px)';
    requestAnimationFrame(() => {
      card.style.transition = 'opacity .3s ease, transform .3s cubic-bezier(.22,1,.36,1)';
      card.style.opacity = '1';
      card.style.transform = 'translateY(0)';
    });
  }

  // ── 全屏详情页 ──
  function openDetailPage(record, charName, chatName) {
    const existing = document.getElementById('mrel-detail-page');
    if (existing) existing.remove();

    const page = document.createElement('div');
    page.id = 'mrel-detail-page';
    page.innerHTML = `
      <div class="mrel-dp-header">
        <button class="mrel-dp-back" id="mrel-dp-back">
          <i class="fa fa-arrow-left"></i>
        </button>
        <div class="mrel-dp-title">
          <div class="mrel-dp-title-main">${esc(record.result?.relation_tag || '关系总结')}</div>
          <div class="mrel-dp-title-sub">${esc(charName)} · ${esc(chatName)}</div>
        </div>
        <div class="mrel-dp-id">${record.id ? record.id.slice(-8) : ''}</div>
      </div>
      <div class="mrel-dp-scroll" id="mrel-dp-scroll"></div>
    `;
    document.body.appendChild(page);

    // 渲染所有内容卡片到 scroll 区域
    const scrollEl = page.querySelector('#mrel-dp-scroll');
    renderDetailCards(record.result, scrollEl, charName, chatName, record.id);

    // 关闭
    page.querySelector('#mrel-dp-back').addEventListener('click', () => {
      page.style.transition = 'opacity .22s ease, transform .22s ease';
      page.style.opacity = '0';
      page.style.transform = 'translateX(20px)';
      setTimeout(() => page.remove(), 250);
    });

// 删除当前记录
    page.querySelector('.mrel-dp-id').addEventListener('click', async () => {
      if (!record.id) return;
      if (!confirm('删除这条关系总结？此操作不可恢复。')) return;
      try {
        const db = await getDb();
        await new Promise((res, rej) => {
          const tx = db.transaction(STORE_NAME, 'readwrite');
          const req = tx.objectStore(STORE_NAME).delete(record.id);
          req.onsuccess = () => res();
          req.onerror = () => rej(req.error);
        });
        // 同步移除预览卡片
        const previewCard = document.querySelector(`.mrel-preview-card[data-record-id="${record.id}"]`);
        if (previewCard) previewCard.remove();
        // 关闭详情页
        page.style.transition = 'opacity .22s ease, transform .22s ease';
        page.style.opacity = '0';
        page.style.transform = 'translateX(20px)';
        setTimeout(() => page.remove(), 250);
      } catch (err) {
        alert('删除失败：' + err.message);
      }
    });
    
    // 入场
    page.style.opacity = '0';
    page.style.transform = 'translateX(20px)';
    requestAnimationFrame(() => {
      page.style.transition = 'opacity .25s ease, transform .25s cubic-bezier(.22,1,.36,1)';
      page.style.opacity = '1';
      page.style.transform = 'translateX(0)';
    });
  }

  // ── 详情页内部：渲染所有内容卡片 ──
  function renderDetailCards(result, container, charName, chatName, recordId) {
    container.innerHTML = '';

    const cards = [
      buildCard_RelationTag(result, charName, chatName, recordId),
      buildCard_Radar(result.radar),
      buildCard_Timeline(result.timeline),
      buildCard_EmotionWords(result.emotion_words),
      buildCard_Moments(result.moments),
    ];
    if (result.shadow_line) cards.push(buildCard_ShadowLine(result.shadow_line));
    cards.push(
      buildCard_Epitaph(result.epitaph),
      buildCard_NsfwPolar(result.nsfw_polar),
      buildCard_NsfwNarrative(result.nsfw_narrative),
      buildCard_NsfwCodewords(result.nsfw_codewords),
    );

    cards.forEach((c, i) => {
      c.style.opacity = '0';
      c.style.transform = 'translateY(12px)';
      container.appendChild(c);
      setTimeout(() => {
        c.style.transition = 'opacity .32s ease, transform .32s cubic-bezier(.22,1,.36,1)';
        c.style.opacity = '1';
        c.style.transform = 'translateY(0)';
      }, 60 + i * 55);
    });
  }

  // ── 兼容旧接口：renderCards 现在插入预览卡（单条）──
  function renderCards(result, container, charName, chatName, recordId) {
    renderPreviewCard({ result, id: recordId, createdAt: Date.now() }, container, charName, chatName);
  }

  /* ── 卡片 0：关系定性 ─────────────────────────── */
  function buildCard_RelationTag(result, charName, chatName, recordId) {
    const el = document.createElement('div');
    el.className = 'mrel-card mrel-card--tag';
    el.innerHTML = `
      <div class="mrel-card-film">
        <div class="mrel-film-holes"><span></span><span></span><span></span><span></span></div>
        <div class="mrel-film-text">CHRONICLE · RELATION ANALYSIS · ${esc(charName)} · ${esc(chatName)} · </div>
      </div>
      <div class="mrel-tag-body">
        <div class="mrel-tag-eyebrow">RELATION TYPE</div>
        <div class="mrel-tag-word">${esc(result.relation_tag)}</div>
        <div class="mrel-tag-narrative">${esc(result.relation_narrative)}</div>
        <div class="mrel-tag-meta">
          <span class="mrel-tag-chat">${esc(chatName)}</span>
          <span class="mrel-tag-id">${recordId ? recordId.slice(-12) : '—'}</span>
        </div>
      </div>
    `;
    return el;
  }

  /* ── 卡片 1：六边形雷达图 ─────────────────────── */
  function buildCard_Radar(radar) {
    const el = document.createElement('div');
    el.className = 'mrel-card mrel-card--radar';

    const labels = [
      { key: 'intimacy', label: '亲密度' },
      { key: 'trust', label: '信任感' },
      { key: 'dependency', label: '依赖性' },
      { key: 'conflict', label: '冲突值' },
      { key: 'resonance', label: '情绪共鸣' },
      { key: 'uniqueness', label: '独特性' },
    ];

    const cx = 110, cy = 110, R = 80;
    const n = labels.length;
    const toRad = deg => (deg * Math.PI) / 180;
    const angleFn = i => toRad(-90 + (360 / n) * i);

    // 网格线 5 层
    let gridLines = '';
    for (let r = 1; r <= 5; r++) {
      const pts = labels
        .map((_, i) => {
          const a = angleFn(i);
          const d = (R * r) / 5;
          return `${cx + d * Math.cos(a)},${cy + d * Math.sin(a)}`;
        })
        .join(' ');
      gridLines += `<polygon points="${pts}" fill="none" stroke="rgba(196,181,253,.15)" stroke-width="1"/>`;
    }

    // 轴线
    let axisLines = '';
    labels.forEach((_, i) => {
      const a = angleFn(i);
      axisLines += `<line x1="${cx}" y1="${cy}" x2="${cx + R * Math.cos(a)}" y2="${cy + R * Math.sin(a)}" stroke="rgba(196,181,253,.2)" stroke-width="1"/>`;
    });

    // 数据多边形
    const dataPts = labels
      .map(({ key }, i) => {
        const v = Math.min(100, Math.max(0, radar[key] || 0));
        const a = angleFn(i);
        const d = (R * v) / 100;
        return `${cx + d * Math.cos(a)},${cy + d * Math.sin(a)}`;
      })
      .join(' ');

    // 标签
    let labelEls = '';
    labels.forEach(({ label }, i) => {
      const a = angleFn(i);
      const lx = cx + (R + 18) * Math.cos(a);
      const ly = cy + (R + 18) * Math.sin(a);
      const anchor = Math.cos(a) > 0.1 ? 'start' : Math.cos(a) < -0.1 ? 'end' : 'middle';
      const dy = Math.sin(a) > 0.1 ? '1em' : Math.sin(a) < -0.1 ? '0' : '0.35em';
      labelEls += `<text x="${lx}" y="${ly}" dy="${dy}" text-anchor="${anchor}" font-size="7.5" fill="rgba(100,60,180,.88)" font-family="'Geist Mono',monospace" letter-spacing=".06em">${label}</text>`;
    });

    // 顶点数值标注
    let valEls = '';
    labels.forEach(({ key }, i) => {
      const v = Math.min(100, Math.max(0, radar[key] || 0));
      const a = angleFn(i);
      const d = (R * v) / 100;
      const vx = cx + d * Math.cos(a);
      const vy = cy + d * Math.sin(a);
      valEls += `<circle cx="${vx}" cy="${vy}" r="3" fill="#c4b5fd"/>`;
    });

    el.innerHTML = `
      <div class="mrel-card-head">
        <span class="mrel-card-lbl">BOND RADAR</span>
        <span class="mrel-card-sub">六维关系分析</span>
      </div>
      <div class="mrel-radar-wrap">
        <svg viewBox="0 0 220 220" width="100%" style="max-width:220px;display:block;margin:0 auto;">
          ${gridLines}
          ${axisLines}
          <polygon points="${dataPts}" fill="rgba(196,181,253,.15)" stroke="#c4b5fd" stroke-width="1.5" stroke-linejoin="round"/>
          ${valEls}
          ${labelEls}
        </svg>
      </div>
      <div class="mrel-radar-vals">
        ${labels.map(({ key, label }) => `
          <div class="mrel-radar-val-item">
            <span class="mrel-radar-val-lbl">${label}</span>
            <div class="mrel-radar-val-bar">
              <div class="mrel-radar-val-fill" style="width:${radar[key] || 0}%"></div>
            </div>
            <span class="mrel-radar-val-num">${radar[key] || 0}</span>
          </div>
        `).join('')}
      </div>
    `;
    return el;
  }

  /* ── 卡片 2：关系时间线 ────────────────────────── */
  function buildCard_Timeline(timeline) {
    const el = document.createElement('div');
    el.className = 'mrel-card mrel-card--timeline';
    const items = (timeline || []).map((t, i) => `
      <div class="mrel-tl-item">
        <div class="mrel-tl-dot ${i === 0 ? 'start' : i === timeline.length - 1 ? 'end' : 'mid'}"></div>
        <div class="mrel-tl-content">
          <div class="mrel-tl-phase">${esc(t.phase)}</div>
          <div class="mrel-tl-emotion">${esc(t.emotion_tag)}</div>
          <div class="mrel-tl-summary">${esc(t.summary)}</div>
        </div>
      </div>
    `).join('');
    el.innerHTML = `
      <div class="mrel-card-head">
        <span class="mrel-card-lbl">TIMELINE</span>
        <span class="mrel-card-sub">关系三阶段</span>
      </div>
      <div class="mrel-timeline">${items}</div>
    `;
    return el;
  }

  /* ── 卡片 3：情绪词云 ──────────────────────────── */
  function buildCard_EmotionWords(words) {
    const el = document.createElement('div');
    el.className = 'mrel-card mrel-card--emotions';
    const sizes = [11, 13, 16, 19, 23];
    // 不规则排布：用 weight 控制字号，错落排列
    const pills = (words || []).map((w, i) => {
      const sz = sizes[Math.min(w.weight - 1, 4)];
      const offset = i % 2 === 0 ? 0 : 5;
      return `<span class="mrel-emo-word" style="font-size:${sz}px;margin-top:${offset}px;">${esc(w.word)}</span>`;
    }).join('');
    el.innerHTML = `
      <div class="mrel-card-head">
        <span class="mrel-card-lbl">EMOTION FIELD</span>
        <span class="mrel-card-sub">高频情绪</span>
      </div>
      <div class="mrel-emo-cloud">${pills}</div>
    `;
    return el;
  }

  /* ── 卡片 4：标志性瞬间 ────────────────────────── */
  function buildCard_Moments(moments) {
    const el = document.createElement('div');
    el.className = 'mrel-card mrel-card--moments';
    const items = (moments || []).map((m, i) => `
      <div class="mrel-moment-item">
        <div class="mrel-moment-num">${String(i + 1).padStart(2, '0')}</div>
        <div class="mrel-moment-body">
          <div class="mrel-moment-summary">${esc(m.summary)}</div>
          <div class="mrel-moment-floor">${esc(m.floor_hint)}</div>
        </div>
      </div>
    `).join('');
    el.innerHTML = `
      <div class="mrel-card-head">
        <span class="mrel-card-lbl">MARKED MOMENTS</span>
        <span class="mrel-card-sub">值得被记住的瞬间</span>
      </div>
      <div class="mrel-moments">${items}</div>
    `;
    return el;
  }

  /* ── 卡片 5：关系暗线 ──────────────────────────── */
  function buildCard_ShadowLine(shadow) {
    const el = document.createElement('div');
    el.className = 'mrel-card mrel-card--shadow';
    el.innerHTML = `
      <div class="mrel-shadow-inner">
        <div class="mrel-shadow-icon">// SHADOW //</div>
        <div class="mrel-shadow-text">${esc(shadow)}</div>
      </div>
    `;
    return el;
  }

  /* ── 卡片 6：一句定论 ──────────────────────────── */
  function buildCard_Epitaph(epitaph) {
    const el = document.createElement('div');
    el.className = 'mrel-card mrel-card--epitaph';
    el.innerHTML = `
      <div class="mrel-epitaph-inner">
        <div class="mrel-epitaph-label">EPITAPH</div>
        <div class="mrel-epitaph-text">${esc(epitaph)}</div>
        <div class="mrel-epitaph-deco">— Chronicle</div>
      </div>
    `;
    return el;
  }

  /* ── 卡片 7：NSFW 极坐标散点图（锁定）─────────── */
  function buildCard_NsfwPolar(polar) {
    const el = document.createElement('div');
    el.className = 'mrel-card mrel-card--nsfw mrel-card--locked';
    el.dataset.locked = '1';

    const labels = [
      { key: 'initiative', label: '主动性' },
      { key: 'restraint', label: '克制度' },
      { key: 'possessiveness', label: '占有欲' },
      { key: 'sensitivity', label: '敏感带' },
      { key: 'boundary', label: '边界感' },
      { key: 'depth', label: '依赖' },
    ];

    // 极坐标散点：每个维度在对应角度上，按值决定距离中心的远近
    const cx = 110, cy = 110, R = 80;
    const n = labels.length;
    const toRad = deg => (deg * Math.PI) / 180;
    const angleFn = i => toRad(-90 + (360 / n) * i);

    // 同心圆网格
    let rings = '';
    for (let r = 1; r <= 4; r++) {
      rings += `<circle cx="${cx}" cy="${cy}" r="${(R * r) / 4}" fill="none" stroke="rgba(253,164,175,.1)" stroke-width="1" stroke-dasharray="3,3"/>`;
    }

    // 散点（每个维度2-3个点，沿轴方向随机偏移，模拟散落效果）
    let dots = '';
    labels.forEach(({ key }, i) => {
      const v = Math.min(100, Math.max(0, polar[key] || 0));
      const a = angleFn(i);
      const d = (R * v) / 100;
      // 主点
      const px = cx + d * Math.cos(a);
      const py = cy + d * Math.sin(a);
      // 散点群（3个，沿垂直于轴方向小幅偏移）
      const perp = a + Math.PI / 2;
      const offsets = [-8, 0, 8];
      offsets.forEach((off, oi) => {
        const r2 = d * (0.7 + oi * 0.15);
        const sx = cx + r2 * Math.cos(a) + off * Math.cos(perp) * 0.3;
        const sy = cy + r2 * Math.sin(a) + off * Math.sin(perp) * 0.3;
        const opacity = oi === 1 ? 0.9 : 0.4;
        const radius = oi === 1 ? 4 : 2.5;
        dots += `<circle cx="${sx}" cy="${sy}" r="${radius}" fill="#fda4af" opacity="${opacity}"/>`;
      });
    });

    // 轴线（虚线）
    let axes = '';
    labels.forEach(({ label }, i) => {
      const a = angleFn(i);
      axes += `<line x1="${cx}" y1="${cy}" x2="${cx + R * Math.cos(a)}" y2="${cy + R * Math.sin(a)}" stroke="rgba(253,164,175,.15)" stroke-width="1" stroke-dasharray="2,3"/>`;
      const lx = cx + (R + 18) * Math.cos(a);
      const ly = cy + (R + 18) * Math.sin(a);
      const anchor = Math.cos(a) > 0.1 ? 'start' : Math.cos(a) < -0.1 ? 'end' : 'middle';
      const dy = Math.sin(a) > 0.1 ? '1em' : Math.sin(a) < -0.1 ? '0' : '0.35em';
      axes += `<text x="${lx}" y="${ly}" dy="${dy}" text-anchor="${anchor}" font-size="6.5" fill="rgba(220,80,110,.85)" font-family="'Geist Mono',monospace">${label}</text>`;
    });

    const svgContent = `
      <svg viewBox="0 0 220 220" width="100%" style="max-width:220px;display:block;margin:0 auto;">
        ${rings}${axes}${dots}
      </svg>
    `;

    el.innerHTML = `
      <div class="mrel-card-head">
        <span class="mrel-card-lbl" style="color:#fda4af;">INTIMATE FIELD</span>
        <span class="mrel-card-sub">欲望张力分布</span>
      </div>
      <div class="mrel-nsfw-content">
        ${svgContent}
      </div>
      <div class="mrel-lock-overlay" onclick="window.__mrelUnlock(this)">
        <div class="mrel-lock-icon">[ LOCKED ]</div>
        <div class="mrel-lock-hint">点击解锁</div>
      </div>
    `;
    return el;
  }

  /* ── 卡片 8：NSFW 亲密叙事（锁定）─────────────── */
  function buildCard_NsfwNarrative(narrative) {
    const el = document.createElement('div');
    el.className = 'mrel-card mrel-card--nsfw mrel-card--locked';
    el.dataset.locked = '1';
    el.innerHTML = `
      <div class="mrel-card-head">
        <span class="mrel-card-lbl" style="color:#fda4af;">INTIMATE TEXTURE</span>
        <span class="mrel-card-sub">亲密互动质感</span>
      </div>
      <div class="mrel-nsfw-content">
        <div class="mrel-nsfw-narrative">${esc(narrative)}</div>
      </div>
      <div class="mrel-lock-overlay" onclick="window.__mrelUnlock(this)">
        <div class="mrel-lock-icon">[ LOCKED ]</div>
        <div class="mrel-lock-hint">点击解锁</div>
      </div>
    `;
    return el;
  }

  /* ── 卡片 9：NSFW 暗语提取（锁定）─────────────── */
  function buildCard_NsfwCodewords(codewords) {
    const el = document.createElement('div');
    el.className = 'mrel-card mrel-card--nsfw mrel-card--locked';
    el.dataset.locked = '1';
    const items = (codewords || []).map(c => `
      <div class="mrel-codeword-item">
        <div class="mrel-codeword-word">${esc(c.word)}</div>
        <div class="mrel-codeword-reading">${esc(c.reading)}</div>
      </div>
    `).join('');
    el.innerHTML = `
      <div class="mrel-card-head">
        <span class="mrel-card-lbl" style="color:#fda4af;">CODEWORDS</span>
        <span class="mrel-card-sub">只属于你们的词</span>
      </div>
      <div class="mrel-nsfw-content">
        <div class="mrel-codewords">${items}</div>
      </div>
      <div class="mrel-lock-overlay" onclick="window.__mrelUnlock(this)">
        <div class="mrel-lock-icon">[ LOCKED ]</div>
        <div class="mrel-lock-hint">点击解锁</div>
      </div>
    `;
    return el;
  }

  /* ── 解锁动画 ──────────────────────────────────── */
  window.__mrelUnlock = function (overlayEl) {
    const card = overlayEl.closest('.mrel-card--locked');
    if (!card || card.dataset.locked !== '1') return;

    // 锁图标旋转 + 上移消失
    const lockIcon = overlayEl.querySelector('.mrel-lock-icon');
    const lockHint = overlayEl.querySelector('.mrel-lock-hint');
    if (lockIcon) {
      lockIcon.style.transition = 'transform .4s cubic-bezier(.22,1,.36,1), opacity .3s ease';
      lockIcon.style.transform = 'scale(1.2) rotate(20deg)';
      lockIcon.style.opacity = '0';
    }
    if (lockHint) {
      lockHint.style.transition = 'opacity .25s ease';
      lockHint.style.opacity = '0';
    }

    // 模糊层从中心收缩消失
    overlayEl.style.transition = 'opacity .4s ease .15s, clip-path .45s cubic-bezier(.22,1,.36,1) .1s';
    overlayEl.style.clipPath = 'circle(0% at 50% 50%)';
    overlayEl.style.opacity = '0';

    // 内容渐显
    const content = card.querySelector('.mrel-nsfw-content');
    if (content) {
      content.style.transition = 'opacity .4s ease .3s, filter .4s ease .3s';
      content.style.opacity = '1';
      content.style.filter = 'blur(0)';
    }

    setTimeout(() => {
      overlayEl.style.display = 'none';
      card.dataset.locked = '0';
    }, 600);
  };

  /* ════════════════════════════════════════════════════
     7. 注入 CSS
  ════════════════════════════════════════════════════ */

  function injectStyles() {
    if (document.getElementById('mrel-styles')) return;
    const style = document.createElement('style');
    style.id = 'mrel-styles';
    style.textContent = `
/* ══════════════════════════════════════════════
   Chronicle · milestonesend — Panel & Cards CSS
══════════════════════════════════════════════ */

/* ─── 选择面板 overlay ─── */
#mrel-panel-overlay {
  position: fixed; inset: 0; z-index: 9000;
  background: rgba(17,17,17,.72);
  display: flex; align-items: flex-end; justify-content: center;
  backdrop-filter: blur(4px);
  animation: mrelFadeIn .22s ease;
}
@keyframes mrelFadeIn { from{opacity:0} to{opacity:1} }

#mrel-panel {
  width: 100%; max-width: 480px;
  background: #fff;
  border-top: 1.5px solid #111;
  border-left: 1.5px solid #111;
  border-right: 1.5px solid #111;
  padding-bottom: env(safe-area-inset-bottom);
  animation: mrelSlideUp .28s cubic-bezier(.22,1,.36,1);
  max-height: 82vh; display: flex; flex-direction: column;
}
@keyframes mrelSlideUp { from{transform:translateY(100%)} to{transform:translateY(0)} }

.mrel-panel-head {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 14px 10px;
  border-bottom: 1px solid rgba(17,17,17,.1);
  flex-shrink: 0;
}
.mrel-panel-title {
  font-family: 'Fraunces', serif; font-style: italic; font-weight: 300;
  font-size: 18px; color: #111; flex: 1; letter-spacing: -.02em;
}
.mrel-panel-close {
  width: 28px; height: 28px; border: 1px solid rgba(17,17,17,.15);
  background: transparent; display: flex; align-items: center; justify-content: center;
  font-size: 10px; color: rgba(17,17,17,.4); cursor: pointer; transition: all .15s;
}
.mrel-panel-close:active { border-color: #c4b5fd; color: #c4b5fd; }

.mrel-panel-body { flex: 1; overflow-y: auto; padding: 12px 14px; }
.mrel-panel-body::-webkit-scrollbar { display: none; }

/* 聊天选择列表 */
.mrel-chat-list { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
.mrel-chat-item {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 10px; border: 1.5px solid rgba(17,17,17,.1);
  cursor: pointer; transition: all .15s; position: relative;
}
.mrel-chat-item.selected {
  border-color: #c4b5fd;
  background: rgba(196,181,253,.08);
  box-shadow: 2px 2px 0 #c4b5fd;
}
.mrel-chat-item-av {
  width: 32px; height: 32px; border: 1px solid rgba(17,17,17,.12);
  background: #f0ede8; display: flex; align-items: center; justify-content: center;
  font-size: 9px; color: rgba(17,17,17,.3); flex-shrink: 0; overflow: hidden;
}
.mrel-chat-item-av img { width: 100%; height: 100%; object-fit: cover; display: block; }
.mrel-chat-item-info { flex: 1; min-width: 0; }
.mrel-chat-item-name {
  font-size: 11px; font-weight: 700; color: #111;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.mrel-chat-item-user { font-size: 7.5px; color: rgba(17,17,17,.4); margin-top: 1px; letter-spacing: .04em; }
.mrel-chat-item-check {
  width: 14px; height: 14px; border: 1.5px solid rgba(17,17,17,.2);
  display: flex; align-items: center; justify-content: center;
  font-size: 8px; color: transparent; flex-shrink: 0;
}
.mrel-chat-item.selected .mrel-chat-item-check { border-color: #c4b5fd; color: #c4b5fd; }

/* 历史条数 */
.mrel-count-row {
  display: flex; align-items: center; gap: 10px;
  margin-bottom: 12px; padding: 8px 10px;
  border: 1px solid rgba(17,17,17,.1); background: rgba(17,17,17,.02);
}
.mrel-count-label { font-size: 9px; color: rgba(17,17,17,.5); letter-spacing: .1em; flex: 1; }
.mrel-count-input {
  width: 60px; border: 1px solid rgba(17,17,17,.15); padding: 4px 8px;
  font-size: 11px; text-align: center; font-family: 'Geist Mono', monospace;
  background: #fff; color: #111; outline: none;
}
.mrel-count-hint { font-size: 7px; color: rgba(17,17,17,.3); letter-spacing: .06em; }

/* 执行按钮 */
.mrel-submit-btn {
  width: 100%; padding: 12px; background: #111; border: none;
  font-family: 'Geist Mono', monospace; font-size: 10px; letter-spacing: .18em;
  color: #fff; cursor: pointer; transition: all .18s; flex-shrink: 0;
}
.mrel-submit-btn:active { background: #c4b5fd; color: #111; }
.mrel-submit-btn:disabled { background: rgba(17,17,17,.2); cursor: not-allowed; }

/* 加载状态 */
.mrel-loading {
  display: flex; align-items: center; gap: 8px;
  padding: 12px 14px;
  font-size: 8.5px; color: rgba(17,17,17,.5); letter-spacing: .1em;
  border-top: 1px solid rgba(17,17,17,.08);
  flex-shrink: 0;
}
.mrel-loading-spinner {
  width: 14px; height: 14px;
  border: 1.5px solid rgba(17,17,17,.12);
  border-top-color: #c4b5fd;
  animation: mrelSpin .7s linear infinite; flex-shrink: 0;
}
@keyframes mrelSpin { to { transform: rotate(360deg); } }

/* ─── 结果容器 ─── */
#mrel-results-container {
  display: flex; flex-direction: column; gap: 10px;
  margin-top: 10px;
  margin-bottom: 21px;
}

/* ─── 通用卡片 ─── */
.mrel-card {
  background: #fff; border: 1.5px solid #111;
  position: relative; overflow: hidden;
}

.mrel-card-head {
  padding: 9px 12px 7px;
  border-bottom: 1px solid rgba(17,17,17,.08);
  display: flex; align-items: center; justify-content: space-between;
}
.mrel-card-lbl {
  font-size: 7px; letter-spacing: .2em; color: rgba(17,17,17,.4);
  font-weight: 700; text-transform: uppercase;
}
.mrel-card-sub { font-size: 7px; color: rgba(17,17,17,.3); letter-spacing: .06em; }

/* ─── 卡片 0：关系定性 ─── */
.mrel-card--tag {
  background: #111;
  box-shadow: 3px 3px 0 #c4b5fd;
}
.mrel-card-film {
  height: 15px; display: flex; align-items: center; overflow: hidden;
  border-bottom: 1px solid rgba(255,255,255,.06);
}
.mrel-film-holes { display: flex; gap: 4px; padding: 0 7px; flex-shrink: 0; }
.mrel-film-holes span {
  width: 6px; height: 5px; border-radius: 1px; background: #f8f7f5; display: block;
}
.mrel-film-text {
  flex: 1; font-size: 5.5px; letter-spacing: .14em;
  color: rgba(255,255,255,.12); white-space: nowrap; overflow: hidden;
  animation: mrelFilm 22s linear infinite;
}
@keyframes mrelFilm { from{transform:translateX(0)} to{transform:translateX(-50%)} }
.mrel-tag-body { padding: 14px 14px 14px; }
.mrel-tag-eyebrow { font-size: 6.5px; letter-spacing: .22em; color: #c4b5fd; font-weight: 700; margin-bottom: 5px; }
.mrel-tag-word {
  font-family: 'Fraunces', serif; font-style: italic; font-weight: 300;
  font-size: 28px; color: #fff; letter-spacing: -.03em; line-height: 1.05; margin-bottom: 8px;
}
.mrel-tag-narrative { font-size: 10px; color: rgba(255,255,255,.6); line-height: 1.7; margin-bottom: 10px; }
.mrel-tag-meta { display: flex; justify-content: space-between; align-items: center; }
.mrel-tag-chat { font-size: 7px; color: rgba(255,255,255,.28); letter-spacing: .08em; }
.mrel-tag-id { font-size: 6px; color: rgba(196,181,253,.3); letter-spacing: .12em; }

/* ─── 卡片 1：雷达图 ─── */
.mrel-card--radar {
  background: #fff;
  box-shadow: 2px 2px 0 rgba(196,181,253,.6);
}
.mrel-radar-wrap { padding: 12px 8px 4px; }
.mrel-radar-vals { padding: 6px 12px 12px; display: flex; flex-direction: column; gap: 5px; }
.mrel-radar-val-item { display: flex; align-items: center; gap: 8px; }
.mrel-radar-val-lbl { font-size: 7px; color: rgba(17,17,17,.45); width: 40px; flex-shrink: 0; letter-spacing: .04em; }
.mrel-radar-val-bar { flex: 1; height: 3px; background: rgba(17,17,17,.07); }
.mrel-radar-val-fill { height: 100%; background: #c4b5fd; }
.mrel-radar-val-num { font-size: 8px; color: rgba(17,17,17,.4); width: 24px; text-align: right; font-family: 'Fraunces', serif; font-style: italic; }

/* ─── 卡片 2：时间线 ─── */
.mrel-card--timeline {
  background: repeating-linear-gradient(45deg, #f8f7f5 0, #f8f7f5 4px, rgba(17,17,17,.03) 4px, rgba(17,17,17,.03) 5px);
  border: 1.5px solid #111;
}
.mrel-timeline { padding: 12px 12px 14px; display: flex; flex-direction: column; gap: 0; }
.mrel-tl-item {
  display: grid; grid-template-columns: 24px 1fr;
  gap: 0 10px; position: relative;
}
.mrel-tl-item:not(:last-child) .mrel-tl-dot::after {
  content: ''; position: absolute; top: 12px; left: 5px; bottom: -12px;
  width: 1px; background: rgba(17,17,17,.12);
}
.mrel-tl-dot {
  width: 12px; height: 12px; border: 1.5px solid #111;
  background: #fff; position: relative; margin-top: 3px; flex-shrink: 0;
}
.mrel-tl-dot.start { background: #111; }
.mrel-tl-dot.end { background: #c4b5fd; border-color: #c4b5fd; }
.mrel-tl-content { padding-bottom: 16px; }
.mrel-tl-phase { font-size: 7px; letter-spacing: .16em; color: rgba(17,17,17,.4); font-weight: 700; margin-bottom: 2px; }
.mrel-tl-emotion {
  display: inline-block; font-size: 7px; padding: 1px 6px;
  border: 1px solid rgba(17,17,17,.2); color: rgba(17,17,17,.5);
  margin-bottom: 5px; letter-spacing: .08em;
}
.mrel-tl-summary { font-size: 10.5px; color: rgba(17,17,17,.75); line-height: 1.55; }

/* ─── 卡片 3：情绪词云 ─── */
.mrel-card--emotions {
  background: #c4b5fd;
  border: 1.5px solid #111;
  box-shadow: 3px 3px 0 #111;
}
.mrel-card--emotions .mrel-card-lbl { color: rgba(17,17,17,.5); }
.mrel-card--emotions .mrel-card-sub { color: rgba(17,17,17,.4); }
.mrel-card--emotions .mrel-card-head { border-color: rgba(17,17,17,.12); }
.mrel-emo-cloud {
  padding: 14px 12px 16px; display: flex; flex-wrap: wrap;
  align-items: flex-end; gap: 8px 10px;
}
.mrel-emo-word {
  font-family: 'Fraunces', serif; font-style: italic; font-weight: 300;
  color: #111; letter-spacing: -.01em; line-height: 1; display: inline-block;
}

/* ─── 卡片 4：标志性瞬间 ─── */
.mrel-card--moments { background: #fff; }
.mrel-moments { padding: 10px 12px 14px; display: flex; flex-direction: column; gap: 0; }
.mrel-moment-item {
  display: grid; grid-template-columns: 36px 1fr;
  align-items: start; gap: 0 8px;
  padding: 9px 0; border-bottom: 1px dashed rgba(17,17,17,.08);
}
.mrel-moment-item:last-child { border-bottom: none; }
.mrel-moment-num {
  font-family: 'Fraunces', serif; font-style: italic; font-weight: 200;
  font-size: 22px; color: rgba(17,17,17,.1); line-height: 1; padding-top: 2px;
}
.mrel-moment-summary { font-size: 10.5px; color: rgba(17,17,17,.78); line-height: 1.6; margin-bottom: 4px; }
.mrel-moment-floor { font-size: 7px; color: rgba(17,17,17,.3); letter-spacing: .08em; }

/* ─── 卡片 5：关系暗线 ─── */
.mrel-card--shadow {
  background: #111; border: 1.5px solid rgba(253,164,175,.3);
}
.mrel-shadow-inner { padding: 16px 14px; text-align: center; }
.mrel-shadow-icon { font-size: 7px; letter-spacing: .22em; color: rgba(253,164,175,.4); margin-bottom: 8px; }
.mrel-shadow-text { font-size: 12px; color: rgba(255,255,255,.7); line-height: 1.7; }

/* ─── 卡片 6：一句定论 ─── */
.mrel-card--epitaph {
  background: #fff;
  border: 1.5px solid #111; box-shadow: 3px 3px 0 rgba(17,17,17,.18);
}
.mrel-epitaph-inner { padding: 16px 14px 14px; text-align: center; }
.mrel-epitaph-label { font-size: 6.5px; letter-spacing: .22em; color: rgba(17,17,17,.3); margin-bottom: 10px; }
.mrel-epitaph-text {
  font-family: 'Fraunces', serif; font-style: italic; font-weight: 300;
  font-size: 15px; color: #111; letter-spacing: -.01em; line-height: 1.5; margin-bottom: 10px;
}
.mrel-epitaph-deco { font-size: 7px; color: rgba(17,17,17,.2); letter-spacing: .14em; }

/* ─── NSFW 卡片通用 ─── */
.mrel-card--nsfw { position: relative; overflow: hidden; }
.mrel-nsfw-content {
  padding: 12px 12px 14px;
  opacity: 0; filter: blur(8px);
  transition: opacity .4s ease, filter .4s ease;
  pointer-events: none;
}
.mrel-card--nsfw[data-locked="0"] .mrel-nsfw-content {
  opacity: 1; filter: blur(0); pointer-events: auto;
}

/* 锁定覆盖层 */
.mrel-lock-overlay {
  position: absolute; inset: 0;
  background: rgba(17,17,17,.65);
  backdrop-filter: blur(12px);
  display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 6px;
  cursor: pointer; transition: opacity .4s ease;
  clip-path: circle(150% at 50% 50%);
}
.mrel-lock-icon {
  font-size: 8px; letter-spacing: .22em; color: rgba(253,164,175,.8);
  font-family: 'Geist Mono', monospace;
  transition: transform .4s cubic-bezier(.22,1,.36,1), opacity .3s ease;
}
.mrel-lock-hint { font-size: 7px; letter-spacing: .14em; color: rgba(255,255,255,.35); }

/* ─── 卡片 7：极坐标（NSFW）─── */
.mrel-card--nsfw.mrel-card--polar {
  background: #111; border: 1.5px solid rgba(253,164,175,.25);
  box-shadow: 2px 2px 0 rgba(253,164,175,.3);
}

/* ─── 卡片 8：亲密叙事（NSFW）─── */
.mrel-nsfw-narrative {
  font-size: 11px; color: rgba(17,17,17,.75); line-height: 1.75;
}

/* ─── 卡片 9：暗语提取（NSFW）─── */
.mrel-codewords { display: flex; flex-direction: column; gap: 8px; }
.mrel-codeword-item {
  padding: 8px 10px; border-left: 2px solid #fda4af;
  background: rgba(253,164,175,.05);
}
.mrel-codeword-word { font-size: 12px; font-weight: 700; color: #111; margin-bottom: 3px; letter-spacing: .04em; }
.mrel-codeword-reading { font-size: 9px; color: rgba(17,17,17,.5); line-height: 1.5; }

/* ─── 详情页卡片防压缩 ─── */
.mrel-dp-scroll .mrel-card {
  flex-shrink: 0;
}

/* ─── 错误提示 ─── */
.mrel-error {
  padding: 10px 12px;
  border: 1px solid rgba(239,68,68,.2);
  background: rgba(239,68,68,.06);
  font-size: 9px; color: rgba(17,17,17,.6); line-height: 1.55;
  letter-spacing: .04em;
}

/* ══════════════════════════════════════════════
   预览卡片系统
══════════════════════════════════════════════ */

.mrel-preview-card {
  position: relative; overflow: hidden;
  border: 1.5px solid #111;
  cursor: pointer;
  transition: transform .18s cubic-bezier(.22,1,.36,1), box-shadow .18s ease;
  -webkit-tap-highlight-color: transparent;
}
.mrel-preview-card:active { transform: scale(.985); }

/* 色系变体 */
.mrel-pc--violet { background: #fff; box-shadow: 3px 3px 0 #c4b5fd; }
.mrel-pc--rose   { background: #111; box-shadow: 3px 3px 0 #fda4af; }
.mrel-pc--teal   { background: #fff; box-shadow: 3px 3px 0 #5eead4; }
.mrel-pc--amber  { background: #fff; box-shadow: 3px 3px 0 #fcd34d; }
.mrel-pc--dark   { background: #1a1a1a; box-shadow: 3px 3px 0 rgba(196,181,253,.5); }

/* 胶片条 */
.mrel-pc-film {
  height: 14px; display: flex; align-items: center; overflow: hidden;
  border-bottom: 1px solid rgba(17,17,17,.08);
}
.mrel-pc--rose .mrel-pc-film,
.mrel-pc--dark .mrel-pc-film { border-color: rgba(255,255,255,.06); }
.mrel-pc-film-holes { display: flex; gap: 3px; padding: 0 6px; flex-shrink: 0; }
.mrel-pc-film-holes span { width: 5px; height: 4px; border-radius: 1px; display: block; }
.mrel-pc--violet .mrel-pc-film-holes span,
.mrel-pc--teal   .mrel-pc-film-holes span,
.mrel-pc--amber  .mrel-pc-film-holes span { background: rgba(17,17,17,.12); }
.mrel-pc--rose   .mrel-pc-film-holes span,
.mrel-pc--dark   .mrel-pc-film-holes span { background: rgba(255,255,255,.15); }
.mrel-pc-film-txt {
  flex: 1; font-size: 5px; letter-spacing: .13em; white-space: nowrap; overflow: hidden;
  animation: mrelFilm 22s linear infinite;
}
.mrel-pc--violet .mrel-pc-film-txt,
.mrel-pc--teal   .mrel-pc-film-txt,
.mrel-pc--amber  .mrel-pc-film-txt { color: rgba(17,17,17,.12); }
.mrel-pc--rose   .mrel-pc-film-txt,
.mrel-pc--dark   .mrel-pc-film-txt { color: rgba(255,255,255,.1); }

/* 卡片主体 */
.mrel-pc-body { padding: 12px 12px 8px; }
.mrel-pc-top { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 6px; }
.mrel-pc-tag {
  font-family: 'Fraunces', serif; font-style: italic; font-weight: 300;
  font-size: 22px; letter-spacing: -.03em; line-height: 1.05;
}
.mrel-pc--violet .mrel-pc-tag { color: #111; }
.mrel-pc--rose   .mrel-pc-tag { color: #fff; }
.mrel-pc--teal   .mrel-pc-tag { color: #111; }
.mrel-pc--amber  .mrel-pc-tag { color: #111; }
.mrel-pc--dark   .mrel-pc-tag { color: rgba(255,255,255,.9); }
.mrel-pc-date { font-size: 6.5px; letter-spacing: .1em; margin-top: 4px; flex-shrink: 0; }
.mrel-pc--violet .mrel-pc-date,
.mrel-pc--teal   .mrel-pc-date,
.mrel-pc--amber  .mrel-pc-date { color: rgba(17,17,17,.3); }
.mrel-pc--rose   .mrel-pc-date,
.mrel-pc--dark   .mrel-pc-date { color: rgba(255,255,255,.3); }

.mrel-pc-narrative {
  font-size: 9.5px; line-height: 1.65; margin-bottom: 10px;
}
.mrel-pc--violet .mrel-pc-narrative,
.mrel-pc--teal   .mrel-pc-narrative,
.mrel-pc--amber  .mrel-pc-narrative { color: rgba(17,17,17,.6); }
.mrel-pc--rose   .mrel-pc-narrative,
.mrel-pc--dark   .mrel-pc-narrative { color: rgba(255,255,255,.55); }

.mrel-pc-footer { display: flex; align-items: center; gap: 6px; }
.mrel-pc-dims { display: flex; gap: 5px; flex: 1; flex-wrap: wrap; }
.mrel-pc-dim {
  font-size: 7px; letter-spacing: .04em; padding: 2px 6px;
  border: 1px solid rgba(17,17,17,.14);
}
.mrel-pc-dim b { font-weight: 600; }
.mrel-pc--rose .mrel-pc-dim,
.mrel-pc--dark .mrel-pc-dim { border-color: rgba(255,255,255,.15); color: rgba(255,255,255,.6); }
.mrel-pc-emos { display: flex; gap: 4px; }
.mrel-pc-emo {
  font-size: 7.5px; padding: 2px 7px;
  border-radius: 0;
}
.mrel-pc--violet .mrel-pc-emo { background: rgba(196,181,253,.2); color: #6d28d9; border: 1px solid rgba(196,181,253,.4); }
.mrel-pc--rose   .mrel-pc-emo { background: rgba(253,164,175,.15); color: #fda4af; border: 1px solid rgba(253,164,175,.3); }
.mrel-pc--teal   .mrel-pc-emo { background: rgba(94,234,212,.2); color: #0d9488; border: 1px solid rgba(94,234,212,.4); }
.mrel-pc--amber  .mrel-pc-emo { background: rgba(252,211,77,.25); color: #92400e; border: 1px solid rgba(252,211,77,.5); }
.mrel-pc--dark   .mrel-pc-emo { background: rgba(196,181,253,.1); color: #c4b5fd; border: 1px solid rgba(196,181,253,.2); }
.mrel-pc-arrow { font-size: 9px; flex-shrink: 0; }
.mrel-pc--violet .mrel-pc-arrow,
.mrel-pc--teal   .mrel-pc-arrow,
.mrel-pc--amber  .mrel-pc-arrow { color: rgba(17,17,17,.25); }
.mrel-pc--rose   .mrel-pc-arrow,
.mrel-pc--dark   .mrel-pc-arrow { color: rgba(255,255,255,.2); }

/* epitaph 底栏 */
.mrel-pc-epitaph {
  padding: 7px 12px 9px;
  border-top: 1px solid rgba(17,17,17,.07);
  font-size: 8.5px; line-height: 1.55; font-style: italic;
}
.mrel-pc--violet .mrel-pc-epitaph,
.mrel-pc--teal   .mrel-pc-epitaph,
.mrel-pc--amber  .mrel-pc-epitaph { color: rgba(17,17,17,.38); border-color: rgba(17,17,17,.07); }
.mrel-pc--rose   .mrel-pc-epitaph { color: rgba(255,255,255,.3); border-color: rgba(255,255,255,.08); }
.mrel-pc--dark   .mrel-pc-epitaph { color: rgba(255,255,255,.22); border-color: rgba(255,255,255,.06); }

/* ══════════════════════════════════════════════
   全屏详情页
══════════════════════════════════════════════ */

#mrel-detail-page {
  position: fixed; inset: 0; z-index: 9500;
  background: #f8f7f5;
  display: flex; flex-direction: column;
  overflow: hidden;
}

.mrel-dp-header {
  flex-shrink: 0;
  height: 52px;
  background: #111;
  display: flex; align-items: center; gap: 10px;
  padding: 0 14px;
  position: relative;
}
.mrel-dp-header::after {
  content: ''; position: absolute; bottom: 0; left: 0; right: 0; height: 2px;
  background: linear-gradient(90deg, #c4b5fd, #fda4af, #5eead4);
}
.mrel-dp-back {
  width: 30px; height: 30px; border: 1px solid rgba(255,255,255,.12);
  background: rgba(255,255,255,.05);
  display: flex; align-items: center; justify-content: center;
  color: rgba(255,255,255,.55); font-size: 10px; cursor: pointer;
  transition: all .15s; flex-shrink: 0;
}
.mrel-dp-back:active { border-color: #c4b5fd; color: #c4b5fd; }
.mrel-dp-title { flex: 1; min-width: 0; }
.mrel-dp-title-main {
  font-family: 'Fraunces', serif; font-style: italic; font-weight: 300;
  font-size: 17px; color: #fff; letter-spacing: -.02em;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.mrel-dp-title-sub { font-size: 6.5px; color: rgba(255,255,255,.35); letter-spacing: .1em; }
.mrel-dp-id { font-size: 6px; color: rgba(255,255,255,.15); letter-spacing: .12em; flex-shrink: 0; }
.mrel-dp-id:active { opacity: .5; }
.mrel-dp-id:hover { color: #fda4af; }

.mrel-dp-scroll {
  flex: 1; overflow-y: auto; overflow-x: hidden;
  padding: 12px 12px 32px;
  display: flex; flex-direction: column; gap: 10px;
}
.mrel-dp-scroll::-webkit-scrollbar { display: none; }

/* 空状态提示 */
.mrel-empty-hint {
  padding: 18px 14px;
  font-size: 8.5px; color: rgba(17,17,17,.3);
  letter-spacing: .1em; text-align: center; line-height: 1.8;
  border: 1px dashed rgba(17,17,17,.1);
}
.mrel-dp-scroll .mrel-card {
  flex-shrink: 0;
}
.api-slot-loading-dot {
  width: 6px; height: 6px; background: #c4b5fd;
  animation: mrelPulse 1.2s ease infinite; flex-shrink: 0;
}
@keyframes mrelPulse { 0%,100%{opacity:.3;transform:scale(.8)} 50%{opacity:1;transform:scale(1.2)} }

.api-slot-spinner {
  width: 14px; height: 14px; flex-shrink: 0;
  border: 1.5px solid rgba(196,181,253,.2);
  border-top-color: #c4b5fd;
  border-radius: 50%;
  animation: mrelSpin .7s linear infinite;
}
    `;
    document.head.appendChild(style);
  }

  /* ════════════════════════════════════════════════════
     8. 选择面板 UI
  ════════════════════════════════════════════════════ */

  async function showSelectPanel(charId, charName, charAvatar, resultsContainer) {
    // 获取该角色的所有 chats
    const allChats = await idbGetAll('chats');
    const charChats = allChats.filter(c => c.charIds && c.charIds.includes(charId));
    const allUsers = await idbGetAll('users');
    const userMap = {};
    allUsers.forEach(u => (userMap[u.id] = u));

    // 关闭已有面板
    const existing = document.getElementById('mrel-panel-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'mrel-panel-overlay';
    overlay.innerHTML = `
      <div id="mrel-panel">
        <div class="mrel-panel-head">
          <div class="mrel-panel-title">关系总结 · ${esc(charName)}</div>
          <button class="mrel-panel-close" onclick="document.getElementById('mrel-panel-overlay').remove()">
            <i class="fa fa-xmark"></i>
          </button>
        </div>
        <div class="mrel-panel-body">
          <div style="font-size:7px;letter-spacing:.16em;color:rgba(17,17,17,.4);margin-bottom:8px;">选择参与分析的聊天</div>
          <div class="mrel-chat-list" id="mrel-chat-list">
            ${charChats.length === 0
              ? '<div class="mrel-error">该角色暂无聊天记录</div>'
              : charChats.map(chat => {
                  const user = chat.userId ? userMap[chat.userId] : null;
                  const chatName = esc(chat.customName || chat.title || chat.name || 'Untitled');
                  const userName = user ? esc(user.name) : '未绑定用户';
                  const avHtml = charAvatar
                    ? `<img src="${esc(charAvatar)}" alt="">`
                    : `<i class="fa fa-user" style="font-size:9px"></i>`;
                  return `
                    <div class="mrel-chat-item" data-chatid="${esc(chat.id)}" data-chatname="${chatName}" onclick="window.__mrelToggleChat(this)">
                      <div class="mrel-chat-item-av">${avHtml}</div>
                      <div class="mrel-chat-item-info">
                        <div class="mrel-chat-item-name">${chatName}</div>
                        <div class="mrel-chat-item-user">${userName}</div>
                      </div>
                      <div class="mrel-chat-item-check"><i class="fa fa-check"></i></div>
                    </div>
                  `;
                }).join('')}
          </div>
          <div class="mrel-count-row">
            <span class="mrel-count-label">历史消息条数</span>
            <input class="mrel-count-input" id="mrel-count-input" type="number" min="0" value="0" placeholder="0"/>
            <span class="mrel-count-hint">0 = 全部</span>
          </div>
        </div>
        <button class="mrel-submit-btn" id="mrel-submit-btn" onclick="window.__mrelSubmit()">
          GENERATE RELATION SUMMARY
        </button>
      </div>
    `;
    document.body.appendChild(overlay);

    // 点击背景关闭
    overlay.addEventListener('click', e => {
      if (e.target === overlay) overlay.remove();
    });

    // 存储上下文供提交使用
    window.__mrelContext = { charId, charName, charAvatar, resultsContainer, slotEl: document.getElementById('apiOnlineSlot') };

    window.__mrelToggleChat = function (el) {
      el.classList.toggle('selected');
    };

    window.__mrelSubmit = async function () {
      const selected = [...document.querySelectorAll('.mrel-chat-item.selected')];
      if (selected.length === 0) {
        alert('请至少选择一个聊天');
        return;
      }
      const historyCount = parseInt(document.getElementById('mrel-count-input')?.value || '0', 10) || 0;
      const selectedChats = selected.map(el => ({
        chatId: el.dataset.chatid,
        chatName: el.dataset.chatname,
      }));

const btn = document.getElementById('mrel-submit-btn');
      if (btn) btn.disabled = true;

      // ★ 先取 ctx，后面所有地方都依赖它
      const ctx = window.__mrelContext;
      const chatInfo = selectedChats[0];

      // ── slot 按钮变成加载态 ──
      const slotEl = ctx.slotEl;
      let slotOrigHTML = '';
      if (slotEl) {
        slotOrigHTML = slotEl.innerHTML;
        slotEl.innerHTML = `
          <div class="api-slot-loading-dot"></div>
          <div class="api-slot-txt">
            <div class="api-slot-title" style="color:#c4b5fd;letter-spacing:.08em;">正在生成关系总结</div>
            <div class="api-slot-sub" style="color:rgba(196,181,253,.5);">AI 分析中，请稍候...</div>
          </div>
          <div class="api-slot-spinner"></div>
        `;
        slotEl.style.borderColor = '#c4b5fd';
        slotEl.style.background = 'rgba(196,181,253,.08)';
        slotEl.style.cursor = 'default';
        slotEl.style.pointerEvents = 'none';
      }

      // 在面板底部显示加载状态（overlay移除前挂好）
      const panel = document.getElementById('mrel-panel');
      if (panel) {
        const loadingEl = document.createElement('div');
        loadingEl.className = 'mrel-loading';
        loadingEl.innerHTML = `<div class="mrel-loading-spinner"></div><span>正在生成关系总结，请稍候...</span>`;
        panel.appendChild(loadingEl);
      }

      overlay.remove();


      try {
  // 组装提示词
  const systemContent = await buildFullPrompt(chatInfo.chatId, historyCount);
  // 调用 API
  const result = await callApi(systemContent);
  // 持久化
  const recordId = await saveResult(ctx.charId, chatInfo.chatId, result);
  // 移除空状态提示
  const emptyHint = ctx.resultsContainer.querySelector('.mrel-empty-hint');
  if (emptyHint) emptyHint.remove();
  // 读取角色名和用户名
  const chat = await idbGet('chats', chatInfo.chatId);
  const chatName = chat ? (chat.customName || chat.title || chat.name || chatInfo.chatName) : chatInfo.chatName;
  const user = chat?.userId ? await idbGet('users', chat.userId) : null;
  const displaySub = user ? user.name : chatName;
  const char = await idbGet('chars', ctx.charId);
  const charName = char ? char.name : ctx.charName;
  // 新卡片插到最前面
  const tempContainer = document.createElement('div');
  renderPreviewCard({ result, id: recordId, createdAt: Date.now() }, tempContainer, charName, displaySub);
  ctx.resultsContainer.insertBefore(tempContainer.firstChild, ctx.resultsContainer.firstChild);
  // 滚动到结果
  ctx.resultsContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
} catch (err) {
  console.error('[milestonesend] 生成失败', err);
  const errEl = document.createElement('div');
  errEl.className = 'mrel-error';
  errEl.textContent = `生成失败：${err.message}`;
  ctx.resultsContainer.innerHTML = '';
  ctx.resultsContainer.appendChild(errEl);
  ctx.resultsContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
} finally {
  if (slotEl) {
    slotEl.innerHTML = slotOrigHTML;
    slotEl.style.borderColor = '';
    slotEl.style.background = '';
    slotEl.style.cursor = '';
    slotEl.style.pointerEvents = '';
  }
}
    };
  }

  /* ════════════════════════════════════════════════════
     9. 对外暴露 — 绑定到 AI 关系总结按钮
     调用方式（在 milestone.html 里）：
       MilestoneSend.bindApiSlot(slotEl, charId, charName, charAvatar, resultsContainerEl)
       MilestoneSend.loadAllRecords(charId, resultsEl)
  ════════════════════════════════════════════════════ */

  injectStyles();

  window.MilestoneSend = {
    /**
     * 绑定 api-slot 点击事件
     * @param {HTMLElement} slotEl         - api-slot 元素
     * @param {string}      charId         - 角色 ID
     * @param {string}      charName       - 角色名
     * @param {string|null} charAvatar     - 头像 URL 或 null
     * @param {HTMLElement} resultsEl      - 渲染结果的容器元素（#mrel-results-container 或自定义）
     */
    bindApiSlot(slotEl, charId, charName, charAvatar, resultsEl) {
      if (!slotEl) return;
      slotEl.style.cursor = 'pointer';
      slotEl.addEventListener('click', () => {
        showSelectPanel(charId, charName, charAvatar, resultsEl);
      });
    },

    /**
     * 加载该角色所有历史总结记录，每条渲染为一张预览卡片
     * 进入角色详情页时调用
     */
    async loadAllRecords(charId, resultsEl) {
      if (!resultsEl) return;
      try {
        const all = await idbGetByIndex(STORE_NAME, 'by_char', charId);
        const sorted = all.sort((a, b) => b.createdAt - a.createdAt);

        if (sorted.length === 0) {
          // 无记录时显示空状态
          const hint = document.createElement('div');
          hint.className = 'mrel-empty-hint';
          hint.textContent = '暂无关系总结记录\n点击上方按钮生成';
          resultsEl.innerHTML = '';
          resultsEl.appendChild(hint);
          return;
        }

        resultsEl.innerHTML = '';
        for (const record of sorted) {
        const chat = await idbGet('chats', record.chatId);
const chatName = chat ? (chat.customName || chat.title || chat.name || 'Untitled') : record.chatId;
const user = chat?.userId ? await idbGet('users', chat.userId) : null;
const displaySub = user ? user.name : chatName;
          const char = await idbGet('chars', charId);
          const charName = char ? char.name : charId;
          renderPreviewCard(record, resultsEl, charName, displaySub);
        }
      } catch (e) {
        console.warn('[milestonesend] loadAllRecords 失败', e);
      }
    },
  };

  console.log('%c[milestonesend] ✅ MilestoneSend 已就绪，window.MilestoneSend 已挂载', 'color:#c4b5fd;font-weight:bold');
})();
