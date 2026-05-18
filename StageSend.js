/**
 * StageSend.js v1.6
 * 修复换行丢失问题 | 修复开关无法点击问题 | 强化长篇沉浸式小说级指令
 */

(function () {
  'use strict';

  const SWIPE_THRESHOLD = 60;
  const EMPTY_NUDGE =
    '（请根据当前舞台的剧情上下文，自然地推进故事。请进行深度的心理和环境描写，让这段剧情充满沉浸感。）';

  // ── 模式 A：ON 分段模式 ── 三段式提示词 ──────────────────────────

  // [A-1] 引入语：wb_pre / wb_mid 之后，衔接角色设定区
  const PROMPT_SEGMENTED_INTRO = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[Offline Theater — Segmented Mode · Character & World Reference]
The following sections contain the world-building entries, character identities, personas, and author notes for this theater session.
Read and internalize all of it carefully before writing. These are the foundations of every character voice, relationship dynamic, and scene detail you will produce.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`.trim();

  // [A-2] 核心指令：wb_local 之后，历史记录之前
  const PROMPT_SEGMENTED_CORE = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[Offline Theater — Segmented Mode · Writing Directive]
You are a world-class Chinese novelist and immersive Roleplay co-author. Your role is to drive a SLOW-BURN, deeply atmospheric interactive theater — one reply at a time.

CORE WRITING MANDATE — NON-NEGOTIABLE:
• Every reply MUST be a substantial literary piece: 6–10+ paragraphs, 800–1500+ Chinese characters minimum.
• Do NOT rush. Expand every beat — linger on micro-expressions, suppressed emotions, body language, shifting atmosphere, and unspoken subtext.
• Every line of dialogue must be embedded in rich action beats and psychological narration. Never let a character speak in a vacuum.
• Write as if this is a chapter of a bestselling Chinese web novel. The reader must feel immersed, emotionally hooked, and reluctant to stop.
• Short replies, dialogue-only replies, or summary-style replies are PROHIBITED. They are a failure of craft.

The conversation history below is your stage. Step into it and continue the story.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`.trim();

  // [A-3] 末尾加固：历史记录之后
  const PROMPT_SEGMENTED_SUFFIX = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[Offline Theater — Segmented Mode · Output Rules]
STRICTLY FOLLOW THIS FORMAT — NO EXCEPTIONS:
1. Every discrete action, inner thought, or dialogue unit starts on a NEW LINE with a tag.
2. [char|角色名] — for any character's dialogue, action, or inner monologue.
3. [narrator|旁白] — for scene narration, atmosphere, time flow, or environmental description.
4. NO JSON. NO markdown. Pure plain text only.
5. Produce 8–12+ tagged blocks per reply. Each block must be multiple rich sentences — never a naked single line.
6. Alternate between [narrator] atmosphere and [char] interiority to build layered, immersive scenes.

Output example:
[narrator|旁白] 走廊尽头的灯光打了一下，像是在犹豫，最终还是没有熄灭。空气里弥漫着消毒水与旧木头混合的气息，安静得能听见彼此的呼吸。
[char|祁京野] （他停在门边，没有立刻开口。手指轻叩了一下门框，那个习惯性的小动作出卖了他此刻压在平静面具下的一丝不确定。）既然来了，就别急着走。

Now write. Go deep. Go long. Make every word earn its place.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`.trim();

  // ── 模式 B：OFF 合并模式 ── 三段式提示词 ──────────────────────────

  // [B-1] 引入语：wb_pre / wb_mid 之后，衔接角色设定区
  const PROMPT_MERGED_INTRO = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[Offline Theater — Continuous Novel Mode · Character & World Reference]
The following sections contain the world-building entries, character identities, personas, and author notes for this theater session.
Read and internalize all of it carefully before writing. These are the foundations of every character voice, relationship dynamic, and scene detail you will produce.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`.trim();

  // [B-2] 核心指令：wb_local 之后，历史记录之前
  const PROMPT_MERGED_CORE = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[Offline Theater — Continuous Novel Mode · Writing Directive]
You are a world-class Chinese novelist and immersive Roleplay co-author. Your role is to drive a SLOW-BURN, deeply atmospheric interactive theater through seamless, unbroken prose.

CORE WRITING MANDATE — NON-NEGOTIABLE:
• Every reply MUST be a substantial literary piece: 6–10+ paragraphs, 800–1500+ Chinese characters minimum.
• Do NOT rush. Expand every beat — linger on micro-expressions, suppressed emotions, body language, shifting atmosphere, and unspoken subtext.
• Weave all dialogue into the narrative fabric. Surround every spoken line with gesture, breath, hesitation, and the character's interior world.
• Write as if this is a chapter of a bestselling Chinese web novel. The reader must feel immersed, emotionally hooked, and reluctant to stop.
• Short replies, dialogue-only replies, or summary-style replies are PROHIBITED. They are a failure of craft.

The conversation history below is your stage. Step into it and continue the story.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`.trim();

  // [B-3] 末尾加固：历史记录之后
  const PROMPT_MERGED_SUFFIX = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[Offline Theater — Continuous Novel Mode · Output Rules]
STRICTLY FOLLOW THIS FORMAT — NO EXCEPTIONS:
1. Write in pure, unbroken prose. NO segmented tags like [char|Name] or [narrator] anywhere.
2. NO JSON. NO markdown. Pure plain text only.
3. All dialogue must be embedded naturally in the narrative — attributed through action beats, not bare quotation marks alone.
4. Produce 8–12+ dense paragraphs. Do NOT stop early. Do NOT summarize. Do NOT skip beats.
5. Let the scene breathe: use paragraph breaks to control pacing, not to cut short.

Output example:
走廊尽头的灯光打了一下，像是在犹豫，最终还是没有熄灭。空气里弥漫着消毒水与旧木头混合的气息，安静得能听见彼此的呼吸。祁京野停在门边，没有立刻开口。他手指轻叩了一下门框，那个习惯性的小动作出卖了他此刻压在平静面具下的一丝不确定。"既然来了，就别急着走。"他最终还是开了口，声音不高，却有种漫不经心的笃定，像是早就预料到了她会站在这里。

Now write. Go deep. Go long. Make every word earn its place.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`.trim();

  const IDB_CONFIG = {
    name: 'tsukiphonepromax',
    stores: {
      config: 'config',
      worldbook: 'worldbook',
      theaters: 'theaters',
      theater_messages: 'theater_messages',
      chars: 'chars',
    },
  };

  /* ═══════════════════════════════════════════════════════════
     1. 配置持久化与 UI (修复开关失效)
  ═══════════════════════════════════════════════════════════ */
  async function getRenderConfig() {
    const db = await getDb();
    return new Promise(res => {
      const tx = db.transaction('config', 'readonly');
      const req = tx.objectStore('config').get('stage_render_config');
      req.onsuccess = () => res(req.result?.segmented ?? false); // 默认 OFF
      req.onerror = () => res(false);
    });
  }

  async function setRenderConfig(isSegmented) {
    const db = await getDb();
    const tx = db.transaction('config', 'readwrite');
    tx.objectStore('config').put({ id: 'stage_render_config', segmented: isSegmented });

    const toggle = document.getElementById('renderModeToggle');
    if (toggle) {
      toggle.innerText = isSegmented ? 'ON' : 'OFF';
      toggle.style.background = isSegmented ? 'var(--ink)' : 'var(--s-line)';
      toggle.style.color = isSegmented ? 'var(--accent-lime)' : 'var(--mute)'; // 增加明显的颜色反馈
    }
  }

  function initConfigUI() {
    const toggle = document.getElementById('renderModeToggle');
    // 如果找不到开关，说明 DOM 还没渲染完，0.5秒后重试
    if (!toggle) {
      setTimeout(initConfigUI, 500);
      return;
    }
    // 防止重复绑定
    if (toggle._isBound) return;
    toggle._isBound = true;

    // 初始化显示状态
    getRenderConfig().then(isSegmented => {
      toggle.innerText = isSegmented ? 'ON' : 'OFF';
      toggle.style.background = isSegmented ? 'var(--ink)' : 'var(--s-line)';
      toggle.style.color = isSegmented ? 'var(--accent-lime)' : 'var(--mute)';
    });

    // 绑定点击事件
    toggle.addEventListener('click', async () => {
      const current = await getRenderConfig();
      await setRenderConfig(!current);
    });
  }

  /* ═══════════════════════════════════════════════════════════
     0. CSS 动态注入 & 打字机 (修复换行丢失)
  ═══════════════════════════════════════════════════════════ */
  if (!document.getElementById('stage-text-styles')) {
    const style = document.createElement('style');
    style.id = 'stage-text-styles';
    style.textContent = `
      .stage-quote { color: var(--accent-amber, #ff9f43); font-style: italic; opacity: 0.95; }
      .stage-emphasis { color: var(--accent-lime, #d4ff4d); font-weight: 600; text-shadow: 0 0 6px rgba(212,255,77,0.15); }
      .stage-typing-cursor { 
        display: inline-block; width: 4px; height: 1em; 
        background: var(--accent-lime); vertical-align: middle; 
        margin-left: 2px; animation: stage-blink 1s step-end infinite; 
      }
      @keyframes stage-blink { 50% { opacity: 0; } }
    `;
    document.head.appendChild(style);
  }

  // 格式化函数：处理加粗、引号和换行
  function formatStageText(text) {
    if (typeof text !== 'string') return text;

    // 🌟 安全保护：如果这是一条带有复杂 HTML 结构的消息（如置入的前置剧情），直接跳过正则，防止破坏标签的双引号！
    if (text.includes('<div') && text.includes('class=')) {
      return text;
    }

    let html = text.replace(/\*\*(.*?)\*\*/g, '<span class="stage-emphasis">$1</span>');
    html = html.replace(/([“"「『])([^”"」』]+)([”"」』])/g, '<span class="stage-quote">$1$2$3</span>');
    html = html.replace(/\r?\n/g, '<br>');
    return html;
  }

  // 🌟 辅助函数：根据时间戳，智能折叠旧的历史记录
  function autoCollapseOldHistory(content, timestamp) {
    if (!content || typeof content !== 'string') return content;
    if (!content.includes('history-tag')) return content; // 如果不是前置剧情记录，直接跳过

    // 【核心魔法】计算这条消息是“刚刚发的”还是“以前存的”（时间差超过 2 秒即认为是页面初次加载的历史）
    const isOldMessage = Date.now() - (timestamp || 0) > 2000;

    if (isOldMessage) {
      try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(content, 'text/html');

        const tags = doc.querySelectorAll('.history-tag');
        if (tags.length === 0) return content;

        tags.forEach(tag => {
          // 注入折叠状态的样式
          tag.style.opacity = '0.6';
          const icon = tag.querySelector('i');
          if (icon) icon.style.transform = 'rotate(-90deg)';

          const entries = tag.nextElementSibling;
          if (entries && entries.classList.contains('history-entries')) {
            entries.style.display = 'none'; // 隐藏主体记录
            const foot = entries.nextElementSibling;
            if (foot && foot.classList.contains('history-foot')) {
              foot.style.display = 'none'; // 隐藏底边统计
            }
          }
        });
        return doc.body.innerHTML;
      } catch (e) {
        console.error('折叠解析失败', e);
        return content;
      }
    }
    // 如果是新鲜刚刚置入的，直接返回原文，保持展开状态！
    return content;
  }

  // 🌟【核心机制】：全局劫持剧场渲染函数，确保重新加载时依然拥有特效！
  if (typeof window.buildBubble === 'function' && !window.buildBubble._isStagePatched) {
    const origBuildBubble = window.buildBubble;
    window.buildBubble = function (msg, name, avatar, isUser) {
      const clonedMsg = { ...msg };
      if (typeof clonedMsg.content === 'string') {
        let text = clonedMsg.content;
        text = autoCollapseOldHistory(text, clonedMsg.timestamp); // 1. 先判断是否需要折叠
        text = formatStageText(text); // 2. 再处理字体特效
        clonedMsg.content = text;
      }
      return origBuildBubble(clonedMsg, name, avatar, isUser);
    };
    window.buildBubble._isStagePatched = true;
  }

  if (typeof window.buildNarratorBubble === 'function' && !window.buildNarratorBubble._isStagePatched) {
    const origBuildNarratorBubble = window.buildNarratorBubble;
    window.buildNarratorBubble = function (msg) {
      const clonedMsg = { ...msg };
      if (typeof clonedMsg.content === 'string') {
        let text = clonedMsg.content;
        text = autoCollapseOldHistory(text, clonedMsg.timestamp); // 1. 先判断是否需要折叠
        text = formatStageText(text); // 2. 再处理字体特效
        clonedMsg.content = text;
      }
      return origBuildNarratorBubble(clonedMsg);
    };
    window.buildNarratorBubble._isStagePatched = true;
  }

  async function typewriterHTML(container, htmlContent) {
    return new Promise(async resolve => {
      let i = 0,
        buffer = '';
      while (i < htmlContent.length) {
        if (htmlContent[i] === '<') {
          let tag = '';
          while (htmlContent[i] !== '>' && i < htmlContent.length) {
            tag += htmlContent[i];
            i++;
          }
          tag += '>';
          buffer += tag;
          i++;
          continue;
        } else if (htmlContent[i] === '&') {
          let ent = '';
          while (htmlContent[i] !== ';' && i < htmlContent.length) {
            ent += htmlContent[i];
            i++;
          }
          ent += ';';
          buffer += ent;
          i++;
        } else {
          buffer += htmlContent[i];
          i++;
        }
        container.innerHTML = buffer + '<span class="stage-typing-cursor"></span>';
        const area = document.getElementById('sArea');
        if (area) area.scrollTop = area.scrollHeight;
        await new Promise(r => setTimeout(r, 20));
      }
      container.innerHTML = buffer;
      resolve();
    });
  }

  /* ═══════════════════════════════════════════════════════════
     2. 工具函数 & 提示词构建
  ═══════════════════════════════════════════════════════════ */
  async function getDb() {
    return new Promise((res, rej) => {
      const req = indexedDB.open(IDB_CONFIG.name);
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  }

  async function dbGet(storeName, key) {
    if (!key) return null;
    const db = await getDb();
    if (!db.objectStoreNames.contains(storeName)) return null;
    return new Promise(res => {
      try {
        const tx = db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).get(key);
        req.onsuccess = () => res(req.result);
        req.onerror = () => res(null);
      } catch (e) {
        res(null);
      }
    });
  }

  function isKeywordTriggered(text, keysStr) {
    if (!keysStr || keysStr.trim() === '') return true;
    const keys = keysStr
      .split(/[,，]/)
      .map(k => k.trim().toLowerCase())
      .filter(Boolean);
    const target = text.toLowerCase();
    return keys.some(key => target.includes(key));
  }

  const sortByPriority = (a, b) => Number(b.priority || 100) - Number(a.priority || 100);

  async function buildStageFinalPromptStream(theater, latestMessage = '', instructionIntro = '', instructionCore = '', instructionSuffix = '') {
    const db = await getDb();
    const finalStream = [];
    const charIds = theater.charIds || [];
    const category = 'offline';

    async function getGlobalWb(key) {
      if (!db.objectStoreNames.contains(IDB_CONFIG.stores.worldbook)) return [];
      return new Promise(res => {
        try {
          const tx = db.transaction(IDB_CONFIG.stores.worldbook, 'readonly');
          const req = tx.objectStore(IDB_CONFIG.stores.worldbook).get(key);
          req.onsuccess = () => res(Array.isArray(req.result) ? req.result : []);
          req.onerror = () => res([]);
        } catch (e) {
          res([]);
        }
      });
    }

    function stripHtml(str) {
      if (typeof str !== 'string') return str;
      return str
        .replace(/<br\s*\/?>/gi, '\n')          // <br> → 真换行
        .replace(/<\/p>/gi, '\n')               // </p> → 换行
        .replace(/<[^>]+>/g, '')                // 其余标签全删
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
        .trim();
    }

    const pushWbWithLog = list => {
      const filtered = list
        .filter(
          item =>
            item.enabled &&
            (!item.category || item.category === '所有' || item.category.toLowerCase() === category) &&
            isKeywordTriggered(latestMessage, item.keys),
        )
        .sort(sortByPriority);
      filtered.forEach(item => finalStream.push(stripHtml(item.content)));
    };

    pushWbWithLog(await getGlobalWb('wb_pre'));
    pushWbWithLog(await getGlobalWb('wb_mid'));
    if (instructionIntro) finalStream.push(instructionIntro);
    pushWbWithLog(await getGlobalWb('wb_global'));

    for (const cid of charIds) {
      const char = await dbGet(IDB_CONFIG.stores.chars, cid);
      if (!char) continue;

      // 角色世界书 Pre（前置，关键词触发）
      const preWb = (char.worldbook || [])
        .filter(s => s.type === 'pre' && s.enabled && isKeywordTriggered(latestMessage, s.keys))
        .sort(sortByPriority);
      preWb.forEach(s => finalStream.push(`[Memory Shard: ${s.title || ''}]\n${stripHtml(s.content)}`));

      // 角色身份 + 人设
      if (char.name) finalStream.push(`[Character Identification]\nName: ${char.name}`);
      if (char.persona) finalStream.push(`[Character Persona: ${char.name}]\n${stripHtml(char.persona)}`);

      // 角色世界书 Post（后置，关键词触发）
      const postWb = (char.worldbook || [])
        .filter(s => s.type === 'post' && s.enabled && isKeywordTriggered(latestMessage, s.keys))
        .sort(sortByPriority);
      postWb.forEach(s => finalStream.push(`[Author Notes: ${s.title || ''}]\n${stripHtml(s.content)}`));
    }

    const localWbList = await getGlobalWb('wb_local');

    // ── 🔍 局部世界书诊断：打印每条条目的原始 category 值 ──
    console.group('%c[StageSend] 🔍 局部世界书 category 诊断', 'color:#f59e0b;font-weight:bold');
    console.log('当前 category (线下固定值):', JSON.stringify(category));
    console.log('当前剧场 charIds:', JSON.stringify(charIds));
    console.log('wb_local 共', localWbList.length, '条');
    localWbList.forEach((item, i) => {
      const boundIds = Array.isArray(item.charIds) ? item.charIds : item.charIds ? [item.charIds] : [];
      const catPass   = !item.category || item.category === '所有' || item.category.toLowerCase() === category;
      const boundPass = charIds.some(id => boundIds.includes(id));
      const kwPass    = (() => { if (!item.keys || item.keys.trim() === '') return true; const keys = item.keys.split(/[,，]/).map(k => k.trim().toLowerCase()).filter(Boolean); return keys.some(k => (latestMessage || '').toLowerCase().includes(k)); })();
      console.log(
        '[' + i + '] "' + (item.title || '无标题') + '"' +
        '  category=' + JSON.stringify(item.category ?? '(undefined)') +
        '  enabled=' + item.enabled +
        '  catPass=' + catPass +
        '  boundPass=' + boundPass +
        '  kwPass=' + kwPass +
        '  → 最终:' + (item.enabled && catPass && boundPass && kwPass ? '✅传入' : '❌过滤')
      );
    });
    console.groupEnd();

    localWbList
      .filter(item => {
        const boundIds = Array.isArray(item.charIds) ? item.charIds : item.charIds ? [item.charIds] : [];
        return (
          item.enabled &&
          (!item.category || item.category === '所有' || item.category.toLowerCase() === category) &&
          charIds.some(id => boundIds.includes(id)) &&
          isKeywordTriggered(latestMessage, item.keys)
        );
      })
      .sort(sortByPriority)
      .forEach(item => finalStream.push(stripHtml(item.content)));

    if (instructionCore) finalStream.push(instructionCore);

    const theaterHistory = await buildTheaterHistoryText(theater.id);
    if (theaterHistory) {
      finalStream.push(
        `\n========== THEATER STAGE HISTORY START ==========\n${theaterHistory}\n========== THEATER STAGE HISTORY END ==========\n`,
      );
    }

    if (instructionSuffix) finalStream.push(instructionSuffix);
    pushWbWithLog(await getGlobalWb('wb_post'));

    return finalStream;
  }

  async function buildTheaterHistoryText(theaterId) {
    const db = await getDb();
    if (!db.objectStoreNames.contains(IDB_CONFIG.stores.theater_messages)) return '';

    // ── 读取剧场信息，构建 charId → 名字 Map ──
    let charNameMap = {};
    try {
      const theater = await new Promise(res => {
        const tx = db.transaction('theaters', 'readonly');
        const req = tx.objectStore('theaters').get(theaterId);
        req.onsuccess = () => res(req.result || null);
        req.onerror = () => res(null);
      });
      if (theater && Array.isArray(theater.charIds)) {
        for (const cid of theater.charIds) {
          const ch = await dbGet(IDB_CONFIG.stores.chars, cid);
          if (ch) charNameMap[cid] = ch.name;
        }
      }
    } catch (e) { /* 查不到就用兜底 */ }

    // ── 读取全部舞台消息 ──
    const allMsgs = await new Promise(res => {
      try {
        const tx = db.transaction(IDB_CONFIG.stores.theater_messages, 'readonly');
        const req = tx.objectStore(IDB_CONFIG.stores.theater_messages).index('by_theater').getAll(theaterId);
        req.onsuccess = () => res((req.result || []).sort((a, b) => a.floor - b.floor));
        req.onerror = () => res([]);
      } catch (e) { res([]); }
    });

    // ── 尝试展开语音通话记录（对齐 PromptHelper 的 voice_messages 逻辑） ──
    async function expandCallRecord(m) {
      const content = m.content && typeof m.content === 'object' ? m.content : {};
      const callState = content.callState || '';
      if (callState !== 'answered' && callState !== 'ended') return null;
      if (content.callType === 'video') return null; // 视频通话不展开文字

      // callSessionKey 对齐 VoiceSend.js：theaterId + '_call' + floor
      const _sessionKey = theaterId + '_call' + m.floor;
      try {
        const db2 = await new Promise((res, rej) => {
          const req = indexedDB.open('tsukiphonepromax');
          req.onsuccess = () => res(req.result);
          req.onerror = () => rej(req.error);
        });
        if (!db2.objectStoreNames.contains('voice_messages')) return null;

        const voiceMsgs = await new Promise(res => {
          try {
            const tx = db2.transaction('voice_messages', 'readonly');
            const store = tx.objectStore('voice_messages');
            let req;
            try {
              req = store.index('by_chat').getAll(IDBKeyRange.only(_sessionKey));
            } catch (e) {
              req = store.getAll();
            }
            req.onsuccess = () => {
              const all = (req.result || [])
                .filter(v => v.chatId === _sessionKey)
                .sort((a, b) => (a.floor || 0) - (b.floor || 0));
              res(all);
            };
            req.onerror = () => res([]);
          } catch (e) { res([]); }
        });

        if (!voiceMsgs.length) return null;

        const callType = content.callType === 'video' ? '视频通话' : '语音通话';
        const duration = content.duration || 0;
        const mm = Math.floor(duration / 60), ss = duration % 60;
        const durStr = duration > 0
          ? `已结束（通话时长 ${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}）`
          : '已结束';

        const lines = voiceMsgs.map(v => {
          const sender = v.senderRole === 'user' ? 'user' : (v.charId && charNameMap[v.charId]) || v.charName || 'char';
          const typeLabel = v.type === 'narration' ? '旁白' : '语音';
          return `[${sender}|${typeLabel}] ${v.content || ''}\n`;
        });

        return (
          `与用户进行了一场线下语音通话\n========== ${callType}记录 START ==========\n` +
          `[系统] ${callType}·${durStr}\n` +
          lines.join('\n') + '\n' +
          `========== ${callType}记录 END ==========`
        );
      } catch (e) {
        console.warn('[buildTheaterHistoryText] expandCallRecord 失败:', e);
        return null;
      }
    }

    // ── 尝试读取 theater_summaries（单独开新连接，确保拿到最新 schema） ──
    let summaries = [];
    try {
      const dbForSummary = await new Promise((res, rej) => {
        const req = indexedDB.open('tsukiphonepromax');
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
      });
      if (dbForSummary.objectStoreNames.contains('theater_summaries')) {
        summaries = await new Promise(res => {
          try {
            const tx = dbForSummary.transaction('theater_summaries', 'readonly');
            const req = tx.objectStore('theater_summaries').index('by_theater').getAll(theaterId);
            req.onsuccess = () => {
              const result = (req.result || []).sort((a, b) => a.floorStart - b.floorStart);
              console.log('%c[StageSend] theater_summaries 读取成功，条数: ' + result.length, 'color:#43d9a0;font-weight:bold');
              res(result);
            };
            req.onerror = () => res([]);
          } catch (e) { res([]); }
        });
      } else {
        console.log('%c[StageSend] theater_summaries store 不存在，使用完整历史', 'color:#8a8a8e');
      }
    } catch (e) {
      console.warn('[StageSend] 读取 theater_summaries 失败:', e);
    }

    // ── 单条消息 → 文本行（async，call 类型优先展开通话记录） ──
    async function msgToLine(m) {
      let content = m.content || '';

      // ── 处理对象格式内容 ──
      if (typeof content === 'object') {
        const msgType = m.type || '';
        if (msgType === 'sticker' || content.url) {
          let stickerName = (content.name || '表情包')
            .split(/http/i)[0]
            .replace(/[:：|]\s*$/, '')
            .replace(/\.(jpg|jpeg|gif|png|webp)$/i, '')
            .trim();
          content = `[表情包] ${stickerName}`;
        } else if (msgType === 'call' || content.callType) {
          // ── 先查该楼层范围内有没有通话记录 ──
          const expanded = await expandCallRecord(m);
          if (expanded) return expanded;

          // 降级：无通话记录，输出摘要行
          const callType = content.callType === 'video' ? '视频通话' : '语音通话';
          const callState = content.callState || 'ended';
          const duration = content.duration || 0;
          function _fmtDur(sec) {
            const mm = Math.floor(sec / 60), ss = sec % 60;
            return String(mm).padStart(2,'0') + ':' + String(ss).padStart(2,'0');
          }
          if (callState === 'ended') {
            content = duration > 0
              ? `${callType}·通话已结束（通话时长 ${_fmtDur(duration)}）`
              : `${callType}·通话已结束`;
          } else if (callState === 'canceled') {
            content = `${callType}·已取消`;
          } else if (callState === 'missed') {
            content = `${callType}·未接听`;
          } else {
            content = `${callType}·呼叫中`;
          }
        } else if (content.transcript != null) {
          content = content.transcript ? `[语音] ${content.transcript}` : '[语音消息]';
        } else if (content.amount != null) {
          const note = content.note || content.remark || '';
          content = note ? `[转账] ${content.amount}元 备注：${note}` : `[转账] ${content.amount}元`;
        } else {
          content = content.transcript || content.name || JSON.stringify(content);
        }
      }

      // ── 处理 JSON 字符串形式的特殊消息 ──
      if (typeof content === 'string') {
        content = content
          .replace(/\{"transcript":"(.*?)"\}/g, '[语音] $1')
          .replace(/\{"name":"([^"]*)"[^}]*"url":"([^"]*)"[^}]*\}/g, (_, name, url) => {
            const cleanName = name.split(/http/i)[0].replace(/[:：|]\s*$/, '').replace(/\.(jpg|jpeg|gif|png|webp)$/i,'').trim();
            return `[表情包] ${cleanName}`;
          })
          .replace(/\{"callType":"(video|voice)"[^}]*"callState":"ended"[^}]*"duration":(\d+)[^}]*\}/g, (_, type, dur) => {
            const label = type === 'video' ? '视频通话' : '语音通话';
            const mm = Math.floor(Number(dur)/60), ss = Number(dur)%60;
            return `${label}·通话已结束（通话时长 ${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}）`;
          })
          .replace(/\{"callType":"(video|voice)"[^}]*"callState":"(\w+)"[^}]*\}/g, (_, type, state) => {
            const label = type === 'video' ? '视频通话' : '语音通话';
            const stateMap = { ended:'已结束', canceled:'已取消', missed:'未接听', answered:'通话中', ringing:'呼叫中' };
            return `${label}·${stateMap[state] || state}`;
          });
      }

      if (m.type === 'prologue') return `[Begin|序幕] ${String(content).replace(/<[^>]+>/g, '').trim()}\n`;
      if (m.type === 'history' || m.type === 'summary' || m.isSummary) {
        const raw = String(content);
        // ── 尝试从 history-entry HTML 结构解析出每条 [名字]内容 ──
        const entryRe = /<div[^>]*class="[^"]*history-entry[^"]*"[^>]*>[\s\S]*?<span[^>]*class="[^"]*history-entry-name[^"]*"[^>]*>([\s\S]*?)<\/span>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/gi;
        const entries = [];
        let match;
        while ((match = entryRe.exec(raw)) !== null) {
          const name = match[1].replace(/<[^>]+>/g, '').trim();
          const text = match[2].replace(/<[^>]+>/g, '').trim();
          if (name || text) entries.push(`[${name}]${text}`);
        }
        let cleaned;
        if (entries.length > 0) {
          cleaned = entries.join('\n');
        } else {
          // 降级：直接剥 HTML
          cleaned = raw
            .replace(/<button[^>]*>[\s\S]*?<\/button>/gi, '')
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/p>/gi, '\n')
            .replace(/<[^>]+>/g, '')
            .replace(/[^\S\n]+/g, ' ')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
        }
        return `[system|⚠️前置背景·来源线上聊天·非当前线下场景] \n${cleaned}\n`;
      }
      
      // 在 buildTheaterHistoryText 函数内，charNameMap 构建完之后，加：
