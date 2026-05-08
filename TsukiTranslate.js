/**
 * TsukiTranslate.js
 * 气泡翻译功能模块 · 点击头像展开翻译条
 * ─────────────────────────────────────────
 * 使用 Google Translate 免费 API（需 VPN）
 * 挂载方式：在 tsukiphone1_1.html 末尾引入
 *   <script src="TsukiTranslate.js"></script>
 */

(function () {
  'use strict';

  /* ═══════════════════════════════════════
     常量 & 默认配置
  ═══════════════════════════════════════ */

  const STORAGE_KEY = 'tsuki_translate_cfg';

  const LANG_OPTIONS = [
    { code: 'zh-CN', label: '中文' },
    { code: 'en',    label: '英语' },
    { code: 'fr',    label: '法语' },
    { code: 'ja',    label: '日语' },
    { code: 'ko',    label: '韩语' },
    { code: 'ru',    label: '俄语' },
    { code: 'es',    label: '西班牙语' },
  ];

  const DEFAULT_CFG = {
    enabled: false,       // 翻译总开关
    mode: 'auto',         // 'fixed' | 'auto'
    fixedSrc: 'ja',       // 固定模式源语种
    fixedDst: 'zh-CN',    // 固定模式目标语种
    autoRules: [          // 自动模式规则列表
      { from: 'en',    to: 'zh-CN' },
      { from: 'zh-CN', to: 'ja'    },
      { from: 'ja',    to: 'zh-CN' },
    ],
    inputEnabled: false,  // 输入翻译开关
    inputSrc: 'zh-CN',    // 输入翻译源语种
    inputDst: 'ja',       // 输入翻译目标语种
  };

  /* ═══════════════════════════════════════
     配置持久化
  ═══════════════════════════════════════ */

  function loadCfg() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return Object.assign({}, DEFAULT_CFG, { autoRules: DEFAULT_CFG.autoRules.map(r => Object.assign({}, r)) });
      const saved = JSON.parse(raw);
      return Object.assign({}, DEFAULT_CFG, saved);
    } catch (e) {
      return Object.assign({}, DEFAULT_CFG);
    }
  }

  function saveCfg(cfg) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  }

  let cfg = loadCfg();

  /* ═══════════════════════════════════════
     Google Translate API 调用
  ═══════════════════════════════════════ */

  /**
   * 调用 Google 免费翻译接口
   * ⚠️ 注意：此接口非官方，需要 VPN 才能访问 translate.googleapis.com
   * @param {string} text   - 原文
   * @param {string} target - 目标语种代码（如 'zh-CN', 'ja'）
   * @param {string} source - 源语种代码，'auto' 表示自动识别
   * @returns {Promise<{text: string, detectedLang: string}>}
   */
  async function googleTranslate(text, target, source = 'auto') {
    const sl = source === 'auto' ? 'auto' : source;
    const tl = target;
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(sl)}&tl=${encodeURIComponent(tl)}&dt=t&dt=ld&q=${encodeURIComponent(text)}`;

    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();

    // data[0] 是翻译结果数组
    const translated = (data[0] || [])
      .filter(seg => seg && seg[0])
      .map(seg => seg[0])
      .join('');

    // data[8][0][0] 是检测到的语种（不一定存在）
    let detectedLang = sl;
    try {
      if (data[8] && data[8][0] && data[8][0][0]) {
        detectedLang = data[8][0][0];
      } else if (data[2]) {
        detectedLang = data[2];
      }
    } catch (_) {}

    return { text: translated, detectedLang };
  }

  /* ═══════════════════════════════════════
     工具函数
  ═══════════════════════════════════════ */

  function langLabel(code) {
    const found = LANG_OPTIONS.find(l => l.code === code);
    return found ? found.label : code;
  }

  /** 从气泡 DOM 提取可翻译的纯文本 */
  function extractBubbleText(bubbleEl) {
    // 去掉引用块、bubble-meta 等噪声节点
    const clone = bubbleEl.cloneNode(true);
    clone.querySelectorAll('.msg-quote, .bubble-blocked-badge').forEach(n => n.remove());
    return (clone.innerText || clone.textContent || '').trim();
  }

  /* ═══════════════════════════════════════
     翻译条 DOM 渲染
  ═══════════════════════════════════════ */

  /**
   * 在 bubble-wrap 下方插入/更新翻译条
   * @param {HTMLElement} bubbleWrap  - 目标 .bubble-wrap
   * @param {boolean}     isUser      - 是否为用户气泡
   * @param {string}      state       - 'loading' | 'result' | 'error'
   * @param {object}      payload     - { text?, detectedLang?, targetLang?, errorMsg? }
   */
  function upsertTranslateBar(bubbleWrap, isUser, state, payload = {}) {
    let bar = bubbleWrap.querySelector('.tt-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'tt-bar ' + (isUser ? 'tt-bar-user' : 'tt-bar-char');
      bubbleWrap.appendChild(bar);
    }

    if (state === 'loading') {
      bar.innerHTML = `
        <div class="tt-inner">
          <div class="tt-label">
            <i class="fa-solid fa-language tt-icon"></i>
            <span class="tt-label-text">TRANSLATE</span>
          </div>
          <div class="tt-content tt-loading">
            <span class="tt-dot"></span><span class="tt-dot"></span><span class="tt-dot"></span>
          </div>
        </div>`;
      return;
    }

    if (state === 'error') {
      bar.innerHTML = `
        <div class="tt-inner">
          <div class="tt-label">
            <i class="fa-solid fa-language tt-icon"></i>
            <span class="tt-label-text">TRANSLATE</span>
            <span class="tt-close" title="关闭">✕</span>
          </div>
          <div class="tt-content tt-error">
            <i class="fa-solid fa-triangle-exclamation"></i>
            ${payload.errorMsg || '翻译失败，请检查 VPN 连接'}
          </div>
        </div>`;
      bar.querySelector('.tt-close').addEventListener('click', () => removeTranslateBar(bubbleWrap));
      return;
    }

    if (state === 'result') {
      const fromLabel = langLabel(payload.detectedLang || '?');
      const toLabel   = langLabel(payload.targetLang   || '?');
      bar.innerHTML = `
        <div class="tt-inner">
          <div class="tt-label">
            <i class="fa-solid fa-language tt-icon"></i>
            <span class="tt-label-text">TRANSLATE</span>
            <span class="tt-lang-badge">${fromLabel} → ${toLabel}</span>
            <span class="tt-close" title="关闭">✕</span>
          </div>
          <div class="tt-content">${escapeHtml(payload.text || '')}</div>
          <div class="tt-ornament-line"></div>
        </div>`;
      bar.querySelector('.tt-close').addEventListener('click', () => removeTranslateBar(bubbleWrap));
    }
  }

  function removeTranslateBar(bubbleWrap) {
    const bar = bubbleWrap.querySelector('.tt-bar');
    if (bar) {
      bar.classList.add('tt-bar-hide');
      setTimeout(() => bar.remove(), 280);
    }
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');
  }

  /* ═══════════════════════════════════════
     核心：点击头像触发翻译
  ═══════════════════════════════════════ */

  async function handleAvatarClick(avatarEl) {
    if (!cfg.enabled) return;

    const msgRow   = avatarEl.closest('.msg-row');
    if (!msgRow) return;

    const isUser    = msgRow.classList.contains('user');
    const bubbleWrap = msgRow.querySelector('.bubble-wrap');
    if (!bubbleWrap) return;

    const bubble = bubbleWrap.querySelector('.bubble');
    if (!bubble) return;

    // 如果已有翻译条，点击再次则关闭（toggle）
    const existingBar = bubbleWrap.querySelector('.tt-bar');
    if (existingBar) {
      removeTranslateBar(bubbleWrap);
      return;
    }

    const rawText = extractBubbleText(bubble);
    if (!rawText) return;

    upsertTranslateBar(bubbleWrap, isUser, 'loading');

    try {
      let translatedText, detectedLang, targetLang;

      if (cfg.mode === 'fixed') {
        // 固定模式：统一视为 fixedSrc → fixedDst
        const res = await googleTranslate(rawText, cfg.fixedDst, cfg.fixedSrc);
        translatedText = res.text;
        detectedLang   = cfg.fixedSrc;
        targetLang     = cfg.fixedDst;

      } else {
        // 自动模式：先 auto 识别语种，再匹配规则
        const detect = await googleTranslate(rawText, 'zh-CN', 'auto');
        detectedLang  = detect.detectedLang || 'und';

        // 标准化：google 返回 'zh-CN' 或 'zh'，统一处理
        const normLang = normalizeLang(detectedLang);

        // 找到匹配规则
        const rule = cfg.autoRules.find(r => normalizeLang(r.from) === normLang);
        if (!rule) {
          upsertTranslateBar(bubbleWrap, isUser, 'error', {
            errorMsg: `未配置 ${langLabel(detectedLang)} 的翻译规则`,
          });
          return;
        }

        targetLang = rule.to;
        const res = await googleTranslate(rawText, targetLang, detectedLang);
        translatedText = res.text;
      }

      upsertTranslateBar(bubbleWrap, isUser, 'result', {
        text: translatedText,
        detectedLang,
        targetLang,
      });

    } catch (err) {
      console.error('[TsukiTranslate] 翻译出错:', err);
      upsertTranslateBar(bubbleWrap, isUser, 'error', {
        errorMsg: '网络错误，请确认 VPN 已开启',
      });
    }
  }

  /** Google 返回的语种代码有时是 'zh'，统一映射为 'zh-CN' */
  function normalizeLang(code) {
    if (!code) return '';
    if (code === 'zh') return 'zh-CN';
    return code;
  }

  /* ═══════════════════════════════════════
     事件委托：监听 chatArea 内头像点击
  ═══════════════════════════════════════ */

  function bindChatAreaDelegate() {
    const chatArea = document.getElementById('chatArea');
    if (!chatArea) return;

    chatArea.addEventListener('click', function (e) {
      const avatar = e.target.closest('.msg-avatar');
      if (!avatar || avatar.classList.contains('hidden')) return;
      handleAvatarClick(avatar);
    });
  }

  /* ═══════════════════════════════════════
     悬浮面板 HTML & CSS
  ═══════════════════════════════════════ */

  function buildPanelHTML() {
    const langOpts = LANG_OPTIONS.map(l =>
      `<option value="${l.code}">${l.label}</option>`
    ).join('');

    return `
    <div id="tt-panel" class="tt-panel" style="display:none">
      <div class="tt-panel-arrow"></div>
      <div class="tt-panel-inner">

        <!-- 标题栏 -->
        <div class="tt-panel-head">
          <div class="tt-panel-title">
            <i class="fa-solid fa-language"></i> 翻译设置
          </div>
          <button class="tt-panel-close" id="ttPanelClose">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>

        <!-- 总开关 -->
        <div class="tt-row tt-switch-row" id="ttMainSwitchRow">
          <div class="tt-row-info">
            <div class="tt-row-title">启用翻译</div>
            <div class="tt-row-sub">
              ⚠ 调用 Google 免费接口，<br>需要开启 VPN 才能使用
            </div>
          </div>
          <label class="tt-toggle">
            <input type="checkbox" id="ttMainSwitch">
            <span class="tt-knob"></span>
          </label>
        </div>

        <!-- 分割线 -->
        <div class="tt-divider"></div>

        <!-- 模块一：固定语种翻译 -->
        <div class="tt-module" id="ttModuleFixed">
          <div class="tt-module-head">
            <div class="tt-module-title">
              <i class="fa-solid fa-lock" style="font-size:9px;opacity:0.5"></i>
              固定语种翻译
            </div>
            <label class="tt-toggle">
              <input type="checkbox" id="ttFixedSwitch">
              <span class="tt-knob"></span>
            </label>
          </div>
          <div class="tt-module-body" id="ttFixedBody">
            <div class="tt-lang-row">
              <div class="tt-lang-item">
                <div class="tt-lang-label">识别为</div>
                <select class="tt-select" id="ttFixedSrc">${langOpts}</select>
              </div>
              <div class="tt-lang-arrow">→</div>
              <div class="tt-lang-item">
                <div class="tt-lang-label">翻译成</div>
                <select class="tt-select" id="ttFixedDst">${langOpts}</select>
              </div>
            </div>
          </div>
        </div>

        <div class="tt-divider"></div>

        <!-- 模块二：自动识别翻译 -->
        <div class="tt-module" id="ttModuleAuto">
          <div class="tt-module-head">
            <div class="tt-module-title">
              <i class="fa-solid fa-wand-magic-sparkles" style="font-size:9px;opacity:0.5"></i>
              自动识别翻译
            </div>
            <label class="tt-toggle">
              <input type="checkbox" id="ttAutoSwitch">
              <span class="tt-knob"></span>
            </label>
          </div>
          <div class="tt-module-body" id="ttAutoBody">
            <div class="tt-rules-list" id="ttRulesList"></div>
            <button class="tt-add-rule-btn" id="ttAddRuleBtn">
              <i class="fa-solid fa-plus"></i> 新增翻译规则
            </button>
          </div>
        </div>

        <div class="tt-divider"></div>

        <!-- 模块三：输入翻译 -->
        <div class="tt-module" id="ttModuleInput">
          <div class="tt-module-head">
            <div class="tt-module-title">
              <i class="fa-solid fa-keyboard" style="font-size:9px;opacity:0.5"></i>
              输入翻译
            </div>
            <label class="tt-toggle">
              <input type="checkbox" id="ttInputSwitch">
              <span class="tt-knob"></span>
            </label>
          </div>
          <div class="tt-module-body" id="ttInputBody">
            <div class="tt-lang-row">
              <div class="tt-lang-item">
                <div class="tt-lang-label">输入语种</div>
                <select class="tt-select" id="ttInputSrc">${langOpts}</select>
              </div>
              <div class="tt-lang-arrow">→</div>
              <div class="tt-lang-item">
                <div class="tt-lang-label">翻译成</div>
                <select class="tt-select" id="ttInputDst">${langOpts}</select>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>`;
  }

  /* ═══════════════════════════════════════
     悬浮面板逻辑
  ═══════════════════════════════════════ */

  let panelEl = null;

  function createPanel() {
    const div = document.createElement('div');
    div.innerHTML = buildPanelHTML();
    panelEl = div.querySelector('#tt-panel');
    document.body.appendChild(panelEl);

    // 关闭按钮
    panelEl.querySelector('#ttPanelClose').addEventListener('click', hidePanel);

    // 点击面板外关闭
    document.addEventListener('click', function (e) {
      if (!panelEl || panelEl.style.display === 'none') return;
      const liveBtn = document.querySelector('.char-status .live');
      if (!liveBtn) return;
      if (!panelEl.contains(e.target) && e.target !== liveBtn) {
        hidePanel();
      }
    });

    // 同步 UI → cfg
    syncUiToCfg();
    bindPanelEvents();
  }

  function showPanel() {
    if (!panelEl) createPanel();
    syncCfgToUi();

    const liveBtn = document.querySelector('.char-status .live');
    if (liveBtn) {
      const rect = liveBtn.getBoundingClientRect();
      const vw   = window.innerWidth;
      const panelW = Math.min(vw - 32, 320); // 面板宽度，左右各留 16px

      // 面板水平居中于视口
      const panelLeft = Math.round((vw - panelW) / 2);
      panelEl.style.top   = (rect.bottom + 10) + 'px';
      panelEl.style.left  = panelLeft + 'px';
      panelEl.style.width = panelW + 'px';

      // 小尖角对齐 ONLINE 按钮中心，相对面板左边偏移
      const btnCenterX   = rect.left + rect.width / 2;
      const arrowLeft    = Math.max(12, Math.min(panelW - 26, Math.round(btnCenterX - panelLeft - 7)));
      const arrowEl      = panelEl.querySelector('.tt-panel-arrow');
      if (arrowEl) arrowEl.style.left = arrowLeft + 'px';
    }

    panelEl.style.display = 'block';
    requestAnimationFrame(() => panelEl.classList.add('tt-panel-show'));
  }

  function hidePanel() {
    if (!panelEl) return;
    panelEl.classList.remove('tt-panel-show');
    setTimeout(() => {
      if (panelEl) panelEl.style.display = 'none';
    }, 220);
  }

  /* ─── 同步 cfg → UI ─── */
  function syncCfgToUi() {
    if (!panelEl) return;

    panelEl.querySelector('#ttMainSwitch').checked = cfg.enabled;
    panelEl.querySelector('#ttFixedSwitch').checked = cfg.mode === 'fixed';
    panelEl.querySelector('#ttAutoSwitch').checked  = cfg.mode === 'auto';

    const fixedSrcSel = panelEl.querySelector('#ttFixedSrc');
    const fixedDstSel = panelEl.querySelector('#ttFixedDst');
    fixedSrcSel.value = cfg.fixedSrc;
    fixedDstSel.value = cfg.fixedDst;

    panelEl.querySelector('#ttInputSwitch').checked = !!cfg.inputEnabled;
    panelEl.querySelector('#ttInputSrc').value = cfg.inputSrc || 'zh-CN';
    panelEl.querySelector('#ttInputDst').value = cfg.inputDst || 'ja';

    renderAutoRules();
    updateModuleDisabledState();
  }

  /* ─── 渲染自动规则列表 ─── */
  function renderAutoRules() {
    const list = panelEl.querySelector('#ttRulesList');
    if (!list) return;
    list.innerHTML = '';
    const langOpts = LANG_OPTIONS.map(l => `<option value="${l.code}">${l.label}</option>`).join('');

    cfg.autoRules.forEach((rule, idx) => {
      const row = document.createElement('div');
      row.className = 'tt-rule-row';
      row.dataset.idx = idx;
      row.innerHTML = `
        <select class="tt-select tt-rule-from">${langOpts}</select>
        <span class="tt-rule-arrow">→</span>
        <select class="tt-select tt-rule-to">${langOpts}</select>
        <button class="tt-rule-del" title="删除">
          <i class="fa-solid fa-xmark"></i>
        </button>`;
      row.querySelector('.tt-rule-from').value = rule.from;
      row.querySelector('.tt-rule-to').value   = rule.to;

      row.querySelector('.tt-rule-from').addEventListener('change', e => {
        cfg.autoRules[idx].from = e.target.value;
        saveCfg(cfg);
      });
      row.querySelector('.tt-rule-to').addEventListener('change', e => {
        cfg.autoRules[idx].to = e.target.value;
        saveCfg(cfg);
      });
      row.querySelector('.tt-rule-del').addEventListener('click', (e) => {
        e.stopPropagation();
        cfg.autoRules.splice(idx, 1);
        saveCfg(cfg);
        renderAutoRules();
      });

      list.appendChild(row);
    });
  }

  /* ─── 更新模块禁用态（互斥 + 总开关） ─── */
  function updateModuleDisabledState() {
    if (!panelEl) return;
    const enabled  = cfg.enabled;
    const isFixed  = cfg.mode === 'fixed';
    const isAuto   = cfg.mode === 'auto';

    // 固定模块
    const fixedBody = panelEl.querySelector('#ttFixedBody');
    fixedBody.style.opacity    = (enabled && isFixed) ? '1' : '0.4';
    fixedBody.style.pointerEvents = (enabled && isFixed) ? '' : 'none';

    // 自动模块
    const autoBody = panelEl.querySelector('#ttAutoBody');
    autoBody.style.opacity     = (enabled && isAuto) ? '1' : '0.4';
    autoBody.style.pointerEvents = (enabled && isAuto) ? '' : 'none';

    // 整个两个模块区域如果总开关关了也变暗
    ['#ttModuleFixed','#ttModuleAuto'].forEach(sel => {
      const mod = panelEl.querySelector(sel);
      if (mod) mod.style.opacity = enabled ? '1' : '0.5';
    });

    // 输入翻译模块
    const inputMod  = panelEl.querySelector('#ttModuleInput');
    const inputBody = panelEl.querySelector('#ttInputBody');
    if (inputMod)  inputMod.style.opacity = enabled ? '1' : '0.5';
    if (inputBody) {
      const active = enabled && !!cfg.inputEnabled;
      inputBody.style.opacity = active ? '1' : '0.4';
      inputBody.style.pointerEvents = active ? '' : 'none';
    }
  }

  /* ─── 绑定面板内所有事件 ─── */
  function bindPanelEvents() {
    // 总开关
    panelEl.querySelector('#ttMainSwitch').addEventListener('change', e => {
      cfg.enabled = e.target.checked;
      saveCfg(cfg);
      updateModuleDisabledState();
      updateInputTranslateBinding();
    });

    // 固定模式开关（互斥）
    panelEl.querySelector('#ttFixedSwitch').addEventListener('change', e => {
      if (e.target.checked) {
        cfg.mode = 'fixed';
        panelEl.querySelector('#ttAutoSwitch').checked = false;
      } else {
        // 不允许两个都关，关固定就默认开自动
        cfg.mode = 'auto';
        panelEl.querySelector('#ttAutoSwitch').checked = true;
      }
      saveCfg(cfg);
      updateModuleDisabledState();
    });

    // 自动模式开关（互斥）
    panelEl.querySelector('#ttAutoSwitch').addEventListener('change', e => {
      if (e.target.checked) {
        cfg.mode = 'auto';
        panelEl.querySelector('#ttFixedSwitch').checked = false;
      } else {
        cfg.mode = 'fixed';
        panelEl.querySelector('#ttFixedSwitch').checked = true;
      }
      saveCfg(cfg);
      updateModuleDisabledState();
    });

    // 固定模式选择器
    panelEl.querySelector('#ttFixedSrc').addEventListener('change', e => {
      cfg.fixedSrc = e.target.value;
      saveCfg(cfg);
    });
    panelEl.querySelector('#ttFixedDst').addEventListener('change', e => {
      cfg.fixedDst = e.target.value;
      saveCfg(cfg);
    });

    // 新增规则按钮
    panelEl.querySelector('#ttAddRuleBtn').addEventListener('click', () => {
      cfg.autoRules.push({ from: 'en', to: 'zh-CN' });
      saveCfg(cfg);
      renderAutoRules();
      // 滚动到底部显示新规则
      const list = panelEl.querySelector('#ttRulesList');
      list.scrollTop = list.scrollHeight;
    });

    // 输入翻译开关
    panelEl.querySelector('#ttInputSwitch').addEventListener('change', e => {
      cfg.inputEnabled = e.target.checked;
      saveCfg(cfg);
      updateModuleDisabledState();
      updateInputTranslateBinding();
    });

    // 输入翻译语种选择器
    panelEl.querySelector('#ttInputSrc').addEventListener('change', e => {
      cfg.inputSrc = e.target.value;
      saveCfg(cfg);
    });
    panelEl.querySelector('#ttInputDst').addEventListener('change', e => {
      cfg.inputDst = e.target.value;
      saveCfg(cfg);
    });
  }

  /* ─── 同步 UI → cfg（初始化时用一次） ─── */
  function syncUiToCfg() {
    // 初始以 cfg 为准，不反向读 UI（UI 还没填值）
  }

  /* ═══════════════════════════════════════
     输入翻译：监听输入框 → 弹出译文小条
  ═══════════════════════════════════════ */

  let _inputTranslateTimer = null;
  let _inputStripEl        = null;
  let _inputCurrentText    = '';

  /** 获取主输入框元素（class="input-field"，无 id） */
  function getMainInput() {
    return document.querySelector('.input-area .input-field');
  }

  /**
   * 获取/创建输入翻译提示条
   * 插入到 .input-row 上方（在 .input-area 内）
   */
  function getOrCreateInputStrip(inputBox) {
    if (_inputStripEl && _inputStripEl.isConnected) return _inputStripEl;

    // 优先插到 .input-row 的前面，让小条出现在输入行上方
    const inputRow = inputBox.closest('.input-area')
      ? inputBox.closest('.input-area').querySelector('.input-row')
      : null;
    const insertTarget = inputRow || inputBox.closest('.input-area') || inputBox.parentElement;
    if (!insertTarget) return null;

    _inputStripEl = document.createElement('div');
    _inputStripEl.id = 'tt-input-strip';
    _inputStripEl.className = 'tt-input-strip';
    _inputStripEl.style.display = 'none';
    insertTarget.parentElement
      ? insertTarget.parentElement.insertBefore(_inputStripEl, insertTarget)
      : insertTarget.insertBefore(_inputStripEl, insertTarget.firstChild);
    return _inputStripEl;
  }

  function showInputStrip(text) {
    const inputBox = getMainInput();
    if (!inputBox) return;

    const strip = getOrCreateInputStrip(inputBox);
    if (!strip) return;

    strip.innerHTML = `
      <div class="tt-input-strip-text">${escapeHtml(text)}</div>
      <button class="tt-input-strip-replace" title="替换到输入框">
        <i class="fa-solid fa-check"></i>
      </button>`;

    strip.style.display = 'flex';
    strip.classList.remove('tt-input-strip-hide');

    strip.querySelector('.tt-input-strip-replace').addEventListener('click', (e) => {
      e.stopPropagation();
      const inputEl = getMainInput();
      if (inputEl) {
        inputEl.value = text;
        inputEl.dispatchEvent(new Event('input', { bubbles: true }));
        inputEl.focus();
      }
      hideInputStrip();
    });
  }

  function hideInputStrip() {
    if (!_inputStripEl) return;
    _inputStripEl.classList.add('tt-input-strip-hide');
    setTimeout(() => {
      if (_inputStripEl) _inputStripEl.style.display = 'none';
    }, 220);
  }

  function handleInputTranslate(value) {
    if (_inputTranslateTimer) clearTimeout(_inputTranslateTimer);

    if (!value.trim()) {
      hideInputStrip();
      return;
    }

    _inputTranslateTimer = setTimeout(async () => {
      if (!cfg.enabled || !cfg.inputEnabled) return;
      try {
        const res = await googleTranslate(value.trim(), cfg.inputDst || 'ja', cfg.inputSrc || 'zh-CN');
        if (res.text && res.text !== value.trim()) {
          _inputCurrentText = res.text;
          showInputStrip(res.text);
        }
      } catch (err) {
        console.warn('[TsukiTranslate] 输入翻译失败:', err);
      }
    }, 600);
  }

  function updateInputTranslateBinding() {
    const inputBox = getMainInput();
    if (!inputBox) {
      // 输入框可能还没渲染，稍后重试
      setTimeout(updateInputTranslateBinding, 300);
      return;
    }

    // 移除旧监听器
    if (inputBox._ttInputHandler) {
      inputBox.removeEventListener('input', inputBox._ttInputHandler);
      inputBox._ttInputHandler = null;
    }

    if (cfg.enabled && cfg.inputEnabled) {
      inputBox._ttInputHandler = function () {
        handleInputTranslate(inputBox.value);
      };
      inputBox.addEventListener('input', inputBox._ttInputHandler);
      console.log('[TsukiTranslate] 输入翻译已绑定到', inputBox);
    } else {
      hideInputStrip();
    }
  }

  /* ═══════════════════════════════════════
     绑定 ONLINE 按钮点击事件
  ═══════════════════════════════════════ */

  function bindOnlineBtn() {
    // 使用事件委托，因为 chatView 可能是动态显示的
    document.addEventListener('click', function (e) {
      const liveBtn = e.target.closest('.char-status .live');
      if (!liveBtn) return;
      e.stopPropagation();
      if (panelEl && panelEl.style.display !== 'none') {
        hidePanel();
      } else {
        showPanel();
      }
    });
  }

  /* ═══════════════════════════════════════
     注入样式
  ═══════════════════════════════════════ */

  function injectStyles() {
    const style = document.createElement('style');
    style.id = 'tsuki-translate-styles';
    style.textContent = `
