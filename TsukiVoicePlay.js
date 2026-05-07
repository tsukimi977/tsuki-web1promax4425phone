/**
 * TsukiVoicePlay.js
 * ─────────────────────────────────────────────────────────────────────────────
 * 聊天页语音条 TTS 播放桥接脚本
 * 依赖：window.openDb()（由 db-schema.js 挂载）、window.currentChatId
 * 引入方式：在 tsukiphone1_1.html 底部 <script src="TsukiVoicePlay.js"></script>
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * 工作流程：
 *  1. 页面加载时读取 voice_tts 中的 tts_chat_settings，检查开关是否开启
 *  2. 劫持 window.toggleVoice，在原有 UI 动画基础上注入 TTS 逻辑
 *  3. 点击语音条时：
 *     - 取 .msg-row[data-floor] → floor
 *     - 查 messages[chatId, floor] → senderRole / transcript / charId? / charName?
 *     - 查 chats[chatId] → type / charIds / userId
 *     - 单聊 char：用 chat.charIds[0] 匹配预设
 *     - 单聊 user：用 chat.userId 匹配预设，无绑定则跳过
 *     - 群聊 char：① msg.charId 直查 → ② msg.charName 反查 _groupMembersMap
 *                  → ③ charName 遍历 chars 表兜底（map 未加载时）
 *     - 群聊 user：同单聊 user 逻辑
 *     - 查缓存 audio_cache_{chatId}_{floor}（LRU 限量）
 *     - 未命中 → 读 tts_api_config → 调用 MiniMax API → 存缓存 → 播放
 *     - 命中 → 直接播放
 */