let userNameMap = {}; // userId → name
try {
  const allUsers = await new Promise(res => {
    const tx = db.transaction('users', 'readonly');
    const req = tx.objectStore('users').getAll();
    req.onsuccess = () => res(req.result || []);
    req.onerror = () => res([]);
  });
  allUsers.forEach(u => { if (u && u.id) userNameMap[u.id] = u.name; });
} catch(e) { /* 查不到就用兜底 */ }

      if (m.type === 'summary_bubble') return null;
      // 格式 [tag|名字]
      const resolvedName = m.isNarrator
        ? '旁白'
: m.isUser
  ? (m.charId && userNameMap[m.charId]) || Object.values(userNameMap)[0] || 'user'
          : m.displayName || (m.charId && charNameMap[m.charId]) || 'char';
      const resolvedTag = m.isNarrator ? 'narrator' : m.isUser ? 'user' : 'char';
      return `[${resolvedTag}|${resolvedName}] ${content}\n`;
    }

    // ── 无总结记录：走原来逻辑 ──
    if (!summaries.length) {
      console.log('%c[StageSend] 无总结记录，使用完整历史', 'color:#8a8a8e');
      const lines = await Promise.all(allMsgs.map(m => msgToLine(m)));
      return lines.filter(Boolean).join('\n');
    }

    // ── 有总结记录：按楼层顺序线性拼合 ──
    const coveredFloors = new Set();
    for (const s of summaries) {
      for (let f = s.floorStart; f <= s.floorEnd; f++) coveredFloors.add(f);
    }

    // 构建统一时间线：每个元素都有 sortKey（楼层）和 text
    const timeline = [];

    // 1. 所有消息（history 永远保留，其他过滤掉被总结覆盖的）
    for (const m of allMsgs) {
      if (m.type === 'summary_bubble') continue;
      if (m.isSummary) continue;
      if (m.type !== 'history' && m.isSummarized === true) continue;
      if (m.type !== 'history' && m.type !== 'prologue' && coveredFloors.has(m.floor)) continue;
      const line = await msgToLine(m);
      if (line) timeline.push({ sortKey: m.floor, text: line });
    }

    // 2. 每段总结以其 floorStart 作为排序位置插入
    for (const s of summaries) {
      timeline.push({
        sortKey: s.floorStart,
        text: `========== 剧情摘要 F·${s.floorStart}–F·${s.floorEnd} ==========\n${s.summaryText}\n========== 摘要结束 ==========`,
      });
    }

    // 3. 按楼层升序排列，总结段在同楼层消息之前（sortKey 相同时总结排前面）
    timeline.sort((a, b) => a.sortKey - b.sortKey);

    const result = timeline.map(t => t.text).join('\n');
    console.group('%c[StageSend] 总结优先历史构建完成', 'color:#d4ff4d;font-weight:bold');
    console.log(`摘要段数: ${summaries.length}，覆盖楼层: ${coveredFloors.size}`);
    summaries.forEach(s => console.log(`  📚 F·${s.floorStart}–F·${s.floorEnd}: ${s.summaryText.slice(0,60)}…`));
    console.log('拼合结果预览（前300字）:', result.slice(0, 300));
    console.groupEnd();
    return result;
  }

  /* ═══════════════════════════════════════════════════════════
     3. API 调用与解析 
  ═══════════════════════════════════════════════════════════ */
  async function callStageApi(userText, theater, instructionIntro, instructionCore, instructionSuffix) {
    const db = await getDb();
    const mainConfig = await new Promise(res => {
      const tx = db.transaction('config', 'readonly');
      tx.objectStore('config').get('main_config').onsuccess = e => res(e.target.result);
    });

    if (!mainConfig || !mainConfig.api) throw new Error('API 配置丢失');
    const api = mainConfig.api;
    const cfg = api.activePreset && api.presets ? api.presets[api.activePreset] : api.temp;
    if (!cfg || !cfg.url) throw new Error('未配置 API 地址，请在设置中填写');

    const finalPrompts = await buildStageFinalPromptStream(theater, userText || EMPTY_NUDGE, instructionIntro, instructionCore, instructionSuffix);
    const systemPrompt = finalPrompts.join('\n\n---\n\n');
    const userPrompt = userText.trim() || EMPTY_NUDGE;

    let url = cfg.url.trim();
    if (!url.endsWith('/chat/completions')) {
      url += url.endsWith('/v1') ? '/chat/completions' : '/v1/chat/completions';
    }

    const payload = {
      model: cfg.model || 'gpt-4o',
      temperature: parseFloat(cfg.temp) || 1,
      max_tokens: parseInt(cfg.maxTokens) || 40000,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    };

    console.group('%c🚀 [StageSend] API 请求已发射', 'color: #ff9f43; font-weight: bold; font-size: 13px;');
    console.log('%c【请求地址】', 'color: #8a8a8e', url);
    console.log('%c【System Prompt】\n', 'color: #d4ff4d', systemPrompt);
    console.log('%c【User Input】', 'color: #5b7cfa', userPrompt);
    console.groupEnd();

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.key}` },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || '请求失败');
    const choice = data.choices[0];
    const rawText = choice.message.content;

    // ── 截断检测：finish_reason 为 length 说明 max_tokens 不够，内容被硬切 ──
    if (choice.finish_reason === 'length') {
      console.warn(
        '%c⚠️ [StageSend] 输出被截断！finish_reason = "length"，请在设置中提高 max_tokens（当前上限：' +
        payload.max_tokens + '）',
        'color:#ff6b6b;font-weight:bold;font-size:12px'
      );
    }

    console.group('%c📥 [StageSend] AI 原始返回文本', 'color: #fa5bd5; font-weight: bold; font-size: 13px;');
    console.log(rawText);
    console.groupEnd();

    return rawText;
  }

  function parseStageResponse(raw) {
    const lines = raw.split('\n');
    const results = [];
    const TAG_RE = /^\[(char|user|narrator)(?:\|([^\]]+))?\]\s*(.*)/i;
    let cur = null;

    lines.forEach(line => {
      const m = line.match(TAG_RE);
      if (m) {
        if (cur) results.push(cur);
        const roleType = m[1].toLowerCase();
        const name = m[2] ? m[2].trim() : roleType === 'narrator' ? '旁白' : '剧情';
        cur = { roleType, name, content: m[3].trim() };
      } else if (cur) {
        // 如果当前块还有内容，把下一行拼进去，保留真正的换行！
        cur.content += '\n' + line;
      }
    });
    if (cur) results.push(cur);
    return results;
  }

  /* ═══════════════════════════════════════════════════════════
     4. 渲染与手势核心逻辑
  ═══════════════════════════════════════════════════════════ */
  async function renderAndSaveStageMessage(msg, theater) {
    const isChar = msg.roleType === 'char';
    const isNarrator = msg.roleType === 'narrator';
    const isUser = msg.roleType === 'user';

    if (isUser) return;

    if (typeof getNextFloor !== 'function') return;

    const floor = await getNextFloor(theater.id);
    const db = await getDb();

    // 真正的换行符内容
    const fullContent = msg.content.trim();
    // 转换为含特殊 class 的 HTML 字符串（包括 <br>）
    const formattedHTML = formatStageText(fullContent);

    // 整体模式(_merged=true)：强制拼接所有角色名，头像用第一个
    // 分段模式：msg.name 是解析出的单个角色名，精确匹配对应角色的名字和头像
    var displayName = null;
    var resolvedCharId = null;
    var bubbleAvatar = null;

    if (isChar && typeof S !== 'undefined' && Array.isArray(S.chars) && S.chars.length > 0) {
      if (msg._merged) {
        // 整体模式：强制拼接所有角色名
        displayName = S.chars.map(function(c) { return c.name; }).filter(Boolean).join(' · ') || null;
        resolvedCharId = theater.charIds[0] || null;
        var fc = S.chars[0] || null;
        bubbleAvatar = (fc && fc.avatar) ? fc.avatar : null;
      } else {
        // 分段模式：按名字精确匹配对应角色
        var matchedChar = msg.name
          ? S.chars.find(function(c) { return c.name === msg.name; })
          : null;
        if (matchedChar) {
          displayName = matchedChar.name;
          resolvedCharId = matchedChar.id;
          bubbleAvatar = matchedChar.avatar || null;
        } else {
          // 名字对不上时兜底：用第一个
          var fc2 = S.chars[0] || null;
          displayName = fc2 ? fc2.name : (msg.name || null);
          resolvedCharId = theater.charIds[0] || null;
          bubbleAvatar = (fc2 && fc2.avatar) ? fc2.avatar : null;
        }
      }
    } else if (msg.name) {
      displayName = msg.name;
    }

    const stageMsg = {
      theaterId: theater.id,
      floor,
      type: 'text',
      isUser,
      isNarrator,
      content: '',
      charId: resolvedCharId,
      displayName,
      timestamp: Date.now(),
    };

    const bubbleName = displayName || msg.name || '—';

    let el;
    if (isNarrator && typeof window.buildNarratorBubble === 'function') {
      el = window.buildNarratorBubble(stageMsg);
    } else if (typeof window.buildBubble === 'function') {
      el = window.buildBubble(stageMsg, bubbleName, bubbleAvatar, isUser);
    }

    stageMsg.content = fullContent;
    const tx = db.transaction('theater_messages', 'readwrite');
    tx.objectStore('theater_messages').put(stageMsg);

    theater.updatedAt = Date.now();
    theater.lastFloor = floor;
    const tTx = db.transaction('theaters', 'readwrite');
    tTx.objectStore('theaters').put(theater);

    const area = document.getElementById('sArea');
    if (area && el) {
      area.querySelector('.s-empty')?.remove();
      area.appendChild(el);
      area.scrollTop = area.scrollHeight;

      const textContainer = isNarrator ? el.querySelector('.narrator-body') : el.querySelector('.msg-body');
      if (textContainer) {
        await typewriterHTML(textContainer, formattedHTML);
      } else {
        el.innerHTML += formattedHTML;
      }

      if (typeof window.updateFloor === 'function') window.updateFloor(floor);
    }
  }

  let _isSending = false;

  async function triggerStageSwipeSend() {
    if (_isSending) return;
    const theater = typeof S !== 'undefined' ? S.theater : null;
    if (!theater) return alert('未选择剧场');

    const isSegmented = await getRenderConfig();
    const inputField = document.getElementById('sField');
    const userText = inputField.value.trim();

    // 先把用户输入渲染上屏并存入 DB
    if (userText && typeof window.sendMsg === 'function') {
      await window.sendMsg();
    }

    _isSending = true;
    const btn = document.getElementById('sSend');
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i>';

    try {
      const intro  = isSegmented ? PROMPT_SEGMENTED_INTRO : PROMPT_MERGED_INTRO;
      const core   = isSegmented ? PROMPT_SEGMENTED_CORE  : PROMPT_MERGED_CORE;
      const suffix = isSegmented ? PROMPT_SEGMENTED_SUFFIX : PROMPT_MERGED_SUFFIX;
      const raw = await callStageApi(userText, theater, intro, core, suffix);

      if (isSegmented) {
        const parsed = parseStageResponse(raw);
        for (const m of parsed) {
          await renderAndSaveStageMessage(m, theater);
          await new Promise(r => setTimeout(r, 200));
        }
      } else {
        const cleanedText = raw.replace(/\[(char|narrator|user)\|?.*?\]/gi, '').trim();
        const mergedMsg = {
          roleType: 'char',
          name: S.chars[0] && S.chars[0].name || '剧情',
          content: cleanedText,
          _merged: true,
        };
        await renderAndSaveStageMessage(mergedMsg, theater);
      }
    } catch (e) {
      console.error('[StageSend] API 失败:', e);
    } finally {
      _isSending = false;
      btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i>';
    }
  }

  /* ═══════════════════════════════════════════════════════════
     5. 初始化 UI 与手势
  ═══════════════════════════════════════════════════════════ */
  function init() {
  initConfigUI();
  const btn = document.getElementById('sSend');
  if (!btn) return setTimeout(init, 500);

  // 拦截 tsukistage.html 中原有的 click → sendMsg 绑定
  // 用 capture 阶段的 stopImmediatePropagation 阻断，防止上滑后 click 事件穿透
  let _swipeJustFired = false;

  btn.addEventListener('click', e => {
    if (_swipeJustFired) {
      _swipeJustFired = false;
      e.stopImmediatePropagation();
      return;
    }
    // 普通点击：只存用户消息，不调 API
    if (typeof window.sendMsg === 'function') {
      window.sendMsg();
    }
  }, true); // capture = true，比 tsukistage.html 里的 click 监听先执行

  let startY = 0,
    currentDY = 0,
    isDragging = false;
  const getY = e => (e.type.includes('mouse') ? e.clientY : e.touches[0].clientY);

  btn.addEventListener('mousedown', e => {
    startY = getY(e);
    currentDY = 0;
    isDragging = true;
    btn.style.transition = 'none';
  });
  btn.addEventListener(
    'touchstart',
    e => {
      startY = getY(e);
      currentDY = 0;
      isDragging = true;
      btn.style.transition = 'none';
    },
    { passive: false },
  );

  document.addEventListener('mousemove', e => {
    if (!isDragging) return;
    const dy = getY(e) - startY;
    currentDY = dy;
    if (dy < -5) btn.style.transform = `translateY(${Math.max(dy, -80)}px)`;
  });

  document.addEventListener(
    'touchmove',
    e => {
      if (!isDragging) return;
      const dy = getY(e) - startY;
      currentDY = dy;
      if (dy < -5) {
        if (e.cancelable) e.preventDefault();
        btn.style.transform = `translateY(${Math.max(dy, -80)}px)`;
      }
    },
    { passive: false },
  );

  const endMouse = async () => {
    if (!isDragging) return;
    isDragging = false;
    btn.style.transition = '0.4s cubic-bezier(0.22,1,0.36,1)';
    if (currentDY < -SWIPE_THRESHOLD) {
      _swipeJustFired = true;
      btn.style.transform = 'translateY(-100px)';
      await triggerStageSwipeSend();
    }
    btn.style.transform = 'translateY(0)';
    currentDY = 0;
  };

  const endTouch = async e => {
    if (!isDragging) return;
    isDragging = false;
    btn.style.transition = '0.4s cubic-bezier(0.22,1,0.36,1)';
    if (currentDY < -SWIPE_THRESHOLD) {
      _swipeJustFired = true;
      // 阻止 touchend 之后浏览器自动触发的 click 事件
      e.preventDefault();
      btn.style.transform = 'translateY(-100px)';
      await triggerStageSwipeSend();
    }
    btn.style.transform = 'translateY(0)';
    currentDY = 0;
  };

  document.addEventListener('mouseup', endMouse);
  document.addEventListener('touchend', endTouch, { passive: false });
}

  init();

  /* ═══════════════════════════════════════════════════════════
     6. 动态附加：前置剧情记录 折叠/展开 交互
  ═══════════════════════════════════════════════════════════ */
  // 注入折叠交互需要的极简 CSS (增加指针、点击反馈和图标旋转动画)
  if (!document.getElementById('history-fold-style')) {
    const style = document.createElement('style');
    style.id = 'history-fold-style';
    style.textContent = `
      .history-tag { 
        cursor: pointer; 
        transition: opacity 0.3s ease, transform 0.1s ease; 
        user-select: none; 
      }
      .history-tag:active { transform: scale(0.98); }
      .history-tag i { transition: transform 0.3s ease; display: inline-block; }
    `;
    document.head.appendChild(style);
  }

  // 监听整个文档的点击事件（事件委托机制）
  document.addEventListener('click', function (e) {
    // 1. 检查点击的是否是 .history-tag 或其内部元素
    const tag = e.target.closest('.history-tag');
    if (!tag) return;

    // 2. 找到紧跟在 tag 后面的记录容器 .history-entries
    const entries = tag.nextElementSibling;
    if (!entries || !entries.classList.contains('history-entries')) return;

    // 3. 找到再后面的脚注容器 .history-foot (如果有)
    const foot = entries.nextElementSibling;
    const hasFoot = foot && foot.classList.contains('history-foot');

    // 4. 判断当前是否是折叠状态
    const isCollapsed = entries.style.display === 'none';
    const icon = tag.querySelector('i'); // 获取前面的小图标

    if (isCollapsed) {
      // 【执行展开】
      entries.style.display = '';
      if (hasFoot) foot.style.display = '';
      tag.style.opacity = '1';
      // 图标恢复原样
      if (icon) icon.style.transform = 'rotate(0deg)';
    } else {
      // 【执行折叠】
      entries.style.display = 'none';
      if (hasFoot) foot.style.display = 'none';
      tag.style.opacity = '0.6'; // 变灰暗，暗示被收起
      // 图标稍微旋转，提供视觉反馈
      if (icon) icon.style.transform = 'rotate(-90deg)';
    }
  });
})();