/* ══ 悬浮翻译面板 ══════════════════════════════════ */
.tt-panel {
  position: fixed;
  z-index: 99999;
  /* 宽度由 JS 动态赋值，最大 320px，左右各留 16px */
  background: #fff;
  border-radius: 18px;
  box-shadow:
    0 0 0 1px rgba(10,10,10,0.06),
    0 8px 32px -4px rgba(10,10,10,0.16),
    0 2px 8px rgba(10,10,10,0.08);
  opacity: 0;
  transform: translateY(-6px) scale(0.97);
  transition: opacity 0.22s ease, transform 0.22s cubic-bezier(0.34,1.56,0.64,1);
  pointer-events: none;
  font-family: 'Geist', sans-serif;
}
.tt-panel.tt-panel-show {
  opacity: 1;
  transform: translateY(0) scale(1);
  pointer-events: auto;
}
.tt-panel-arrow {
  position: absolute;
  top: -7px;
  /* left 由 JS 动态赋值，追踪 ONLINE 按钮中心 */
  left: 18px;
  width: 14px;
  height: 14px;
  background: #fff;
  transform: rotate(45deg);
  border-radius: 3px 0 0 0;
  box-shadow: -1px -1px 0 rgba(10,10,10,0.06);
}
.tt-panel-inner {
  padding: 14px 16px 16px;
}
.tt-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.tt-panel-title {
  font-size: 12px;
  font-weight: 700;
  color: #0a0a0a;
  letter-spacing: 0.04em;
  display: flex;
  align-items: center;
  gap: 6px;
}
.tt-panel-close {
  width: 24px;
  height: 24px;
  border: none;
  background: #f1f0ea;
  border-radius: 8px;
  cursor: pointer;
  color: #4a4a4d;
  font-size: 11px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: 0.15s;
}
.tt-panel-close:hover { background: #0a0a0a; color: #fff; }

/* 行 */
.tt-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.tt-switch-row {
  justify-content: space-between;
  padding: 10px 12px;
  background: #fafaf7;
  border-radius: 12px;
  border: 1px solid rgba(10,10,10,0.06);
}
.tt-row-info { flex: 1; }
.tt-row-title {
  font-size: 11px;
  font-weight: 600;
  color: #0a0a0a;
  margin-bottom: 2px;
}
.tt-row-sub {
  font-family: 'Geist Mono', monospace;
  font-size: 9px;
  color: #8a8a8e;
  line-height: 1.5;
}

/* 切换开关 */
.tt-toggle {
  position: relative;
  width: 36px;
  height: 20px;
  flex-shrink: 0;
  cursor: pointer;
}
.tt-toggle input { display: none; }
.tt-knob {
  position: absolute;
  inset: 0;
  background: #e0e0e0;
  border-radius: 10px;
  transition: 0.22s;
}
.tt-knob::after {
  content: '';
  position: absolute;
  top: 3px;
  left: 3px;
  width: 14px;
  height: 14px;
  background: #fff;
  border-radius: 50%;
  box-shadow: 0 1px 3px rgba(0,0,0,0.15);
  transition: 0.22s;
}
.tt-toggle input:checked + .tt-knob { background: #0a0a0a; }
.tt-toggle input:checked + .tt-knob::after { transform: translateX(16px); }

/* 分割线 */
.tt-divider {
  height: 1px;
  background: rgba(10,10,10,0.06);
  margin: 10px 0;
}

/* 模块 */
.tt-module { transition: opacity 0.2s; }
.tt-module-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}
.tt-module-title {
  font-size: 10.5px;
  font-weight: 600;
  color: #4a4a4d;
  display: flex;
  align-items: center;
  gap: 5px;
  letter-spacing: 0.04em;
}
.tt-module-body { transition: opacity 0.2s; }

/* 语种选择行 */
.tt-lang-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  background: #fafaf7;
  border-radius: 10px;
  border: 1px solid rgba(10,10,10,0.06);
}
.tt-lang-item { display: flex; flex-direction: column; gap: 4px; flex: 1; }
.tt-lang-label {
  font-family: 'Geist Mono', monospace;
  font-size: 8.5px;
  color: #8a8a8e;
  text-transform: uppercase;
  letter-spacing: 0.1em;
}
.tt-lang-arrow {
  font-size: 12px;
  color: #8a8a8e;
  flex-shrink: 0;
  margin-top: 12px;
}

