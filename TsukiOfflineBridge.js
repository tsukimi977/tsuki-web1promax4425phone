/* ══════════════════════════════════════════════════════════════════════════
   TsukiOfflineBridge.js  v1.3
   ── 离线消息桥接 + 写入后立刻自动同步聊天记录到云端 ────────────────────────

   修复 v1.3：
     · 移除对 agent iframe 的依赖（agent.html 是独立页面，不是 iframe）
     · Bridge 直接内联执行完整的收件箱拉取 + IDB 写入逻辑
     · 写入完成后通过 BroadcastChannel 通知 agent 页面刷新，并立即同步云端
     · Bridge 处理完后在 sessionStorage 写标记，防止 agent 页面进入时重复处理
     · agent 页面进入时读标记，若 30s 内 Bridge 已处理则跳过自动 checkInbox

   功能：
     1. 进入页面 / 重新可见 / SW push 到达 → 拉取 cloud_offline_messages
     2. 直接在 Bridge 内完成写库（不再依赖 agent iframe）
     3. 写入完成后立刻把最新聊天记录同步到 agent_active_chars
     4. 在 index 页面弹出 toast + 收件徽章
     5. 把 inbox_refresh 广播给所有同域页面（agent 页面可刷新）

   使用方法（在 index.html </body> 前加一行）：
     <script src="TsukiOfflineBridge.js"></script>

   依赖：
     · 与 agent.html 共享同一域名下的 tsukiphonepromax IDB
     · sw.js 已在根 scope 注册（index.html 已处理）
══════════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  /* ─────────────────────────────────────────────────────────────
     0. 防重复挂载
  ───────────────────────────────────────────────────────────────*/
  if (window.__TSUKI_OFFLINE_BRIDGE__) return;
  window.__TSUKI_OFFLINE_BRIDGE__ = true;

  /* ─────────────────────────────────────────────────────────────
     1. 常量
  ───────────────────────────────────────────────────────────────*/
  const IDB_NAME          = 'tsukiphonepromax';
  const BADGE_AUTO_HIDE   = 6000;
  // Bridge 存活心跳：加载时写入，每 5s 刷新，unload 时清除
  // agent 检查此 key 判断 Bridge 是否活着，8s 内有效
  const BRIDGE_ALIVE_KEY  = '__tsuki_bridge_alive__';
  const BRIDGE_ALIVE_TTL  = 8000;
  // 处理完成标记（供 agent visibilitychange / init 检查，15s 有效）
  const BRIDGE_DONE_KEY   = '__tsuki_bridge_inbox_done__';
  const BRIDGE_DONE_TTL   = 15000;

  const SCHEMA = {
    config:    { keyPath: 'id' },
    chars:     { keyPath: 'id' },
    users:     { keyPath: 'id' },
    worldbook: null,
    chats:     { keyPath: 'id' },
    messages:  { keyPath: ['chatId', 'floor'] },
    agent:     { keyPath: 'id' },
  };

  // 合法消息类型白名单（对齐 agent.html）
  const VALID_MSG_TYPES = new Set([
    'text','voice','image','sticker','transfer','location','gift',
    'recalled','blocked','system','call',
    'video-接听','video-挂断','video-已取消','video-已结束',
    'voice-接听','voice-挂断','voice-已取消','voice-已结束',
  ]);

  /* ─────────────────────────────────────────────────────────────
     2. BroadcastChannel（与 agent.html 同频）
  ───────────────────────────────────────────────────────────────*/
  let bc;
  try { bc = new BroadcastChannel('tsuki_channel'); }
  catch (_) { bc = { onmessage: null, postMessage: () => {} }; }

  /* ─────────────────────────────────────────────────────────────
     3. IndexedDB helpers
  ───────────────────────────────────────────────────────────────*/
  let _idb = null;

  function _openDb() {
    if (_idb) return Promise.resolve(_idb);
    return new Promise((resolve, reject) => {
      const probe = indexedDB.open(IDB_NAME);
      probe.onsuccess = e => {
        const db = e.target.result;
        const missing = Object.keys(SCHEMA).filter(s => !db.objectStoreNames.contains(s));
        if (!missing.length) { _idb = db; resolve(_idb); return; }
        db.close();
        const up = indexedDB.open(IDB_NAME, db.version + 1);
        up.onupgradeneeded = ev => {
          const udb = ev.target.result;
          for (const [n, opt] of Object.entries(SCHEMA))
            if (!udb.objectStoreNames.contains(n))
              opt ? udb.createObjectStore(n, opt) : udb.createObjectStore(n);
        };
        up.onsuccess = ev => { _idb = ev.target.result; resolve(_idb); };
        up.onerror   = ev => reject(ev.target.error);
      };
      probe.onerror = e => reject(e.target.error);
    });
  }

  function _dbGet(store, key) {
    return _openDb().then(db => new Promise((res, rej) => {
      const req = db.transaction(store, 'readonly').objectStore(store).get(key);
      req.onsuccess = () => res(req.result);
      req.onerror   = () => rej(req.error);
    }));
  }

  function _dbGetAll(store) {
    return _openDb().then(db => new Promise((res, rej) => {
      const req = db.transaction(store, 'readonly').objectStore(store).getAll();
      req.onsuccess = () => res(req.result || []);
      req.onerror   = () => rej(req.error);
    }));
  }

  function _dbPut(store, value) {
    return _openDb().then(db => new Promise((res, rej) => {
      const req = db.transaction(store, 'readwrite').objectStore(store).put(value);
      req.onsuccess = () => res();
      req.onerror   = () => rej(req.error);
    }));
  }

  /* ─────────────────────────────────────────────────────────────
     4. 读 Supabase 配置（从 IDB agent_config）
  ───────────────────────────────────────────────────────────────*/
  let _cloudCfg = { supabaseUrl: '', supabaseKey: '' };

  async function _loadCloudCfg() {
    try {
      const rec = await _dbGet('agent', 'agent_config');
      if (rec) {
        _cloudCfg.supabaseUrl = rec.supabaseUrl || '';
        _cloudCfg.supabaseKey = rec.supabaseKey || '';
      }
    } catch (_) {}
  }

  /* ─────────────────────────────────────────────────────────────
     5. Supabase REST
  ───────────────────────────────────────────────────────────────*/
  function _sbFetch(path, method = 'GET', body = null) {
    if (!_cloudCfg.supabaseUrl || !_cloudCfg.supabaseKey)
      return Promise.reject(new Error('Supabase 未配置'));
    const url  = _cloudCfg.supabaseUrl.replace(/\/$/, '') + path;
    const opts = {
      method,
      headers: {
        'Content-Type':  'application/json',
        'apikey':        _cloudCfg.supabaseKey,
        'Authorization': 'Bearer ' + _cloudCfg.supabaseKey,
        'Prefer':        'return=representation',
      },
    };
    if (body) opts.body = JSON.stringify(body);
    return fetch(url, opts).then(async res => {
      if (method === 'DELETE' && res.ok) return null;
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 120)}`);
      return text ? JSON.parse(text) : null;
    });
  }

  /* ─────────────────────────────────────────────────────────────
     6. UI — Toast + 收件徽章
  ───────────────────────────────────────────────────────────────*/
  function _ensureStyles() {
    if (document.getElementById('__tb_css__')) return;
    const s = document.createElement('style');
    s.id = '__tb_css__';
    s.textContent = `
      #__tb_wrap__{position:fixed;bottom:28px;left:50%;transform:translateX(-50%);
        z-index:99999;display:flex;flex-direction:column;align-items:center;gap:6px;pointer-events:none;}
      .__tb_t__{display:flex;align-items:center;gap:8px;padding:9px 18px;border-radius:100px;
        font-family:'Geist Mono',ui-monospace,'SF Mono',Menlo,monospace;
        font-size:12px;font-weight:600;letter-spacing:0.02em;
        box-shadow:0 8px 28px rgba(0,0,0,0.22);pointer-events:none;white-space:nowrap;
        animation:__tb_in__ 0.32s cubic-bezier(0.175,0.885,0.32,1.275);}
      .__tb_t__.out{animation:__tb_out__ 0.26s ease forwards;}
      .__tb_t__.success{background:rgba(5,24,12,0.96);color:#43d9a0;border:1px solid rgba(67,217,160,0.3);}
      .__tb_t__.error  {background:rgba(26,5,5,0.96); color:#ff6b6b;border:1px solid rgba(255,107,107,0.3);}
      .__tb_t__.warn   {background:rgba(26,18,4,0.96);color:#f59e0b;border:1px solid rgba(245,158,11,0.3);}
      .__tb_t__.info   {background:rgba(5,10,26,0.96);color:#7a9cff;border:1px solid rgba(91,124,250,0.3);}
      .__tb_t__.sync   {background:rgba(5,5,24,0.96); color:#a78bfa;border:1px solid rgba(167,139,250,0.3);}
      @keyframes __tb_in__ {from{opacity:0;transform:translateY(10px) scale(0.93)}to{opacity:1;transform:none}}
      @keyframes __tb_out__{to{opacity:0;transform:translateY(6px) scale(0.96)}}
      #__tb_bdg__{position:fixed;top:72px;right:16px;z-index:99998;
        display:none;align-items:center;gap:6px;
        background:rgba(167,139,250,0.93);color:#fff;
        font-family:'Geist Mono',ui-monospace,monospace;font-size:10px;font-weight:700;
        padding:5px 13px 5px 10px;border-radius:100px;
        box-shadow:0 4px 18px rgba(167,139,250,0.45);cursor:pointer;user-select:none;
        animation:__tb_bdg_in__ 0.4s cubic-bezier(0.175,0.885,0.32,1.275);}
      #__tb_bdg__.show{display:flex;}
      #__tb_bdg__ span.c{background:rgba(255,255,255,0.28);border-radius:100px;padding:0 6px;font-size:9px;line-height:1.6;}
      @keyframes __tb_bdg_in__{from{opacity:0;transform:scale(0.65) translateY(-6px)}to{opacity:1;transform:none}}
    `;
    document.head.appendChild(s);
  }

  function _ensureDom() {
    _ensureStyles();
    if (!document.getElementById('__tb_wrap__')) {
      const w = document.createElement('div'); w.id = '__tb_wrap__';
      document.body.appendChild(w);
    }
    if (!document.getElementById('__tb_bdg__')) {
      const b = document.createElement('div'); b.id = '__tb_bdg__';
      b.innerHTML = `<span>📩 新离线消息</span><span class="c" id="__tb_cnt__">0</span>`;
      b.title = '点击跳转 Agent 页面';
      b.addEventListener('click', () => {
        b.classList.remove('show');
      });
      document.body.appendChild(b);
    }
  }

  let _toastTimer = null;
  function _showToast(msg, level = 'info') {
    _ensureDom();
    const wrap = document.getElementById('__tb_wrap__');
    // 清除所有已存在的 toast（防止堆积常驻）
    clearTimeout(_toastTimer);
    wrap.querySelectorAll('.__tb_t__').forEach(old => old.remove());
    const el = document.createElement('div');
    el.className = `__tb_t__ ${level}`;
    el.textContent = msg;
    wrap.appendChild(el);
    _toastTimer = setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 300);
    }, 4500);
  }

  let _badgeTimer = null;
  function _showBadge(count) {
    _ensureDom();
    const badge = document.getElementById('__tb_bdg__');
    const cnt   = document.getElementById('__tb_cnt__');
    if (!badge || !cnt) return;
    cnt.textContent = count;
    badge.classList.add('show');
    clearTimeout(_badgeTimer);
    _badgeTimer = setTimeout(() => badge.classList.remove('show'), BADGE_AUTO_HIDE);
  }

  /* ─────────────────────────────────────────────────────────────
     7. 广播刷新给同域其他页面
  ───────────────────────────────────────────────────────────────*/
  function _broadcastRefresh(count) {
    // 广播给 agent.html 等同域页面（通过 BroadcastChannel）
    try { bc.postMessage({ type: 'inbox_refresh', count, source: 'bridge' }); } catch (_) {}
    // 也转发给页面内的 iframe（如果有的话）
    document.querySelectorAll('iframe').forEach(f => {
      try { f.contentWindow.postMessage({ type: 'inbox_refresh', count, source: 'bridge' }, '*'); } catch (_) {}
    });
    // 触发 DIARY_STATUS_BANNER（如果有其他监听）
    try {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'DIARY_STATUS_BANNER', msg: `📩 收到 ${count} 条新离线消息`, level: 'success' },
        origin: location.origin,
      }));
    } catch (_) {}
  }

  /* ─────────────────────────────────────────────────────────────
     8. IDB 写入消息（对齐 agent.html dbWriteMessageTyped）
  ───────────────────────────────────────────────────────────────*/
  async function _dbWriteMessageTyped(chatId, content, type, charId, storyTimestamp) {
    const db = await _openDb();
    return new Promise((resolve, reject) => {
      const store = db.transaction('messages', 'readonly').objectStore('messages');
      const range = IDBKeyRange.bound([chatId, 0], [chatId, Infinity]);
      store.openCursor(range, 'prev').onsuccess = e => {
        const floor = e.target.result ? e.target.result.value.floor + 1 : 1;
        const tx2   = db.transaction(['messages', 'chats'], 'readwrite');
        const msgRecord = {
          id: `${chatId}_${floor}`, chatId, floor,
          senderRole: 'char', type: type || 'text', content,
          timestamp: Date.now(),
        };
        if (charId) msgRecord.charId = charId;
        if (storyTimestamp != null) msgRecord.storyTimestamp = storyTimestamp;
        tx2.objectStore('messages').put(msgRecord);

        // 更新 chat 预览
        const chatReq = tx2.objectStore('chats').get(chatId);
        chatReq.onsuccess = ev => {
          const chat = ev.target.result;
          if (chat) {
            let preview = '[新消息]';
            if (type === 'text' || type === 'system') {
              const s = typeof content === 'string' ? content : JSON.stringify(content);
              preview = s.length > 30 ? s.slice(0, 30) + '…' : s;
            } else if (type === 'sticker')  { preview = '[发送了一张表情包]'; }
            else if (type === 'image')      { preview = '[发送了一张图片]'; }
            else if (type === 'voice')      {
              const t = typeof content === 'object' ? content?.transcript : '';
              preview = t ? `[语音：${t.slice(0, 20)}…]` : '[发送了一条语音]';
            }
            chat.lastMessage = preview; chat.updatedAt = Date.now();
            tx2.objectStore('chats').put(chat);
          }
        };
        tx2.oncomplete = () => resolve();
        tx2.onerror   = () => reject(tx2.error);
      };
    });
  }

  /* ─────────────────────────────────────────────────────────────
     9. ★ 核心：直接在 Bridge 内拉取并写入离线消息
  ───────────────────────────────────────────────────────────────*/
  async function _processInbox() {
    await _loadCloudCfg();
    if (!_cloudCfg.supabaseUrl || !_cloudCfg.supabaseKey) return 0;

    let msgs;
    try {
      msgs = await _sbFetch('/rest/v1/cloud_offline_messages?order=created_at.asc');
    } catch (e) {
      console.warn('[TsukiBridge] 查收件箱失败:', e.message);
      return 0;
    }
    if (!msgs || !msgs.length) return 0;

    console.log(`[TsukiBridge] 发现 ${msgs.length} 条离线消息，处理中...`);

    let allChats = [], allChars = [];
    try { [allChars, allChats] = await Promise.all([_dbGetAll('chars'), _dbGetAll('chats')]); } catch (_) {}

    function _tryParse(v) { if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch { return v; } }

    let written = 0;
    for (const msg of msgs) {
      try {
        const chatId  = msg.chat_id || msg.char_id;
        const charId  = msg.char_id !== chatId ? msg.char_id : null;
        const charName = msg.char_name || '';
        const rawMsgType = msg.msg_type || 'text';
        const msgType    = VALID_MSG_TYPES.has(rawMsgType) ? rawMsgType : 'text';
        const storyTimestamp = msg.story_timestamp != null ? Number(msg.story_timestamp) : null;
        const chat = allChats.find(c => c.id === chatId);

        let content;
        const rc = msg.content;
        if (msgType === 'text' || msgType === 'recalled' || msgType === 'blocked' || msgType === 'system') {
          content = typeof rc === 'string' ? rc : String(rc || '');
        } else if (msgType === 'voice') {
          const p = _tryParse(rc); content = (typeof p === 'object' && p) ? { transcript: p.transcript || '' } : { transcript: typeof rc === 'string' ? rc : '' };
        } else if (msgType === 'image') {
          const p = _tryParse(rc); content = (typeof p === 'object' && p) ? { text: p.text || p.caption || p.description || '' } : { text: typeof rc === 'string' ? rc : '' };
        } else if (msgType === 'sticker') {
          const p = _tryParse(rc);
          if (typeof p === 'object' && p) { content = { name: p.name || '表情包', ...(p.url ? { url: p.url } : {}) }; }
          else if (typeof rc === 'string' && rc.includes('|')) { const i = rc.indexOf('|'); content = { name: rc.slice(0, i).trim(), url: rc.slice(i + 1).trim() }; }
          else { content = { name: typeof rc === 'string' ? rc : '表情包' }; }
        } else if (msgType === 'transfer') {
          const p = _tryParse(rc);
          if (typeof p === 'object' && p) { content = { amount: p.amount || '0.00', note: p.note || '' }; }
          else if (typeof rc === 'string' && rc.includes('|')) { const [a, ...np] = rc.split('|'); content = { amount: (a || '').trim(), note: np.join('|').trim() }; }
          else { content = { amount: typeof rc === 'string' ? rc : '0.00', note: '' }; }
        } else if (msgType === 'location') {
          const p = _tryParse(rc); content = (typeof p === 'object' && p) ? { location: p.location || p.text || '' } : { location: typeof rc === 'string' ? rc : '' };
        } else if (msgType === 'gift') {
          const p = _tryParse(rc);
          if (typeof p === 'object' && p) { content = { item: p.item || '', note: p.note || '' }; }
          else if (typeof rc === 'string' && rc.includes('|')) { const [it, ...np] = rc.split('|'); content = { item: (it || '').trim(), note: np.join('|').trim() }; }
          else { content = { item: typeof rc === 'string' ? rc : '', note: '' }; }
        } else {
          content = _tryParse(rc);
        }

        if (chat) {
          const resolvedCharId = charId || (allChars.find(c => c.name === charName)?.id) || null;
          await _dbWriteMessageTyped(chat.id, content, msgType, resolvedCharId, storyTimestamp);
          console.log(`[TsukiBridge] ✓ 写入 [${charName || chatId}|${msgType}] → ${chat.name || chatId}`);
        } else {
          console.warn(`[TsukiBridge] 找不到 chatId=${chatId}，跳过`);
        }
        await _sbFetch(`/rest/v1/cloud_offline_messages?id=eq.${msg.id}`, 'DELETE');
        written++;
      } catch (e) {
        console.warn('[TsukiBridge] 处理消息失败:', e.message);
      }
    }
    return written;
  }

  /* ─────────────────────────────────────────────────────────────
     10. ★ 核心：把最新聊天记录同步到云端 agent_active_chars
         完全对齐 agent.html syncSelectedCharsToCloud() 逻辑
  ───────────────────────────────────────────────────────────────*/
  let _syncCooldown = false;

  async function _syncToCloud() {
    if (_syncCooldown) return;
    _syncCooldown = true;
    setTimeout(() => { _syncCooldown = false; }, 10000);

    await _loadCloudCfg();
    if (!_cloudCfg.supabaseUrl || !_cloudCfg.supabaseKey) return;

    // ① 读选中聊天
    const agentRec        = await _dbGet('agent', 'agent_config').catch(() => null);
    const selectedChatIds = agentRec?.selectedChats || [];
    if (!selectedChatIds.length) {
      console.log('[TsukiBridge·Sync] 无选中聊天，跳过'); return;
    }

    // ② 读全量基础数据
    const [allChars, allChats, allUsers] = await Promise.all([
      _dbGetAll('chars'), _dbGetAll('chats'), _dbGetAll('users'),
    ]).catch(() => [[], [], []]);

    const chatsPayload = [];
    const chatInfos    = [];

    for (const chatId of selectedChatIds) {
      const chat = allChats.find(c => c.id === chatId);
      if (!chat) continue;

      // ── 角色 ─────────────────────────────────────────────────
      const chars = [];
      for (const cid of (chat.charIds || [])) {
        const char = allChars.find(c => c.id === cid);
        if (!char) continue;
        chars.push({
          id:        char.id,
          name:      char.name,
          remark:    char.remark   || '',
          persona:   char.persona  || '',
          bindId:    char.bindId   || '',
          avatar:    (char.avatar && !char.avatar.startsWith('data:')) ? char.avatar : '',
          worldbook: (char.worldbook || []).map(e => ({ ...e })),
        });
      }

      // ── 用户 ─────────────────────────────────────────────────
      const userIds = new Set();
      if (chat.userId) userIds.add(chat.userId);
      chars.forEach(c => { if (c.bindId) userIds.add(c.bindId); });
      const users = [];
      for (const uid of userIds) {
        const u = allUsers.find(x => x.id === uid)
                  || await _dbGet('users', uid).catch(() => null);
        if (u) users.push({ id: u.id, name: u.name, persona: u.persona || '' });
      }

      // ── 历史消息（最近 80 条，base64 剔除）──────────────────
      const db = await _openDb();
      const messages = await new Promise(res => {
        try {
          const req = db.transaction('messages', 'readonly')
                        .objectStore('messages').getAll();
          req.onsuccess = () => {
            const rows = (req.result || [])
              .filter(m => m.chatId === chatId)
              .sort((a, b) => a.floor - b.floor)
              .slice(-80)
              .map(m => {
                const raw = m.content, type = m.type || 'text';
                let c = '';
                if (typeof raw === 'string') {
                  c = raw;
                } else if (!raw) {
                  c = '';
                } else if (type === 'voice') {
                  c = raw.transcript || '';
                  if (raw.duration) c = `[语音 ${raw.duration}] ${c}`;
                } else if (type === 'image') {
                  const pts = [raw.caption, raw.text, raw.description].filter(Boolean);
                  c = pts.length ? pts.join(' ') : '[发送了一张图片]';
                } else if (type === 'camera') {
                  const n = Array.isArray(raw.urls) ? raw.urls.length : (raw.count || '多张');
                  c = `[发送了${n}张图片]${raw.caption ? ' ' + raw.caption : ''}`;
                } else if (type === 'sticker')  { c = `[表情包]${raw.name ? ' ' + raw.name : ''}`; }
                else if (type === 'transfer')   { c = `[转账 ¥${raw.amount || ''}]${raw.note ? ' ' + raw.note : ''}`; }
                else if (type === 'gift')        { c = `[礼物]${raw.name ? ' ' + raw.name : ''}`; }
                else if (type === 'location')    { c = `[位置]${raw.name || raw.address || ''}`; }
                else if (type === 'file')        { c = `[文件]${raw.name || ''}`; }
                else if (type === 'call')        { c = `[通话${raw.duration ? ' ' + raw.duration : ''}]`; }
                else if (type === 'recalled')    { c = '[消息已撤回]'; }
                else { c = raw.text || raw.transcript || raw.body || raw.content || '[消息]'; }
                return {
                  floor: m.floor, senderRole: m.senderRole,
                  charId: m.charId || '', charName: m.charName || '',
                  type, content: c,
                  timestamp: m.timestamp, storyTimestamp: m.storyTimestamp || null,
                };
              });
            res(rows);
          };
          req.onerror = () => res([]);
        } catch (_) { res([]); }
      });

      // ── 世界书 ───────────────────────────────────────────────
      const worldbooks = {};
      for (const k of ['wb_pre', 'wb_mid', 'wb_global', 'wb_post', 'wb_local']) {
        const d = await _dbGet('worldbook', k).catch(() => null);
        worldbooks[k] = Array.isArray(d) ? d : [];
      }

      // ── 聊天设置 & 剧情时钟 ──────────────────────────────────
      let chatSettings = {
        timestampEnabled: true, storyTimeEnabled: false,
        storyClockBaseDate: null, storyClockLastSyncStoryMs: null, storyClockLastSyncRealMs: null,
      };
      try {
        const cs = await _dbGet('config', `chat_settings_${chatId}`);
        if (cs) {
          chatSettings.timestampEnabled = cs.timestampEnabled !== false;
          chatSettings.storyTimeEnabled = cs.storyTimeEnabled === true;
        }
        if (chatSettings.storyTimeEnabled) {
          const clk = await _dbGet('config', `story_clock_${chatId}`);
          if (clk) {
            chatSettings.storyClockBaseDate        = clk.baseRealDate    || null;
            chatSettings.storyClockLastSyncStoryMs = clk.lastSyncStoryMs || null;
            chatSettings.storyClockLastSyncRealMs  = clk.lastSyncRealMs  || null;
          }
        }
      } catch (_) {}

      chatsPayload.push({
        chat: {
          id: chat.id, name: chat.name || '', type: chat.type || 'single',
          userId: chat.userId || '', charIds: chat.charIds || [],
          avatar: (chat.avatar && !chat.avatar.startsWith('data:')) ? chat.avatar : '',
        },
        chars, users, messages, worldbooks, chatSettings,
      });

      const fc = chars[0];
      chatInfos.push({
        chatId, name: fc?.name || chat.name || '未知',
        avatar: fc?.avatar || '', isGroup: chat.type === 'group',
      });
    }

    if (!chatsPayload.length) return;

    // ③ 上传
    try {
      await _sbFetch('/rest/v1/agent_active_chars?id=eq.1', 'PATCH', {
        chars_json: chatInfos, chats_payload: chatsPayload,
        updated_at: new Date().toISOString(),
      });
      const check = await _sbFetch('/rest/v1/agent_active_chars?id=eq.1');
      if (!check || !check.length) {
        await _sbFetch('/rest/v1/agent_active_chars', 'POST', {
          id: 1, chars_json: chatInfos, chats_payload: chatsPayload,
          updated_at: new Date().toISOString(),
        });
      }
      const totalMsgs = chatsPayload.reduce((s, c) => s + c.messages.length, 0);
      _showToast(`☁️ 已同步 ${chatsPayload.length} 个聊天（${totalMsgs} 条记录）`, 'sync');
      console.log(`[TsukiBridge·Sync] ✓ ${chatsPayload.length} 个聊天 / ${totalMsgs} 条消息`);
    } catch (e) {
      console.warn('[TsukiBridge·Sync] 同步失败:', e.message);
    }
  }

  /* ─────────────────────────────────────────────────────────────
     11. 主入口：拉取离线消息（进程内锁 + 跨页面原子锁）
     跨页面锁 key = __tsuki_inbox_owner__
       值：JSON { owner:'bridge'|'agent', ts:毫秒 }
       TTL：10s（防死锁）
       Bridge 抢到锁 → 正常写库；抢不到（agent 已持有）→ 直接跳过
  ───────────────────────────────────────────────────────────────*/
  const _XLOCK_KEY = '__tsuki_inbox_owner__';
  const _XLOCK_TTL = 10000;

  function _xLockTryAcquire() {
    try {
      const raw = localStorage.getItem(_XLOCK_KEY);
      if (raw) {
        const { ts } = JSON.parse(raw);
        if (Date.now() - ts < _XLOCK_TTL) return false; // 锁仍有效，抢不到
      }
      localStorage.setItem(_XLOCK_KEY, JSON.stringify({ owner: 'bridge', ts: Date.now() }));
      return true;
    } catch (_) { return true; } // localStorage 不可用时放行
  }

  function _xLockRelease() {
    try {
      const raw = localStorage.getItem(_XLOCK_KEY);
      if (raw && JSON.parse(raw).owner === 'bridge') localStorage.removeItem(_XLOCK_KEY);
    } catch (_) {}
  }

  let _inboxLock = false;

  async function pullInbox({ silent = false } = {}) {
    if (_inboxLock) return;          // 进程内快速拦截
    if (!_xLockTryAcquire()) {       // 跨页面锁：agent 正在写库则跳过
      console.log('[TsukiBridge] 跨页面锁被 agent 持有，跳过写库');
      return;
    }
    _inboxLock = true;
    try {
      await _loadCloudCfg();
      if (!_cloudCfg.supabaseUrl || !_cloudCfg.supabaseKey) return;

      const written = await _processInbox();
      if (written > 0) {
        _showBadge(written);
        if (!silent) _showToast(`✅ 收到 ${written} 条新离线消息`, 'success');
        try {
          const now = String(Date.now());
          localStorage.setItem(BRIDGE_DONE_KEY, now);
          sessionStorage.setItem(BRIDGE_DONE_KEY, now);
        } catch (_) {}
        _broadcastRefresh(written);
        _syncToCloud();
      }
    } finally {
      _inboxLock = false;
      _xLockRelease();
    }
  }

  /* ─────────────────────────────────────────────────────────────
     12. BroadcastChannel 监听（agent 写完后触发云端同步）
  ───────────────────────────────────────────────────────────────*/
  bc.onmessage = e => {
    const { type, count, source } = e.data || {};
    if (type !== 'inbox_refresh' || !count) return;
    if (source === 'bridge') return; // 自己广播的，忽略
    _syncToCloud();
  };

  /* ─────────────────────────────────────────────────────────────
     13. SW push 监听
  ───────────────────────────────────────────────────────────────*/
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', e => {
      const t = e.data?.type;
      if (t === 'offline_messages_ready' || t === 'sw_push_received') {
        console.log('[TsukiBridge] SW push 到达，Bridge 处理...');
        pullInbox();
      }
    });
  }

  /* ─────────────────────────────────────────────────────────────
     14. visibilitychange
  ───────────────────────────────────────────────────────────────*/
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) pullInbox({ silent: true });
  });

  /* ─────────────────────────────────────────────────────────────
     15. 页面就绪：写心跳 + 定时刷新 + unload 清除 + 初始拉取
     心跳让 agent 能可靠判断 Bridge 是否在线，无需依赖时序
  ───────────────────────────────────────────────────────────────*/
  (function _onReady(fn) {
    if (document.readyState === 'loading')
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    else fn();
  })(async () => {
    _ensureDom();
    await _loadCloudCfg();

    // ★ 立刻写心跳（同步），让 agent 一进来就能检测到 Bridge 存在
    try { localStorage.setItem(BRIDGE_ALIVE_KEY, String(Date.now())); } catch (_) {}
    // 每 5s 刷新心跳
    setInterval(() => {
      try { localStorage.setItem(BRIDGE_ALIVE_KEY, String(Date.now())); } catch (_) {}
    }, 5000);
    // 页面关闭时清除心跳
    window.addEventListener('pagehide', () => {
      try { localStorage.removeItem(BRIDGE_ALIVE_KEY); } catch (_) {}
    });

    setTimeout(() => pullInbox({ silent: true }), 1000);
  });

  /* ─────────────────────────────────────────────────────────────
     16. 公共 API
  ───────────────────────────────────────────────────────────────*/
  window.TsukiBridge = {
    pullInbox,
    syncToCloud:  _syncToCloud,
    showToast:    _showToast,
    showBadge:    _showBadge,
    reloadConfig: _loadCloudCfg,
    isAlive: () => {
      try {
        const t = parseInt(localStorage.getItem(BRIDGE_ALIVE_KEY) || '0', 10);
        return t > 0 && (Date.now() - t) < BRIDGE_ALIVE_TTL;
      } catch (_) { return false; }
    },
  };

  console.log('%c[TsukiBridge] ✅ v1.4 已挂载', 'color:#43d9a0;font-weight:600');

})();
