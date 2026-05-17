/**
 * MemoryAPI.js — Memory Palace 独立 API 提取模块
 * v2.0
 *
 * 改动：
 *  - 全链路控制台日志（系统提示词 / 用户提示词 / 原始回复 / 解析结果分类明细）
 *  - 提示词重写：以角色为绝对中心，昵称严格约束为"称呼词本身"，内容要求丰富详尽
 *  - 每一类都有独立的提取规则，禁止囫囵吞枣
 */

(function () {
  'use strict';

  /* ─────────────────────────────────────
     控制台样式常量
  ───────────────────────────────────── */
  const C = {
    title:  'color:#f9a8d4;font-weight:bold;font-size:12px;',
    section:'color:#f9a8d4;font-weight:bold;',
    ok:     'color:#43d9a0;font-weight:bold;',
    warn:   'color:#f9c784;font-weight:bold;',
    err:    'color:#ff6b6b;font-weight:bold;',
    dim:    'color:rgba(255,255,255,0.35);',
    white:  'color:#fff;',
    pink:   'color:#fbcfe8;',
  };

  const TAG = '[MemoryAPI]';

  function _log(msg, style = C.white) {
    console.log(`%c${TAG} ${msg}`, style);
  }
  function _group(label) {
    console.group(`%c${TAG} ${label}`, C.title);
  }
  function _groupEnd() {
    console.groupEnd();
  }

  /* ─────────────────────────────────────
     IDB 工具
  ───────────────────────────────────── */

  const DBNAME = 'tsukiphonepromax';
  let _db = null;

  function _openDB() {
    // 优先用 db-schema.js 提供的完整连接
    if (typeof window.openDb === 'function') {
      return window.openDb().then(db => { _db = db; return db; });
    }
    if (_db) return Promise.resolve(_db);
    return new Promise((res, rej) => {
      const p = indexedDB.open(DBNAME);
      p.onsuccess = e => { _db = e.target.result; res(_db); };
      p.onerror = e => rej(e.target.error);
    });
  }

  async function _gOne(store, key) {
    const db = await _openDB();
    return new Promise((res, rej) => {
      try {
        const q = db.transaction(store, 'readonly').objectStore(store).get(key);
        q.onsuccess = () => res(q.result || null);
        q.onerror = e => rej(e.target.error);
      } catch (e) { res(null); }
    });
  }

  async function _pOne(store, obj) {
    const db = await _openDB();
    return new Promise((res, rej) => {
      const q = db.transaction(store, 'readwrite').objectStore(store).put(obj);
      q.onsuccess = () => res();
      q.onerror = e => rej(e.target.error);
    });
  }

  async function _getMsgs(chatId, fromFloor, toFloor) {
    const db = await _openDB();
    return new Promise(res => {
      try {
        const st = db.transaction('messages', 'readonly').objectStore('messages');
        const rng = IDBKeyRange.bound([chatId, fromFloor ?? 0], [chatId, toFloor ?? Infinity]);
        const req = st.openCursor(rng, 'next');
        const arr = [];
        req.onsuccess = ev => {
          const c = ev.target.result;
          if (c) { arr.push(c.value); c.continue(); } else res(arr);
        };
        req.onerror = () => res([]);
      } catch (e) { res([]); }
    });
  }

  async function _getMaxFloor(chatId) {
    const db = await _openDB();
    return new Promise(res => {
      try {
        const st = db.transaction('messages', 'readonly').objectStore('messages');
        const rng = IDBKeyRange.bound([chatId, 0], [chatId, Infinity]);
        const req = st.openCursor(rng, 'prev');
        req.onsuccess = ev => { const c = ev.target.result; res(c ? c.value.floor : 0); };
        req.onerror = () => res(0);
      } catch (e) { res(0); }
    });
  }

  async function _getApiConfig() {
    const cfg = await _gOne('config', 'main_config');
    return {
      url:   (cfg?.api?.temp?.url || '').replace(/\/+$/, '').replace(/\/v1$/, ''),
      key:   cfg?.api?.temp?.key   || '',
      model: cfg?.api?.temp?.model || 'gpt-4o',
      temp:  parseFloat(cfg?.api?.temp?.temp || 0.7),
    };
  }

  /* ─────────────────────────────────────
     getHistory（支持楼层过滤）
  ───────────────────────────────────── */

  async function getHistory(chatId, options = {}) {
    const { fromFloor, toFloor, latestN, historyCount = 0 } = options;

    if (typeof window.buildChatHistoryPrompt === 'function') {
      const raw = await window.buildChatHistoryPrompt(chatId, historyCount);
      if (fromFloor != null || toFloor != null) {
        return raw.filter(line => {
          const m = line.match(/\[F(\d+)\]/);
          if (!m) return true;
          const f = parseInt(m[1]);
          if (fromFloor != null && f < fromFloor) return false;
          if (toFloor   != null && f > toFloor)   return false;
          return true;
        });
      }
      if (latestN > 0 && !historyCount) return raw.slice(-latestN);
      return raw;
    }

    console.warn(`${TAG} buildChatHistoryPrompt 未找到，使用内置 fallback`);
    return _fallbackGetHistory(chatId, { fromFloor, toFloor, latestN, historyCount });
  }

  async function _fallbackGetHistory(chatId, { fromFloor, toFloor, latestN, historyCount }) {
    const chat = await _gOne('chats', chatId);
    if (!chat) return [];
    let msgs = await _getMsgs(chatId, fromFloor ?? 0, toFloor ?? Infinity);
    msgs = msgs.filter(m => m.type === 'text' || m.type === 'system' || !m.type)
               .sort((a, b) => (a.floor || 0) - (b.floor || 0));
    if (latestN > 0) msgs = msgs.slice(-latestN);
    else if (historyCount > 0) msgs = msgs.slice(-historyCount);
    const charMap = {};
    for (const cid of (chat.charIds || [])) {
      const c = await _gOne('chars', cid);
      if (c) charMap[cid] = c.name;
    }
    const user = await _gOne('users', chat.userId);
    const userName = user?.name || 'User';
    const charName = Object.values(charMap)[0] || 'Char';
    return msgs.map(m => {
      let sender = '系统';
      if (m.senderRole === 'user') sender = userName;
      else if (m.senderRole === 'char') sender = (m.charId && charMap[m.charId]) || charName;
      const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content || '');
      return `[F${m.floor}][${sender}] ${content}`;
    });
  }

  /* ─────────────────────────────────────
     系统提示词构建（重写版）
  ───────────────────────────────────── */

  function _buildSystemPrompt(char, user, chat, focus) {
    const charName = char.name || '角色';
    const userName = user?.name || '用户';

    const wbs = char.worldbook || [];
    const wbPre  = wbs.filter(w => w.enabled && w.type === 'before')
                      .map(w => w.content || w.title || '').join('\n');
    const wbPost = wbs.filter(w => w.enabled && (w.type === 'after' || !w.type))
                      .map(w => w.content || w.title || '').join('\n');

    const focusNote =
      focus === 'event'   ? '本次重点：深挖关键事件，哪怕是小细节也要单独成条，不要合并。' :
      focus === 'emotion' ? '本次重点：重点捕捉情绪起伏、语气变化、心理活动，每一次明显的情绪波动都要记录。' :
                            '本次要求：全面覆盖，宁多勿少。每一类都要尽力挖掘，不要因为"感觉不重要"就跳过。';

    const corePrompt = `
你是「${charName}」的专属记忆整理助手，负责从聊天记录中提炼出${charName}视角下的记忆碎片。

═══ 核心原则 ═══
1. 【以${charName}为中心】所有记忆都从${charName}的感受、视角、体验出发，用第三人称叙述（"${charName}…"），而非旁观者描述
2. 【宁多勿少，绝不囫囵吞枣】对话中每一个有意义的细节都要单独记录成一条；不允许把多个不同事件合并成一条笼统描述
3. 【内容充实】每条 content 字段必须是完整叙述，要说清楚：什么情况下发生 → 具体内容是什么 → ${charName}的反应/感受，不少于30字，不超过120字
4. 【标题精准】title 是这条记忆的核心关键词标签，10字以内，准确概括这条记忆的本质，不要用"某某时刻"这种模糊表达

═══ 分类规则（严格遵守）═══

【promise · 承诺约定】
- 涵盖：明确的约定、玩笑性质的承诺、"以后要一起做某事"的表达、不分手的保证等
- title：写约定的核心内容，如"一起去海边的约定"
- 每一个独立约定单独一条，不合并

【detail · 在意的细节】
- 涵盖：${userName}透露的喜好、厌恶、习惯、身体特征、生活细节、情感偏好，${charName}注意到的关于${userName}的任何特别之处
- title：写这个细节本身，如"怕辣""睡前喜欢发消息"
- 哪怕只是对话里一句带过的信息，只要是关于${userName}特征的都要记录

【habit · 小习惯】
- 涵盖：${charName}自身表现出的行为模式、口头禅、特定情境下的固定反应、说话方式特点
- title：写${charName}的具体习惯，如"生气时爱冷战""睡前必说晚安"
- 只记录${charName}自己的习惯，不记录${userName}的（${userName}的归 detail 类）

【conflict · 小打小闹】
- 涵盖：日常拌嘴、因小事闹别扭、玩笑性质的争执、冷战、互相怼、每一次具体的口角
- title：写这次争执的起因或核心，如"为谁先说晚安吵架"
- 每次争执独立成条，不要合并"他们经常拌嘴"这种表达

【nickname · 昵称称呼】⚠️ 关键约束 ⚠️
- 只记录双方实际使用的称呼词本身，例如"宝宝""乖""笨蛋""小猫"
- title 字段【必须】填写称呼词本身，例如 title: "乖乖"，绝对不允许填写"${charName}叫${userName}乖乖"或"急躁时的特殊称呼"这类描述性句子
- content 里再描述这个称呼在什么情境下使用、首次出现的语境
- 如果一条记录里出现了多个不同的新称呼，每个称呼分别单独一条

═══ 情绪标签 ═══
sweet（甜蜜温柔）/ warm（温暖日常）/ tense（紧张微妙）/ angry（争执激动）/ complex（复杂矛盾）/ neutral（平静日常）

═══ 稀有度 ═══
legend（极重要转折/第一次/重大表白承诺）/ rare（较有意义的时刻）/ common（日常细节）

${focusNote}

═══ 收藏说明 ═══
对于情感浓度高、特别打动人、或具有标志性意义的对话原文，放入 favorites：
- type:"quote" → 单句，适合金句、重要表白、关键承诺
- type:"dialog" → 多轮对话，适合完整的有意义的来回交流片段
folder 默认填"默认"，note 可选填为什么值得收藏

═══ 输出格式（严格JSON，禁止任何markdown包裹或额外说明）═══
{
  "memories": [
    {
      "category": "promise|detail|habit|conflict|nickname",
      "title": "10字以内核心标签",
      "content": "以${charName}为中心的第三人称叙述，30-120字，说清楚情境+内容+反应",
      "emotion": "sweet|warm|tense|angry|complex|neutral",
      "rarity": "legend|rare|common",
      "floor": 来源楼层号
    }
  ],
  "favorites": [
    {"type": "quote", "content": "原文", "senderRole": "char或user", "floor": 楼层号, "folder": "默认", "note": "可选备注"},
    {"type": "dialog", "messages": [{"senderRole": "char", "content": "...", "floor": 1}, {"senderRole": "user", "content": "...", "floor": 2}], "folder": "默认", "note": "可选备注"}
  ]
}
`.trim();

    return [
      wbPre  ? `[世界书·前置]\n${wbPre}\n\n` : '',
      char.persona  ? `[${charName}的人设]\n${char.persona}\n\n` : '',
      user?.persona ? `[${userName}的人设]\n${user.persona}\n\n` : '',
      wbPost ? `[世界书·后置]\n${wbPost}\n\n` : '',
      corePrompt,
    ].filter(Boolean).join('');
  }

  /* ─────────────────────────────────────
     主提取函数
  ───────────────────────────────────── */

  async function extract(params) {
    const {
      char, chat, user,
      mode     = 'cont',
      focus    = 'full',
      step     = 50,
      latestN  = 50,
      manFrom  = 1,
      manTo    = 100,
      nextFloor = 1,
      onLog    = () => {},
    } = params;

    _group('🌸 开始提取记忆');
    _log(`角色: ${char?.name}  聊天: ${chat?.id}  模式: ${mode}  侧重: ${focus}`, C.pink);

    if (!char || !chat) throw new Error('请先选择角色与聊天');

    const api = await _getApiConfig();
    _log(`API端点: ${api.url || '⚠️ 未配置'}  模型: ${api.model}  温度: ${api.temp}`, C.dim);
    if (!api.url || !api.key) throw new Error('请先在设置中配置 API 地址和密钥');

    // ── 确定楼层范围 ──
    let fromFloor, toFloor, isManual = false;
    const maxF = await _getMaxFloor(chat.id);
    _log(`聊天最大楼层: F${maxF}`, C.dim);

    if (mode === 'cont') {
      fromFloor = nextFloor;
      toFloor   = Math.min(fromFloor + step - 1, maxF);
      if (fromFloor > maxF) throw new Error(`无新楼层可提取（当前最大 F${maxF}）`);
      onLog(`连续模式：F${fromFloor} — F${toFloor}（步长 ${step}）`);
    } else if (mode === 'latest') {
      toFloor   = maxF;
      fromFloor = Math.max(1, maxF - latestN + 1);
      onLog(`最新 ${latestN} 条：F${fromFloor} — F${toFloor}`);
    } else {
      fromFloor = manFrom;
      toFloor   = manTo;
      isManual  = true;
      onLog(`手动范围：F${fromFloor} — F${toFloor}`);
    }
    _log(`提取范围: F${fromFloor} → F${toFloor}  isManual: ${isManual}`, C.dim);

    // ── 读取消息 ──
    const allMsgs = await _getMsgs(chat.id, fromFloor, toFloor);
    const tm = allMsgs.filter(m => m.type === 'text' || m.type === 'system' || !m.type);
    if (!tm.length) throw new Error('该范围内无文本消息');

    const actualMin = Math.min(...tm.map(m => m.floor || 0));
    const actualMax = Math.max(...tm.map(m => m.floor || 0));
    onLog(`共 ${tm.length} 条文本消息（F${actualMin}-F${actualMax}），构建提示词…`);
    _log(`有效文本消息: ${tm.length} 条`, C.ok);

    // ── 获取历史格式 ──
    let historyLines;
    try {
      historyLines = await getHistory(chat.id, { fromFloor, toFloor, historyCount: 0 });
      if (!historyLines.length) throw new Error('empty');
    } catch (e) {
      historyLines = tm.map(m => {
        const sender  = m.senderRole === 'user' ? (user?.name || '用户') : (char.name || '角色');
        const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content || '');
        return `[F${m.floor}][${sender}] ${content}`;
      });
    }

    // ── 构建提示词 ──
    const cname = chat.customName || chat.title || chat.name || chat.id || '未命名聊天';
    const sys   = _buildSystemPrompt(char, user, chat, focus);
    const historyText = historyLines.join('\n').slice(0, 16000);
    const usr   = `聊天室：${cname}\n主角（角色）：${char.name}\n用户：${user?.name || '用户'}\n提取范围：F${actualMin}-F${actualMax}，共 ${tm.length} 条消息\n\n━━━ 对话记录 ━━━\n\n${historyText}`;

    // ── 控制台打印提示词 ──
    console.group('%c[MemoryAPI] 📋 系统提示词 (System Prompt)', C.section);
    console.log('%c' + sys, 'color:#e2e8f0;font-size:11px;white-space:pre-wrap;');
    console.groupEnd();

    console.group('%c[MemoryAPI] 📨 用户提示词 (User Prompt)', C.section);
    console.log(`%c角色: ${char.name} | 用户: ${user?.name || '用户'} | 聊天: ${cname}`, C.pink);
    console.log(`%c楼层范围: F${actualMin} → F${actualMax} | 消息数: ${tm.length} | 历史行数: ${historyLines.length}`, C.dim);
    console.log('%c--- 对话内容预览（前2000字）---', C.dim);
    console.log('%c' + historyText.slice(0, 2000), 'color:#94a3b8;font-size:10px;white-space:pre-wrap;');
    if (historyText.length > 2000) console.log(`%c... （共 ${historyText.length} 字，已截断显示）`, C.dim);
    console.groupEnd();

    // ── 调用 API ──
    onLog('调用 AI…');
    _log(`发送请求 → ${api.url}/v1/chat/completions  model=${api.model}`, C.pink);

    const r = await fetch(`${api.url}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${api.key}`,
      },
      body: JSON.stringify({
        model:       api.model,
        temperature: api.temp,
        messages: [
          { role: 'system', content: sys },
          { role: 'user',   content: usr },
        ],
      }),
    });

    if (!r.ok) {
      const errData = await r.json().catch(() => ({}));
      const msg = errData.error?.message || `HTTP ${r.status}`;
      _log(`❌ API请求失败: ${msg}`, C.err);
      throw new Error(msg);
    }

    const dat = await r.json();
    const raw = dat.choices?.[0]?.message?.content || '{}';

    // ── 控制台打印原始回复 ──
    console.group('%c[MemoryAPI] 📩 AI 原始回复 (Raw Response)', C.section);
    _log(`usage: prompt_tokens=${dat.usage?.prompt_tokens} / completion_tokens=${dat.usage?.completion_tokens}`, C.dim);
    console.log('%c' + raw, 'color:#fbbf24;font-size:11px;white-space:pre-wrap;');
    console.groupEnd();

    // ── 解析 JSON ──
    let parsed;
    try {
      parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
    } catch (e) {
      _log(`❌ JSON解析失败，原始内容前200字: ${raw.slice(0, 200)}`, C.err);
      throw new Error('AI 返回格式解析失败: ' + raw.slice(0, 120));
    }

    const memories  = Array.isArray(parsed) ? parsed : (parsed.memories  || []);
    const favorites = parsed.favorites || [];

    // ── 控制台打印解析结果 ──
    console.group('%c[MemoryAPI] ✅ 解析结果明细', C.ok);
    _log(`记忆总数: ${memories.length}  收藏总数: ${favorites.length}`, C.ok);

    // 按分类汇总
    const catCount = {};
    memories.forEach(m => { catCount[m.category] = (catCount[m.category] || 0) + 1; });
    console.log('%c分类统计:', C.section, catCount);

    // 逐条打印记忆
    if (memories.length) {
      console.group('%c记忆明细:', C.pink);
      memories.forEach((m, i) => {
        const catLabel = { promise:'承诺', detail:'细节', habit:'习惯', conflict:'争执', nickname:'昵称' }[m.category] || m.category;
        console.log(
          `%c[${i+1}] [${catLabel}·${m.rarity}·F${m.floor}] %c${m.title}`,
          'color:#f9a8d4;font-weight:bold;',
          'color:#fff;font-weight:bold;'
        );
        console.log(`%c  → ${m.content}`, 'color:#94a3b8;');
        console.log(`%c  emotion: ${m.emotion}`, 'color:#64748b;');
      });
      console.groupEnd();
    }

    // 昵称专项检查
    const nicknames = memories.filter(m => m.category === 'nickname');
    if (nicknames.length) {
      console.group('%c📛 昵称提取检查', C.section);
      nicknames.forEach(n => {
        const titleLen = [...n.title].length;
        const warn = titleLen > 6 ? '⚠️ title疑似描述句而非称呼词本身，请检查' : '✅ 格式正确';
        console.log(`%c  title: "${n.title}" (${titleLen}字) ${warn}`, titleLen > 6 ? C.warn : C.ok);
        console.log(`%c  content: ${n.content}`, C.dim);
      });
      console.groupEnd();
    }

    // 收藏明细
    if (favorites.length) {
      console.group('%c收藏明细:', C.pink);
      favorites.forEach((f, i) => {
        if (f.type === 'quote') {
          console.log(`%c[${i+1}] quote · F${f.floor} · ${f.folder}`, C.pink);
          console.log(`%c  "${f.content?.slice(0, 60)}"`, C.dim);
        } else {
          console.log(`%c[${i+1}] dialog · ${f.messages?.length}条 · ${f.folder}`, C.pink);
        }
      });
      console.groupEnd();
    }

    console.groupEnd(); // 解析结果明细

    onLog(`AI 返回 ${memories.length} 条记忆，${favorites.length} 条收藏`);

    // ── 写入 IDB ──
    const now   = Date.now();
    const fmeta = { min: actualMin, max: actualMax };
    let savedM = 0, savedF = 0;

    for (const it of memories) {
      if (!it.category || !it.title) {
        _log(`⚠️ 跳过无效记忆条目（缺 category 或 title）: ${JSON.stringify(it).slice(0,80)}`, C.warn);
        continue;
      }
      await _pOne('memories', {
        id:              `mem_${char.id}_${it.category}_${now}_${savedM}`,
        charId:          char.id,
        chatId:          chat.id,
        category:        it.category,
        title:           it.title,
        content:         it.content || '',
        emotion:         it.emotion || 'neutral',
        rarity:          it.rarity  || 'common',
        floor:           it.floor   || 0,
        extractedFloors: isManual ? null : fmeta,
        createdAt:       now,
      });
      savedM++;
    }

    for (const fav of favorites) {
      if (!fav.type) continue;
      await _pOne('mem_favorites', {
        id:         `fav_${now}_${savedF}`,
        charId:     char.id,
        chatId:     chat.id,
        folder:     fav.folder || '默认',
        type:       fav.type,
        content:    fav.content || '',
        senderRole: fav.senderRole || 'char',
        floor:      fav.floor || 0,
        messages:   fav.messages || [],
        floorRange: fav.messages?.length
          ? `${Math.min(...fav.messages.map(m => m.floor || 0))}-${Math.max(...fav.messages.map(m => m.floor || 0))}`
          : String(fav.floor || '?'),
        note: fav.note || '',
        ts:   now,
      });
      savedF++;
    }

    const updatedNextFloor = (!isManual && actualMax >= nextFloor) ? actualMax + 1 : nextFloor;

    _log(`✅ 写入完成 — 记忆 ${savedM} 条，收藏 ${savedF} 条  下次楼层: F${updatedNextFloor}`, C.ok);
    onLog(`完成！记忆 ${savedM} 条，收藏 ${savedF} 条 (F${actualMin}-F${actualMax})`, 'lok');
    _groupEnd(); // 开始提取记忆

    return {
      memories,
      favorites,
      savedMemories:    savedM,
      savedFavorites:   savedF,
      actualMin,
      actualMax,
      isManual,
      nextFloor:        updatedNextFloor,
    };
  }

  /* ─────────────────────────────────────
     清除记忆
  ───────────────────────────────────── */

  async function clearMemories(charId, chatId) {
    const db  = await _openDB();
    const all = await new Promise((res, rej) => {
      const q = db.transaction('memories', 'readonly').objectStore('memories').getAll();
      q.onsuccess = () => res(q.result || []);
      q.onerror   = e => rej(e.target.error);
    });
    const toDelete = all.filter(m => m.charId === charId && m.chatId === chatId);
    for (const m of toDelete) {
      await new Promise((res, rej) => {
        const q = db.transaction('memories', 'readwrite').objectStore('memories').delete(m.id);
        q.onsuccess = res;
        q.onerror   = e => rej(e.target.error);
      });
    }
    _log(`clearMemories: 删除 ${toDelete.length} 条`, C.warn);
    return toDelete.length;
  }

  /* ─────────────────────────────────────
     对外挂载
  ───────────────────────────────────── */

  window.MemoryAPI = {
    extract,
    getHistory,
    clearMemories,
    _getMaxFloor,
    _getMsgs,
    _getApiConfig,
  };

  console.log('%c[MemoryAPI] ✅ v2.0 已挂载到 window.MemoryAPI', C.section);

})();