/* 选择器 */
.tt-select {
  width: 100%;
  height: 26px;
  border: 1px solid rgba(10,10,10,0.1);
  border-radius: 7px;
  background: #fff;
  font-family: 'Geist', sans-serif;
  font-size: 11px;
  color: #0a0a0a;
  padding: 0 6px;
  outline: none;
  cursor: pointer;
}

/* 自动规则列表 */
.tt-rules-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 160px;
  overflow-y: auto;
  margin-bottom: 8px;
  padding-right: 2px;
}
.tt-rules-list::-webkit-scrollbar { width: 3px; }
.tt-rules-list::-webkit-scrollbar-thumb { background: rgba(10,10,10,0.15); border-radius: 2px; }

.tt-rule-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  background: #fafaf7;
  border-radius: 8px;
  border: 1px solid rgba(10,10,10,0.06);
}
.tt-rule-row .tt-select { height: 24px; font-size: 10.5px; flex: 1; }
.tt-rule-arrow {
  font-size: 11px;
  color: #8a8a8e;
  flex-shrink: 0;
}
.tt-rule-del {
  width: 22px;
  height: 22px;
  border: none;
  background: rgba(255,107,107,0.1);
  border-radius: 6px;
  color: #ff6b6b;
  cursor: pointer;
  font-size: 9px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: 0.15s;
}
.tt-rule-del:hover { background: #ff6b6b; color: #fff; }

.tt-add-rule-btn {
  width: 100%;
  height: 28px;
  border: 1px dashed rgba(10,10,10,0.2);
  border-radius: 8px;
  background: transparent;
  color: #8a8a8e;
  font-size: 10.5px;
  font-family: 'Geist', sans-serif;
  cursor: pointer;
  transition: 0.15s;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
}
.tt-add-rule-btn:hover {
  border-color: #0a0a0a;
  color: #0a0a0a;
  background: #fafaf7;
}

/* ══ 气泡翻译条 ══════════════════════════════════ */
.tt-bar {
  margin-top: 6px;
  animation: ttBarIn 0.28s cubic-bezier(0.34,1.56,0.64,1);
  transform-origin: top center;
}
.tt-bar-hide {
  animation: ttBarOut 0.25s ease forwards;
}
@keyframes ttBarIn {
  from { opacity: 0; transform: scaleY(0.7) translateY(-4px); }
  to   { opacity: 1; transform: scaleY(1) translateY(0); }
}
@keyframes ttBarOut {
  from { opacity: 1; transform: scaleY(1); }
  to   { opacity: 0; transform: scaleY(0.7); }
}

/* 角色气泡翻译条：左侧，冷色系信笺风格 */
.tt-bar-char .tt-inner {
  position: relative;
  padding: 10px 13px 12px;
  background: linear-gradient(135deg, #f9fbff 0%, #f4f7ff 100%);
  border: 1px solid rgba(91,124,250,0.11);
  border-radius: 4px 16px 16px 16px;
  box-shadow:
    0 0 0 3px rgba(91,124,250,0.03),
    inset 0 1px 0 rgba(255,255,255,0.9);
  overflow: hidden;
}
.tt-bar-char .tt-inner::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 1.5px;
  background: linear-gradient(90deg, rgba(91,124,250,0.4), rgba(167,139,250,0.3), transparent);
  border-radius: 4px 16px 0 0;
}
.tt-bar-char .tt-inner::after {
  content: '';
  position: absolute;
  bottom: 6px;
  right: 10px;
  width: 24px;
  height: 24px;
  background: radial-gradient(circle, rgba(91,124,250,0.07) 0%, transparent 70%);
  border-radius: 50%;
}
/* 不规则装饰角 */
.tt-bar-char .tt-inner .tt-ornament-line {
  position: absolute;
  bottom: 0;
  left: 13px;
  right: 13px;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(91,124,250,0.12), transparent);
  margin-top: 6px;
}