(function () {
  'use strict';

  /* ══════════════════════════════════════════════
     常量
  ══════════════════════════════════════════════ */
  const TTS_STORE   = 'voice_tts';
  const CACHE_KEY   = 'tts_audio_cache_index'; // 存缓存索引（LRU 列表）的 key
  const AUDIO_PFX   = 'audio_cache_';          // 单条缓存 key 前缀
  const CFG_KEY     = 'tts_chat_settings';      // 开关+限量配置的 key
  const API_CFG_KEY = 'tts_api_config';

  /* ══════════════════════════════════════════════
     DB 工具（轻量封装，不依赖 minimax.html 的变量）
  ══════════════════════════════════════════════ */
  function dbGet(store, key) {
    return window.openDb().then(db => new Promise((res, rej) => {
      const q = db.transaction(store, 'readonly').objectStore(store).get(key);
      q.onsuccess = e => res(e.target.result || null);
      q.onerror   = e => rej(e.target.error);
    }));
  }
  function dbPut(store, obj) {
    return window.openDb().then(db => new Promise((res, rej) => {
      const q = db.transaction(store, 'readwrite').objectStore(store).put(obj);
      q.onsuccess = () => res();
      q.onerror   = e => rej(e.target.error);
    }));
  }
  function dbDel(store, key) {
    return window.openDb().then(db => new Promise((res, rej) => {
      const q = db.transaction(store, 'readwrite').objectStore(store).delete(key);
      q.onsuccess = () => res();
      q.onerror   = e => rej(e.target.error);
    }));
  }
  function dbGetAll(store) {
    return window.openDb().then(db => new Promise((res, rej) => {
      const q = db.transaction(store, 'readonly').objectStore(store).getAll();
      q.onsuccess = e => res(e.target.result || []);
      q.onerror   = e => rej(e.target.error);
    }));
  }

  /** 从 messages 表按复合主键 [chatId, floor] 读一条消息 */
  function dbGetMsg(chatId, floor) {
    return window.openDb().then(db => new Promise((res, rej) => {
      const q = db.transaction('messages', 'readonly')
                   .objectStore('messages')
                   .get([chatId, floor]);
      q.onsuccess = e => res(e.target.result || null);
      q.onerror   = e => rej(e.target.error);
    }));
  }

  /* ══════════════════════════════════════════════
     hex → ArrayBuffer（与 minimax.html 相同的 h2ab）
  ══════════════════════════════════════════════ */
  function hexToArrayBuffer(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
    }
    return bytes.buffer;
  }

  /* ══════════════════════════════════════════════
     LRU 缓存管理
  ══════════════════════════════════════════════ */

  /**
   * 读取缓存音频（hex 字符串），并将该 key 移到 LRU 队列头部
   * @returns {string|null} hex 字符串，或 null
   */
  async function cacheGet(cacheKey) {
    const record = await dbGet(TTS_STORE, cacheKey);
    if (!record) return null;

    // 移到 LRU 队列头部（表示最近使用）
    const idx = (await dbGet(TTS_STORE, CACHE_KEY)) || { id: CACHE_KEY, keys: [] };
    const pos = idx.keys.indexOf(cacheKey);
    if (pos !== -1) idx.keys.splice(pos, 1);
    idx.keys.unshift(cacheKey);
    await dbPut(TTS_STORE, idx);

    return record.hex || null;
  }

  /**
   * 写入缓存音频，并按 maxCount 做 LRU 淘汰
   * @param {string} cacheKey
   * @param {string} hex
   * @param {number} maxCount  0 = 无限
   */
  async function cacheSet(cacheKey, hex, maxCount) {
    // 写入音频数据
    await dbPut(TTS_STORE, { id: cacheKey, hex });

    // 更新 LRU 索引
    const idx = (await dbGet(TTS_STORE, CACHE_KEY)) || { id: CACHE_KEY, keys: [] };
    const pos = idx.keys.indexOf(cacheKey);
    if (pos !== -1) idx.keys.splice(pos, 1);
    idx.keys.unshift(cacheKey); // 放队列头

    // LRU 淘汰
    if (maxCount > 0) {
      while (idx.keys.length > maxCount) {
        const evict = idx.keys.pop();
        await dbDel(TTS_STORE, evict);
        console.log('[VoicePlay] 缓存淘汰:', evict);
      }
    }

    await dbPut(TTS_STORE, idx);
  }

  /* ══════════════════════════════════════════════
     读取全局设置
  ══════════════════════════════════════════════ */
  async function loadSettings() {
    const s = await dbGet(TTS_STORE, CFG_KEY);
    return {
      enabled:  s?.enabled  ?? false,
      maxCache: s?.maxCache ?? 20,   // 0 = 无限
    };
  }

  /* ══════════════════════════════════════════════
     群聊角色 charId 解析
     优先级：msg.charId → _groupMembersMap(charName) → chars表(charName)
  ══════════════════════════════════════════════ */
  async function resolveGroupCharId(msg, chat) {
    // ① 消息上直接有 charId（新消息写入时已补全）
    if (msg.charId) return msg.charId;

    // ② 用 charName 反查内存中的 _groupMembersMap
    if (msg.charName) {
      const map = window._groupMembersMap || {};
      const found = Object.values(map).find(m => m.name === msg.charName);
      if (found) return found.id;

      // ③ map 可能还未加载（用户直接从历史页进来），遍历 chars 表兜底
      if (chat.charIds?.length) {
        const members = await Promise.all(chat.charIds.map(cid => dbGet('chars', cid)));
        const matched = members.find(m => m && m.name === msg.charName);
        if (matched) return matched.id;
      }
    }

    return null; // 无法解析
  }

  /* ══════════════════════════════════════════════
     匹配预设：返回音色参数 snap 或 null
     role: 'char' | 'user'
     charId: 已解析的角色 id（群聊经 resolveGroupCharId 处理）
     userId: chats 表中的 userId
  ══════════════════════════════════════════════ */
  async function findPreset(role, charId, userId) {
    const allPresets = await dbGetAll(TTS_STORE);

    if (role === 'char') {
      if (!charId) return null;
      const match = allPresets.find(p => p.charId && p.charId === charId);
      if (match?.char) return match.char;
      return null;
    }

    if (role === 'user') {
      // 用户必须有预设绑定才处理，否则静默跳过
      const match = allPresets.find(p => p.includeUser && p.userId === userId);
      if (match?.user) return match.user;
      return null;
    }

    return null;
  }

  /* ══════════════════════════════════════════════
     调用 MiniMax TTS API
     返回 hex string 或 抛错
  ══════════════════════════════════════════════ */
  async function callTtsApi(text, snap) {
    const cfg = await dbGet(TTS_STORE, API_CFG_KEY);
    if (!cfg || !cfg.apiKey || !cfg.groupId) {
      throw new Error('未配置 MiniMax API Key / Group ID，请前往语音配置页保存');
    }

    const endpoint = cfg.endpoint || 'https://api.minimax.chat/v1/t2a_v2';
    const langMap = { zh: 'Chinese', en: 'English', ja: 'Japanese', yue: 'Cantonese' };

    const body = {
      model: snap.model || 'speech-01-turbo',
      text,
      stream: false,
      voice_setting: {
        voice_id: snap.voiceId,
        speed:    snap.speed   ?? 1.0,
        vol:      snap.vol     ?? 1,
        pitch:    snap.pitch   ?? 0,
      },
      audio_setting: {
        sample_rate: snap.sampleRate || 32000,
        bitrate:     snap.bitrate    || 128000,
        format:      snap.format     || 'mp3',
        channel:     1,
      },
    };

    if (snap.voiceLang && langMap[snap.voiceLang]) {
      body.language_boost = langMap[snap.voiceLang];
    }

    const res = await fetch(`${endpoint}?GroupId=${cfg.groupId}`, {
      method:  'POST',
      headers: {
        'Authorization': 'Bearer ' + cfg.apiKey,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    if (!res.ok || data.base_resp?.status_code !== 0) {
      throw new Error(data.base_resp?.status_msg || data.message || 'HTTP ' + res.status);
    }

    const hex = data.data?.audio;
    if (!hex) throw new Error('响应中未找到音频数据');
    return hex;
  }

  /* ══════════════════════════════════════════════
     播放 hex 音频
  ══════════════════════════════════════════════ */

  // 全局当前播放的 Audio 实例，保证同一时间只播一条
  let _currentAudio = null;
  let _currentBubble = null;

  function playHex(hex, format, bubble) {
    // 停止上一条
    if (_currentAudio) {
      _currentAudio.pause();
      _currentAudio = null;
    }
    if (_currentBubble && _currentBubble !== bubble) {
      _currentBubble.classList.remove('playing');
      clearTimeout(_currentBubble._t);
    }

    const mimeMap = { mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac', pcm: 'audio/x-raw' };
    const mime    = mimeMap[format] || 'audio/mpeg';
    const blob    = new Blob([hexToArrayBuffer(hex)], { type: mime });
    const url     = URL.createObjectURL(blob);
    const audio   = new Audio(url);

    _currentAudio  = audio;
    _currentBubble = bubble;

    audio.play().catch(e => console.warn('[VoicePlay] 播放失败:', e));

    // 播放结束后移除 playing 状态
    audio.addEventListener('ended', () => {
      bubble.classList.remove('playing');
      URL.revokeObjectURL(url);
      if (_currentAudio === audio) _currentAudio = null;
      if (_currentBubble === bubble) _currentBubble = null;
    });

    // 保底：按 duration 数据超时移除 playing（以防 ended 不触发）
    clearTimeout(bubble._t);
    const durSec = parseDuration(bubble.dataset.duration);
    bubble._t = setTimeout(() => {
      bubble.classList.remove('playing');
    }, (durSec + 2) * 1000);
  }

  function parseDuration(str) {
    if (!str) return 5;
    const parts = str.split(':');
    return (parseInt(parts[0]) || 0) * 60 + (parseInt(parts[1]) || 0);
  }

  /* ══════════════════════════════════════════════
     显示气泡上的加载状态
  ══════════════════════════════════════════════ */
  function setBubbleLoading(bubble, loading) {
    const playIcon = bubble.querySelector('.voice-play i');
    if (!playIcon) return;
    if (loading) {
      playIcon.dataset.origClass = playIcon.className;
      playIcon.className = 'fa-solid fa-spinner fa-spin';
    } else {
      playIcon.className = playIcon.dataset.origClass || 'fa-solid fa-play';
    }
  }

  /* ══════════════════════════════════════════════
     核心：语音条点击处理
  ══════════════════════════════════════════════ */
  async function handleVoiceClick(bubble) {
    // ── 1. 读设置 ──
    const settings = await loadSettings();
    if (!settings.enabled) return; // 开关关闭，不处理

    // ── 2. 定位 floor ──
    const row   = bubble.closest('.msg-row');
    const floor = row ? parseInt(row.dataset.floor) : NaN;
    if (!row || isNaN(floor)) {
      console.warn('[VoicePlay] 无法读取楼层号，跳过');
      return;
    }

    const chatId = window.currentChatId;
    if (!chatId) {
      console.warn('[VoicePlay] currentChatId 为空，跳过');
      return;
    }

    // ── 3. 读消息 ──
    const msg = await dbGetMsg(chatId, floor);
    if (!msg || msg.type !== 'voice') {
      console.warn('[VoicePlay] 消息不是 voice 类型，跳过');
      return;
    }

    const transcript = msg.content?.transcript || '';
    if (!transcript.trim()) {
      console.warn('[VoicePlay] 语音转写文本为空，无法 TTS，跳过');
      return;
    }

    const senderRole = msg.senderRole; // 'char' | 'user'

    // ── 4. 读聊天信息 ──
    const chat = await dbGet('chats', chatId);
    if (!chat) return;

    const isGroup = chat.type === 'group';
    const userId  = chat.userId || null;

    // ── 5. 解析角色 charId ──
    let charId = null;
    if (senderRole === 'char') {
      if (isGroup) {
        // 群聊：三级回退解析
        charId = await resolveGroupCharId(msg, chat);
        if (!charId) {
          console.log('[VoicePlay] 群聊角色 charId 无法解析（消息无 charId/charName），跳过');
          return;
        }
      } else {
        // 单聊：直接取唯一角色
        charId = chat.charIds?.[0] || null;
      }
    }

    // ── 6. 匹配预设 ──
    const snap = await findPreset(senderRole, charId, userId);
    if (!snap) {
      console.log('[VoicePlay] 未找到对应预设（或用户未绑定音色），跳过');
      return;
    }
    if (!snap.voiceId) {
      console.log('[VoicePlay] 预设中 voiceId 为空，跳过');
      return;
    }

    // ── 7. 查缓存 ──
    const cacheKey = `${AUDIO_PFX}${chatId}_${floor}`;
    let hex = await cacheGet(cacheKey);

    if (hex) {
      console.log('[VoicePlay] 命中缓存，直接播放:', cacheKey);
      playHex(hex, snap.format || 'mp3', bubble);
      return;
    }

    // ── 8. 调用 API ──
    setBubbleLoading(bubble, true);
    try {
      console.log('[VoicePlay] 调用 TTS API，角色:', senderRole, '音色:', snap.voiceId);
      hex = await callTtsApi(transcript, snap);

      // 写缓存
      await cacheSet(cacheKey, hex, settings.maxCache);
      console.log('[VoicePlay] 缓存写入成功:', cacheKey, '当前限量:', settings.maxCache || '无限');

      // 播放
      playHex(hex, snap.format || 'mp3', bubble);
    } catch (err) {
      console.error('[VoicePlay] TTS 调用失败:', err.message);
      // 在气泡上短暂显示错误提示
      showBubbleTip(bubble, '语音生成失败：' + err.message);
    } finally {
      setBubbleLoading(bubble, false);
    }
  }

  /* ══════════════════════════════════════════════
     气泡上的短暂提示
  ══════════════════════════════════════════════ */
  function showBubbleTip(bubble, msg) {
    let tip = bubble.querySelector('._vp_tip');
    if (!tip) {
      tip = document.createElement('div');
      tip._vp_tip = true;
      tip.className = '_vp_tip';
      tip.style.cssText = [
        'position:absolute', 'bottom:calc(100% + 6px)', 'left:50%',
        'transform:translateX(-50%)', 'white-space:nowrap',
        'background:rgba(0,0,0,.75)', 'color:#fff', 'font-size:11px',
        'padding:4px 10px', 'border-radius:4px', 'pointer-events:none',
        'z-index:999', 'max-width:220px', 'text-overflow:ellipsis', 'overflow:hidden',
      ].join(';');
      // 气泡需要 position:relative 才能定位
      const origPos = getComputedStyle(bubble).position;
      if (origPos === 'static') bubble.style.position = 'relative';
      bubble.appendChild(tip);
    }
    tip.textContent = msg;
    tip.style.display = 'block';
    clearTimeout(tip._hideT);
    tip._hideT = setTimeout(() => { tip.style.display = 'none'; }, 3500);
  }

  /* ══════════════════════════════════════════════
     劫持 toggleVoice
  ══════════════════════════════════════════════ */
  function installHook() {
    const _orig = window.toggleVoice;

    window.toggleVoice = function (el) {
      // 判断本次点击是否命中 .voice-play 播放按钮（或其内部子元素）
      const clickedTarget = window.event && window.event.target;
      const isPlayBtn = clickedTarget && !!clickedTarget.closest('.voice-play');

      if (isPlayBtn) {
        // ── 点击的是播放按钮：走完整流程（UI + TTS）──

        // 先执行原有 UI 动画（playing / expanded class 切换）
        if (typeof _orig === 'function') _orig.call(this, el);

        // 再注入 TTS 逻辑（仅当气泡变为 playing 时触发，避免暂停时重复调用）
        if (el.classList.contains('playing')) {
          handleVoiceClick(el).catch(e => console.error('[VoicePlay]', e));
        } else {
          // 用户点击暂停：停止当前播放
          if (_currentAudio && _currentBubble === el) {
            _currentAudio.pause();
            _currentAudio = null;
            _currentBubble = null;
          }
        }
      } else {
        // ── 点击的是音浪、时长或气泡其他区域：只做 UI 展开/折叠，不触发 TTS ──
        if (typeof _orig === 'function') _orig.call(this, el);
        console.log('[VoicePlay] 点击非播放按钮区域，仅展开气泡，跳过 TTS');
      }
    };

    console.log('[VoicePlay] toggleVoice 已接管');
  }

  /* ══════════════════════════════════════════════
     等待 openDb 就绪后安装钩子
  ══════════════════════════════════════════════ */
  async function init() {
    // 等待 tsukiDbReady（db-schema.js 挂载的 Promise）
    if (window.tsukiDbReady) {
      await window.tsukiDbReady;
    } else {
      // 兜底：轮询等待 openDb 可用
      await new Promise(res => {
        const t = setInterval(() => {
          if (typeof window.openDb === 'function') { clearInterval(t); res(); }
        }, 50);
      });
    }

    installHook();
    console.log('[VoicePlay] 初始化完成，等待用户点击语音条');
  }

  // 确保 DOM 加载完成后再执行
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => init().catch(console.error));
  } else {
    init().catch(console.error);
  }

  /* ══════════════════════════════════════════════
     对外暴露（供调试 / minimax 页面调用）
  ══════════════════════════════════════════════ */
  window.TsukiVoicePlay = {
    /** 手动刷新设置缓存（minimax 页保存设置后可调用，跨页面无效，仅供调试） */
    reloadSettings: loadSettings,
    /** 清空所有语音缓存 */
    clearCache: async () => {
      const idx = await dbGet(TTS_STORE, CACHE_KEY);
      if (idx?.keys) {
        for (const k of idx.keys) await dbDel(TTS_STORE, k);
      }
      await dbDel(TTS_STORE, CACHE_KEY);
      console.log('[VoicePlay] 缓存已全部清除');
    },
  };

})();
