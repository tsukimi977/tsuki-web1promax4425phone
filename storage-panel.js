/**
 * storage-panel.js
 * 负责展示清冷日间BE风格的数据库存储空间环形图面板
 */

(function () {
  // ============================================================================
  // 1. 配置与文案：日间 BE 氛围感设计
  // ============================================================================
  const CONFIG = {
    panelId: 'tsuki-storage-panel',
    styleId: 'tsuki-storage-styles',
    categories: [
      { id: 'chat', name: '线上聊天', color: '#A3D2CA' }, // 淡青
      { id: 'char', name: '角色数据', color: '#B8C6DB' }, // 雾蓝
      { id: 'story', name: '线下剧场', color: '#E2C4B9' }, // 淡杏/肉粉
      { id: 'media', name: '图片缓存', color: '#FFD3B6' }, // 淡橘
      { id: 'video', name: '视频通话', color: '#D4A5A5' }, // 枯玫
      { id: 'x', name: 'X模块', color: '#F9EDCC' }, // 淡米黄
      { id: 'other', name: '其他数据', color: '#E0E0E0' }, // 清冷灰
    ],
    // 随机底部的 BE 句子（日间、清透、虚无感）
    beSentences: [
      '白昼の光の中で、記憶だけが静かに腐敗していく。', // 在白昼的光芒中，只有记忆在静静地腐烂。
      'これ以上、君との思い出を詰め込めないよ。', // 再也装不下更多关于你的回忆了。
      '消去されたデータは、どこへ行くのだろう。', // 被抹去的数据，究竟会去往何处呢。
      '満たされた器、溢れ出したのは空白のノイズ。', // 被填满的容器，溢出来的只有空白的杂音。
      '眩しすぎる空の下、私たちは互いを忘れていく。', // 在太过耀眼的天空下，我们正在遗忘彼此。
    ],
  };

  // 映射你 localStorage 中对应的 Key 归类
  const KEY_MAPPING = {
    chat: ['tsuki_phone_chat_state', 'tsuki_phone_module_data'],
    char: ['tsuki_phone_character_data'],
    story: [
      'tsuki_phone_story_data',
      'tsukimi_offline_story_timer',
      'tsukiPhoneStoryDate',
      'tsukimi_offline_daily_history',
      'tsukimi_offline_total_time',
    ],
    video: ['tsuki_phone_video_history', 'tsuki_phone_livestream_data'],
    x: ['tsuki_phone_x_data', 'tsuki_phone_x_active_commenters', 'tsuki_phone_x_user_reply_time'],
    other: [
      'tsuki_phone_api_settings',
      'tsuki_phone_api_cases',
      'tsuki_phone_api_temperature',
      'tsuki_phone_prompt_chain',
      'tsuki_phone_keyword_prompts',
      'tsuki_phone_renderer_rules',
      'tsuki_phone_builtin_prompt_states',
      'tsuki_phone_custom_theme',
      'tsuki_phone_shell_scale',
      'tsukiCustomFontUrl',
      'tsuki_phone_custom_css',
      'tsuki_phone_custom_bubble_css',
      'tsuki_listen_btn_visible',
      'tsuki_screenshot_btn_visible',
      'tsuki_lyric_interaction_enabled',
      'tsuki_phone_system_messages_visible',
      'tsuki-chat-wallpaper',
      'tsuki-contacts-wallpaper',
      'tsuki-home-wallpaper',
      'tsuki_phone_playlist',
      'tsuki_phone_custom_avatars',
      'tsuki_moment_author_name',
      'tsuki_moment_author_username',
      'tsuki_phone_chat_render_limit',
      'tsuki_phone_ai_history_limit',
      'tsuki_phone_excluded_placeholders',
      'tsuki_phone_emoji_stickers',
      'tsuki_acquaintance_dates',
      'tsuki-theme-mode',
      'tsuki_phone_novelai_settings',
      'tsuki_phone_nai_seed_history',
      'tsuki_phone_nai_prompt_cases',
      'tsukimi_char_timer_data',
      'tsukimi_total_time',
      'tsukimi_today_time',
      'tsukimi_last_date',
      'tsukimi_daily_history',
      'tsukimi_advanced_config',
    ],
  };

  // ============================================================================
  // 2. 核心数据计算 (IndexedDB 与接管的 LocalStorage 大小估算)
  // ============================================================================
  async function calculateStorageData() {
    let usage = 0;
    let quota = 0;

    // 1. 获取浏览器对当前域名的真实 IndexedDB 占用空间
    if (navigator.storage && navigator.storage.estimate) {
      const estimate = await navigator.storage.estimate();
      usage = estimate.usage || 0;
      quota = estimate.quota || 0;
    }

    const dataSizes = { chat: 0, char: 0, story: 0, media: 0, video: 0, x: 0, other: 0 };
    let calculatedKnownSize = 0;

    // 2. 遍历 key 计算接管后的“文本”大小
    for (const [category, keys] of Object.entries(KEY_MAPPING)) {
      let size = 0;
      keys.forEach(key => {
        const value = localStorage.getItem(key);
        if (value) size += value.length; // 粗略估算每个字符为 1 字节
      });
      dataSizes[category] = size;
      calculatedKnownSize += size;
    }

    // 3. 差额归类于“图片缓存” (因为 IndexedDB 直接存的图片 blob 无法通过 localStorage.getItem 拿到，用总已用减去文本已知就是媒体大小)
    const mediaSize = usage - calculatedKnownSize;
    dataSizes.media = mediaSize > 0 ? mediaSize : 1024 * 50; // 如果差额为负或极小，保底给 50KB

    return { total: quota, used: usage, segments: dataSizes };
  }

  function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  // ============================================================================
  // 3. UI 构建与事件绑定
  // ============================================================================
  function createPanel(data) {
    // 移除旧面板
    const oldPanel = document.getElementById(CONFIG.panelId);
    if (oldPanel) oldPanel.remove();

    const usedStr = formatBytes(data.used);
    const totalStr = formatBytes(data.total);

    // 计算环形图各段占比
    const segmentsData = [];
    let cumulativePercent = 0;

    CONFIG.categories.forEach(cat => {
      const size = data.segments[cat.id] || 0;
      const percent = data.used > 0 ? size / data.used : 0;
      segmentsData.push({ ...cat, size, percent });
    });

    const panel = document.createElement('div');
    panel.id = CONFIG.panelId;

    // 生成底部的 BE 句子
    const randomSentence = CONFIG.beSentences[Math.floor(Math.random() * CONFIG.beSentences.length)];

    panel.innerHTML = `
      <div class="be-storage-mask"></div>
      <div class="be-storage-content">
        <div class="be-header">
          <h3 class="be-title">記憶の容量</h3>
          <div class="be-close-btn" title="閉じる">✕</div>
        </div>

        <div class="be-quota-text">
          <span class="be-used">${usedStr}</span>
          <span class="be-separator">/</span>
          <span class="be-total">${totalStr}</span>
        </div>

        <div class="be-chart-wrap">
          <svg class="be-donut-svg" viewBox="0 0 100 100">
            ${generateSvgRing(segmentsData)}
          </svg>
          <div class="be-chart-center">
            <span class="center-label">空き</span>
            <span class="center-val">${formatBytes(data.total - data.used)}</span>
          </div>
        </div>

        <div class="be-legend">
          ${segmentsData
            .map(
              seg => `
            <div class="be-legend-item" data-id="${seg.id}" data-size="${formatBytes(seg.size)}" data-name="${seg.name}">
              <span class="legend-dot" style="background-color: ${seg.color}"></span>
              <span class="legend-name">${seg.name}</span>
              <span class="legend-pct">${(seg.percent * 100).toFixed(1)}%</span>
            </div>
          `,
            )
            .join('')}
        </div>

        <div class="be-footer">
          <div class="be-footer-text">${randomSentence}</div>
        </div>
      </div>
      <div class="be-tooltip" id="be-storage-tooltip"></div>
    `;

    document.body.appendChild(panel);

    // 绑定事件
    setTimeout(() => panel.classList.add('active'), 10);

    panel.querySelector('.be-close-btn').addEventListener('click', () => closePanel());
    panel.querySelector('.be-storage-mask').addEventListener('click', () => closePanel());

    // 环形图和图例的点击联动
    const tooltip = panel.querySelector('#be-storage-tooltip');
    const legendItems = panel.querySelectorAll('.be-legend-item');
    const svgSegments = panel.querySelectorAll('.be-donut-segment');

    function showTip(e, name, size) {
      tooltip.innerText = `${name}: ${size}`;
      tooltip.style.opacity = '1';
      tooltip.style.left = `${e.clientX + 10}px`;
      tooltip.style.top = `${e.clientY + 10}px`;
    }

    function hideTip() {
      tooltip.style.opacity = '0';
    }

    legendItems.forEach(item => {
      item.addEventListener('click', e => {
        showTip(e, item.dataset.name, item.dataset.size);
      });
      item.addEventListener('mouseleave', hideTip);
    });

    svgSegments.forEach(seg => {
      seg.addEventListener('click', e => {
        const id = seg.dataset.id;
        const targetLegend = panel.querySelector(`.be-legend-item[data-id="${id}"]`);
        if (targetLegend) {
          showTip(e, targetLegend.dataset.name, targetLegend.dataset.size);
        }
      });
      seg.addEventListener('mouseleave', hideTip);
    });
  }

  function generateSvgRing(segments) {
    const radius = 40;
    const circumference = 2 * Math.PI * radius; // 约 251.32
    let currentOffset = 0;
    let html = '';

    // 背景底环
    html += `<circle class="be-donut-bg" cx="50" cy="50" r="${radius}" stroke="#F0F0F0" stroke-width="8" fill="transparent"/>`;

    segments.forEach(seg => {
      const strokeLength = circumference * seg.percent;
      const strokeDash = `${strokeLength} ${circumference - strokeLength}`;

      html += `
        <circle class="be-donut-segment" data-id="${seg.id}" cx="50" cy="50" r="${radius}" 
          stroke="${seg.color}" stroke-width="8" fill="transparent"
          stroke-dasharray="${strokeDash}" 
          stroke-dashoffset="${-currentOffset}"
          transform="rotate(-90 50 50)"
          style="cursor: pointer; transition: stroke-width 0.3s;"
        />`;

      currentOffset += strokeLength;
    });

    return html;
  }

  function closePanel() {
    const panel = document.getElementById(CONFIG.panelId);
    if (!panel) return;
    panel.classList.remove('active');
    setTimeout(() => panel.remove(), 400);
  }

  // ============================================================================
  // 4. 样式注入：日间 BE 清冷唯美风格
  // ============================================================================
  function injectStyles() {
    if (document.getElementById(CONFIG.styleId)) return;

    const style = document.createElement('style');
    style.id = CONFIG.styleId;
    style.innerHTML = `
      #${CONFIG.panelId} {
        position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
        z-index: 10000; opacity: 0; pointer-events: none;
        transition: opacity 0.4s ease;
        font-family: 'JiangChengLvDongSong', 'SimSun', serif;
      }
      #${CONFIG.panelId}.active { opacity: 1; pointer-events: auto; }

      .be-storage-mask {
        position: absolute; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(255, 255, 255, 0.7);
        backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px);
      }

      .be-storage-content {
        position: absolute; top: 50%; left: 50%;
        transform: translate(-50%, -50%) scale(0.9);
        width: 82vw; max-width: 360px;
        background: rgba(255, 255, 255, 0.95);
        border: 1px solid rgba(0, 0, 0, 0.1);
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.05);
        border-radius: 2px; padding: 25px;
        display: flex; flex-direction: column; align-items: center;
        transition: transform 0.4s cubic-bezier(0.25, 1, 0.5, 1);
        box-sizing: border-box;
      }
      #${CONFIG.panelId}.active .be-storage-content { transform: translate(-50%, -50%) scale(1); }

      .be-header {
        width: 100%; display: flex; justify-content: space-between; align-items: center;
        margin-bottom: 20px;
      }
      .be-title {
        font-size: 16px; font-weight: 100; letter-spacing: 4px; color: #444; margin: 0;
      }
      .be-close-btn { cursor: pointer; font-size: 16px; color: #999; transition: color 0.3s; }
      .be-close-btn:hover { color: #555; }

      .be-quota-text {
        font-size: 13px; color: #666; margin-bottom: 25px; font-weight: 100; letter-spacing: 1px;
      }
      .be-used { color: #333; font-weight: bold; }
      .be-separator { margin: 0 4px; color: #ccc; }

      .be-chart-wrap {
        width: 170px; height: 170px; position: relative; margin-bottom: 25px;
      }
      .be-donut-svg { width: 100%; height: 100%; }
      
      .be-chart-center {
        position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
        display: flex; flex-direction: column; align-items: center;
      }
      .center-label { font-size: 10px; color: #999; letter-spacing: 1px; }
      .center-val { font-size: 12px; color: #555; font-weight: 100; margin-top: 2px; }

      .be-donut-segment:hover { stroke-width: 10; }

      .be-legend {
        width: 100%; display: grid; grid-template-columns: 1fr 1fr; gap: 10px;
        border-top: 1px solid rgba(0, 0, 0, 0.05); padding-top: 20px; margin-bottom: 15px;
      }
      .be-legend-item {
        display: flex; align-items: center; cursor: pointer; padding: 4px;
        transition: background 0.2s; border-radius: 2px;
      }
      .be-legend-item:hover { background: rgba(0,0,0,0.03); }
      .legend-dot { width: 8px; height: 8px; border-radius: 50%; margin-right: 8px; }
      .legend-name { font-size: 11px; color: #666; flex: 1; }
      .legend-pct { font-size: 10px; color: #999; }

      .be-footer {
        width: 100%; text-align: center; margin-top: 10px;
      }
      .be-footer-text {
        font-size: 10px; color: #bbb; font-style: italic; letter-spacing: 1px;
      }

      .be-tooltip {
        position: fixed; pointer-events: none; opacity: 0;
        background: rgba(0, 0, 0, 0.7); color: #fff; font-size: 11px;
        padding: 4px 8px; border-radius: 2px; z-index: 10001;
        transition: opacity 0.2s; white-space: nowrap;
      }
    `;
    document.head.appendChild(style);
  }

  // ============================================================================
  // 5. 初始化绑定入口
  // ============================================================================
  function init() {
    injectStyles();

    const triggerEl = document.getElementById('main-date');
    if (!triggerEl) {
      console.warn('存储空间面板初始化失败：未找到 #main-date 元素。');
      return;
    }

    triggerEl.style.cursor = 'pointer';
    triggerEl.addEventListener('click', async e => {
      e.stopPropagation();
      const storageData = await calculateStorageData();
      createPanel(storageData);
    });
  }

  // 执行初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