/* 用户气泡翻译条：右侧，粉色信笺风格 */
.tt-bar-user .tt-inner {
  position: relative;
  padding: 10px 13px 12px;
  background: linear-gradient(135deg, #fffafe 0%, #fef6fb 60%, #fdf3fc 100%);
  border: 1px solid rgba(250,91,213,0.09);
  border-radius: 16px 4px 16px 16px;
  box-shadow:
    0 0 0 3px rgba(250,91,213,0.025),
    inset 0 1px 0 rgba(255,255,255,0.95);
  overflow: hidden;
}
.tt-bar-user .tt-inner::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 1.5px;
  background: linear-gradient(90deg, transparent 0%, rgba(250,91,213,0.35) 40%, rgba(255,184,209,0.25) 80%, transparent 100%);
  border-radius: 16px 4px 0 0;
}
.tt-bar-user .tt-inner::after {
  content: '';
  position: absolute;
  bottom: 5px;
  left: 8px;
  width: 28px;
  height: 28px;
  background: radial-gradient(circle, rgba(250,91,213,0.06) 0%, transparent 70%);
  border-radius: 50%;
}
.tt-bar-user .tt-inner .tt-ornament-line {
  position: absolute;
  bottom: 0;
  left: 13px;
  right: 13px;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(250,91,213,0.1), rgba(255,184,209,0.15), transparent);
  margin-top: 6px;
}

/* 翻译条内部元素 */
.tt-label {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-bottom: 7px;
}
.tt-icon {
  font-size: 9px;
  opacity: 0.55;
}
.tt-bar-char .tt-icon { color: #5b7cfa; }
.tt-bar-user .tt-icon { color: #fa5bd5; }

.tt-label-text {
  font-family: 'Geist Mono', monospace;
  font-size: 8.5px;
  font-weight: 600;
  letter-spacing: 0.15em;
  opacity: 0.5;
  text-transform: uppercase;
}
.tt-bar-char .tt-label-text { color: #5b7cfa; }
.tt-bar-user .tt-label-text { color: #fa5bd5; }

.tt-lang-badge {
  font-family: 'Geist Mono', monospace;
  font-size: 8px;
  padding: 2px 7px;
  border-radius: 20px;
  letter-spacing: 0.06em;
  font-weight: 600;
  /* 宽度随内容自适应，不拉伸 */
  display: inline-flex;
  align-items: center;
  width: fit-content;
  white-space: nowrap;
}
.tt-bar-char .tt-lang-badge {
  background: rgba(91,124,250,0.06);
  color: #7e9bfb;
  border: 1px solid rgba(91,124,250,0.09);
}
.tt-bar-user .tt-lang-badge {
  background: rgba(250,91,213,0.05);
  color: #d97ec4;
  border: 1px solid rgba(250,91,213,0.1);
}

.tt-close {
  margin-left: auto;
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  cursor: pointer;
  font-size: 9px;
  opacity: 0.4;
  transition: 0.15s;
}
.tt-close:hover { opacity: 1; }

.tt-content {
  font-size: 12px;
  line-height: 1.6;
  color: #1f1f20;
  word-break: break-all;
}

/* loading 动画 */
.tt-loading {
  display: flex;
  gap: 4px;
  align-items: center;
  height: 18px;
}
.tt-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  animation: ttDotPulse 1.2s ease-in-out infinite;
}
.tt-bar-char .tt-dot { background: #a0b8fc; }
.tt-bar-user .tt-dot { background: #f5a8e8; }
.tt-dot:nth-child(2) { animation-delay: 0.2s; }
.tt-dot:nth-child(3) { animation-delay: 0.4s; }
@keyframes ttDotPulse {
  0%, 80%, 100% { opacity: 0.2; transform: scale(0.8); }
  40% { opacity: 1; transform: scale(1); }
}

.tt-error {
  color: #ff6b6b;
  font-size: 11px;
  display: flex;
  align-items: center;
  gap: 5px;
}

/* 头像点击提示 */
.msg-avatar {
  cursor: pointer;
  transition: transform 0.15s, opacity 0.15s;
}
.msg-avatar:not(.hidden):hover {
  transform: scale(1.1);
  opacity: 0.85;
}

/* ONLINE 按钮点击态 */
.char-status .live {
  cursor: pointer;
  transition: background 0.18s, transform 0.18s;
  user-select: none;
}
.char-status .live:hover {
  background: #1f1f20;
  transform: scale(1.03);
}

/* ══ 输入翻译提示条 ══════════════════════════════ */
.tt-input-strip {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 6px;
  padding: 7px 10px 7px 12px;
  background: rgba(220, 210, 245, 0.18);
  border: 1px solid rgba(180, 160, 230, 0.18);
  border-radius: 10px;
  animation: ttStripIn 0.22s cubic-bezier(0.34,1.56,0.64,1);
}
.tt-input-strip.tt-input-strip-hide {
  animation: ttStripOut 0.2s ease forwards;
}
@keyframes ttStripIn {
  from { opacity: 0; transform: translateY(4px) scaleY(0.9); }
  to   { opacity: 1; transform: translateY(0) scaleY(1); }
}
@keyframes ttStripOut {
  from { opacity: 1; transform: scaleY(1); }
  to   { opacity: 0; transform: scaleY(0.85); }
}
.tt-input-strip-text {
  flex: 1;
  font-family: 'Geist', sans-serif;
  font-size: 12px;
  color: #7a6a9a;
  line-height: 1.5;
  word-break: break-all;
}
.tt-input-strip-replace {
  flex-shrink: 0;
  width: 26px;
  height: 26px;
  border: none;
  background: rgba(180, 160, 230, 0.18);
  border-radius: 7px;
  color: #9a80c0;
  font-size: 11px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, color 0.15s;
}
.tt-input-strip-replace:hover {
  background: rgba(160, 130, 210, 0.3);
  color: #6a4da0;
}
    `;
    document.head.appendChild(style);
  }

  /* ═══════════════════════════════════════
     初始化入口
  ═══════════════════════════════════════ */

  function init() {
    injectStyles();
    bindOnlineBtn();
    bindChatAreaDelegate();
    // 如果上次已开启输入翻译，恢复绑定
    if (cfg.enabled && cfg.inputEnabled) {
      // 延迟绑定，确保 msgInput 已渲染
      setTimeout(updateInputTranslateBinding, 500);
    }
    console.log('[TsukiTranslate] 翻译模块已加载 ✓');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
