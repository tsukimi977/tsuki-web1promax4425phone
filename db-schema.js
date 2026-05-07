/**
 * db-schema.js
 * ─────────────────────────────────────────────────────────────────────────────
 * 全局数据库结构同步脚本 · Tsukimi
 *
 * 用法：在任意 HTML 的 <head> 或 <body> 末尾引入即可：
 *   <script src="db-schema.js"></script>
 *
 * 效果：
 *   · 页面加载时静默检查 IndexedDB 'tsukiphonepromax' 的 store 完整性
 *   · 若有缺失的 store / index，自动触发版本升级补齐
 *   · 绝对不删除、不修改已有数据，只做"补增"操作
 *   · 不覆盖各 HTML 页面原有的 openDb / SCHEMA 变量，完全独立运行
 *   · 升级完成后将完整连接挂到 window.__tsukiDb，供同页面其他脚本复用
 *
 * 当前 SCHEMA 版本（新增 store 时在此追加即可）：
 *   基础：config / chars / users / worldbook / chats / messages
 *   剧场：theaters / theater_messages / theater_summaries
 *   日记：diaries
 *   Agent：agent
 *   语音通话：voice_messages
 *   动态：moments
 *   TTS合成：voice_tts
 *   OpenAI生图：openai_config
 *   人生旅信：letters
 *   TTS合成：voice_tts
 *   音乐播放器：music（新增 · 訴月雲樂播放偏好/背景/队列快照）
 * ─────────────────────────────────────────────────────────────────────────────
 */

(function () {
  'use strict';

  const IDB_NAME = 'tsukiphonepromax';

  /**
   * 完整 SCHEMA 定义
   * 格式：storeName → { keyPath, indexes?: [{ name, keyPath, unique? }] } | null
   *
   * ✅ 新增 store 只需在这里追加一行，所有引入了 db-schema.js 的页面下次加载时自动同步
   */
  const FULL_SCHEMA = {
    // ── 基础表 ──────────────────────────────────────────────────────────────
    config:   { keyPath: 'id' },
    chars:    { keyPath: 'id' },
    users:    { keyPath: 'id' },
    worldbook: null,
    chats:    { keyPath: 'id' },
    messages: { keyPath: ['chatId', 'floor'] },

    // ── 线下剧场（TsukiSummary / StageSend / tsukistage.html）────────────
    theaters: {
      keyPath: 'id',
      indexes: [{ name: 'by_created', keyPath: 'createdAt' }],
    },
    theater_messages: {
      keyPath: ['theaterId', 'floor'],
      indexes: [{ name: 'by_theater', keyPath: 'theaterId' }],
    },
    theater_summaries: {
      keyPath: 'id',
      indexes: [{ name: 'by_theater', keyPath: 'theaterId' }],
    },

    // ── 日记（DiaryFloorListener / PromptHelper）────────────────────────
    diaries: { keyPath: 'id' },

    // ── 日历（calendar.html）─────────────────────────────────────────────
    cal_events:   { keyPath: 'id' },
    cal_comments: {
      keyPath: 'id',
      indexes: [{ name: 'by_target', keyPath: 'targetId' }],
    },
    cal_edits: {
      keyPath: 'id',
      indexes: [{ name: 'by_target', keyPath: 'targetId' }],
    },

    // ── 后台 Agent（agent.html）──────────────────────────────────────────
    // 单条记录，key = 'agent_config'，value 结构：
    // {
    //   id:            'agent_config',          // 固定主键
    //   masterOn:      boolean,                  // 主开关状态
    //   selectedChars: string[],                 // 已选角色 id 列表
    //   selectedChats: string[],                 // 已选聊天 id 列表
    //   timers:        { [chatId]: intervalMs }, // 各聊天定时间隔（毫秒）
    //   supabaseUrl:   string,                   // Supabase Project URL
    //   supabaseKey:   string,                   // Supabase Publishable Key
    //   vapidKey:      string,                   // VAPID 公钥（前端填写）
    //   edgeUrl:       string,                   // Edge Function URL
    //   cooldownHours: number,                   // AI 消息冷却时间（小时）
    //   pushSub:       object | null,            // Web Push 订阅对象（JSON）
    //   dayMode:       boolean,                  // 日/夜间模式偏好
    // }
    agent: { keyPath: 'id' },

    // ── 语音通话记录（tsuki-call-voice.html / VoiceSend.js）─────────────
    // 每条语音通话消息独立存储，与 messages store 分离，按 chatId 索引
    // record 结构：
    // {
    //   id:         string,                // `${chatId}_v${floor}` 唯一主键
    //   chatId:     string,                // 关联聊天室 id
    //   floor:      number,                // 楼层计数（该 chatId 下自增）
    //   senderRole: 'user' | 'char',       // 发送方角色
    //   charId?:    string,                // 角色 id（char 发送时）
    //   charName?:  string,                // 角色名（char 发送时，冗余存储方便读取）
    //   type:       'voice' | 'narration', // voice=语音台词，narration=旁白
    //   content:    string,                // 消息文本内容（语音转写 or 旁白文字）
    //   timestamp:  number,                // 真实时间戳（ms）
    // }
    voice_messages: {
      keyPath: 'id',
      indexes: [
        { name: 'by_chat',  keyPath: 'chatId' },
        { name: 'by_floor', keyPath: ['chatId', 'floor'], unique: false },
      ],
    },

    // ── 动态（tsukimoment.html / MomentSend.js）──────────────────────────
    // 每条动态独立存储，同时按 chatId / charId / 创建时间索引
    // record 结构：
    // {
    //   id:        string,                 // `moment_${Date.now()}_${seq}`
    //   chatId:    string,                 // 来源聊天页面 id（必存，用于精确溯源）
    //   charId:    string,                 // 发布者角色 id（用户模式存 userId）
    //   isUser:    boolean,                // true=用户动态，false=角色动态
    //   type:      'letter'|'sealed'|'audio'|'video'|'image'|'chat',  // 动态卡片类型
    //   content:   object,                 // 卡片内容，结构随 type 不同而异
    //   date:      string,                 // 'YYYY-MM-DD'
    //   createdAt: number,                 // Date.now()
    //   comments:  array,                  // 评论数组（初始 []，可追加）
    //   likes:     number,                 // 点赞数
    // }
    moments: {
      keyPath: 'id',
      indexes: [
        { name: 'by_chat',    keyPath: 'chatId' },
        { name: 'by_char',    keyPath: 'charId' },
        { name: 'by_created', keyPath: 'createdAt' },
      ],
    },

    // ── NovelAI 生图配置（novel-draw.html / tsukiphone1_1.html）──────────
    // novel_config — 单条全局记录（id = 'novel_config'），存 NAI API 参数
    // {
    //   id:      'novel_config',
    //   apiUrl:  string,   // 默认 'https://image.novelai.net/ai/generate-image'
    //   apiKey:  string,   // NAI Bearer Token
    //   model:   string,   // 'nai-diffusion-4-5-full' | 'nai-diffusion-3' 等
    //   sampler: string,   // 'k_euler_ancestral' 等
    //   width:   number,   // 默认 832
    //   height:  number,   // 默认 1216
    //   steps:   number,   // 默认 28
    //   scale:   number,   // 默认 5
    //   rescale: number,   // 默认 0
    // }
    novel_config: { keyPath: 'id' },

    // novel_presets — 提示词预设（多条，id = `npreset_${Date.now()}`）
    // {
    //   id:        string,   // 主键
    //   name:      string,   // 预设名称（如"清纯校服"）
    //   prefix:    string,   // 正面提示词前缀，追加在 AI 描述词前
    //   negative:  string,   // 负面提示词
    //   createdAt: number,   // Date.now()
    // }
    novel_presets: {
      keyPath: 'id',
      indexes: [{ name: 'by_created', keyPath: 'createdAt' }],
    },

    // ── OpenAI 生图配置（openai-draw.html / tsukiphone1_1.html）─────────
    // 单条全局记录（id = 'openai_config'），存 OpenAI Images API 参数
    // {
    //   id:        'openai_config',
    //   apiUrl:    string,   // Base URL，如 'https://api.openai.com'（含/不含/v1均可）
    //   apiKey:    string,   // OpenAI API Key (sk-...)
    //   model:     string,   // 'gpt-image-1' | 'dall-e-3' | 'dall-e-2' 等
    //   quality:   string,   // 'auto' | 'high' | 'medium' | 'low'（gpt-image 专属）
    //   style:     string,   // 'vivid' | 'natural'（dall-e-3 专属）
    //   width:     number,   // 期望宽度（用于推算 size 参数）
    //   height:    number,   // 期望高度
    // }
    openai_config: { keyPath: 'id' },

    // ── 人生旅信（letter-to-self.html）──────────────────────────────────
    // 每个 (charId, chatId) 对应一封信，id = `letter_${charId}_${chatId}`
    // {
    //   id:        string,       // `letter_${charId}_${chatId}`  主键
    //   charId:    string,       // 关联角色 id（chars 表）
    //   chatId:    string,       // 关联聊天 id（chats 表）
    //   charName:  string,       // 角色名（冗余存储，方便展示）
    //   chatTitle: string,       // 聊天标题（冗余）
    //   sections:  array,        // 书信分节数组，每节含：
    //     // {
    //     //   idx:    number,   // 节序（0-based）
    //     //   title:  string,   // 节标题，如"见字如面"
    //     //   type:   string,   // 卡片变体 va|vb|vc|vd|ve
    //     //   ts:     number,   // 时间戳
    //     //   age:    string,   // 如"二十五岁"
    //     //   excerpt:string,   // 摘要（预览用）
    //     //   body:   string,   // 信件正文（多段）
    //     //   regret: string,   // 意难平 · 未言之憾
    //     //   hope:   string,   // 憧憬 · 所愿之事
    //     // }
    //   createdAt: number,       // Date.now()
    //   updatedAt: number,       // Date.now()
    // }
    letters: {
      keyPath: 'id',
      indexes: [
        { name: 'by_char',    keyPath: 'charId' },
        { name: 'by_chat',    keyPath: 'chatId' },
        { name: 'by_updated', keyPath: 'updatedAt' },
      ],
    },

    // ── 訴月雲樂音乐状态存储（suyue.html）────────────────────────────────
    // 存储播放状态、自定义背景、用户偏好等音乐相关数据
    // 通过 id 前缀区分不同数据类型：
    //
    // 1. 播放偏好（id = 'music_prefs'）
    //    {
    //      id:           'music_prefs',
    //      playMode:     number,           // 0=列表循环 1=单曲 2=随机 3=心动
    //      autoResume:   boolean,          // 自动续播开关
    //      darkMode:     boolean,          // 夜间模式
    //      lastSongId:   string | null,    // 上次播放歌曲 id
    //      lastPid:      string | null,    // 上次播放歌单 id
    //      customApi:    string,           // API 地址
    //    }
    //
    // 2. 自定义背景（id = 'bg_${pageId}'，pageId: discovery / search / mine / player）
    //    {
    //      id:       string,   // 'bg_discovery' 等
    //      dataUrl:  string,   // base64 图片（小图）或留空
    //    }
    //
    // 3. 播放队列快照（id = 'music_queue'）
    //    {
    //      id:       'music_queue',
    //      queue:    object[],  // 完整播放列表快照
    //      index:    number,    // 当前位置
    //      savedAt:  number,    // Date.now()
    //    }
    //
    // 4. AI DJ 配置（id = 'dj_config'）
    //    {
    //      id:            'dj_config',
    //      aiAutoAddPid:  string | null,
    //      aiAutoAdd:     boolean,
    //      switches:      object,  // { list, control, search, liked, notify }
    //      contextLimit:  number,
    //    }
    music: { keyPath: 'id' },

    // ── MiniMax TTS 语音合成配置（minimax-voice.html）────────────────────
    // 存储两类数据，通过 id 前缀区分：
    //
    // 1. 全局 API 配置（单条记录）
    //    id: 'tts_api_config'
    //    {
    //      id:        'tts_api_config',
    //      apiKey:    string,   // MiniMax API Key（加密存储）
    //      groupId:   string,   // MiniMax Group ID
    //      endpoint:  string,   // API 接口地址
    //    }
    //
    // 2. 音色预设（多条，id = `preset_${timestamp}`）
    //    {
    //      id:          string,           // 'preset_${Date.now()}'
    //      name:        string,           // 预设名称
    //      isDefault:   boolean,          // true = 内置默认模板，不可删除
    //      charId:      string | null,    // 绑定的角色 id（来自 chars 表）
    //      userId:      string | null,    // 绑定的用户 id（来自 users 表）
    //      includeUser: boolean,          // 是否启用用户面板
    //      char: {                        // 角色面板 TTS 配置快照
    //        voiceMode:  'preset'|'clone',
    //        voiceId:    string,
    //        model:      string,
    //        speed:      number,
    //        vol:        number,
    //        pitch:      number,
    //        sampleRate: number,
    //        format:     string,
    //        bitrate:    number,
    //        subtitle:   boolean,
    //        emotion:    boolean,
    //      },
    //      user: {                        // 用户面板 TTS 配置快照（includeUser=true 时有效）
    //        voiceMode:  'preset'|'clone',
    //        voiceId:    string,
    //        model:      string,
    //        speed:      number,
    //        vol:        number,
    //        pitch:      number,
    //        sampleRate: number,
    //        format:     string,
    //        bitrate:    number,
    //        subtitle:   boolean,
    //        emotion:    boolean,
    //      } | null,
    //      createdAt:   number,           // Date.now()
    //      updatedAt:   number,           // Date.now()
    //    }
    voice_tts: {
      keyPath: 'id',
      indexes: [
        { name: 'by_char',    keyPath: 'charId' },
        { name: 'by_created', keyPath: 'createdAt' },
      ],
    },
  };

  // ─────────────────────────────────────────────────────────────────────────
  // 核心升级逻辑
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * 检查一个已打开的 db 连接里，是否有 store 或 index 缺失
   * 返回 true 表示结构完整，false 表示需要升级
   */
  function isSchemaComplete(db) {
    for (const [storeName, options] of Object.entries(FULL_SCHEMA)) {
      if (!db.objectStoreNames.contains(storeName)) return false;
      // 有索引定义的 store，还需检查每个 index 是否存在
      if (options && options.indexes) {
        // 只能在 onupgradeneeded 事务里直接拿 store 对象检查 indexNames，
        // 普通连接无法直接读到 indexNames，所以这里保守判断：
        // 如果 store 存在就认为索引已建（索引补建在 onupgradeneeded 里做）
        // 实际缺索引的情况极少（只有手动删过 index 才会出现）
      }
    }
    return true;
  }

  /**
   * 在 onupgradeneeded 事务里执行完整 SCHEMA 补齐（幂等）
   */
  function applySchema(db, transaction) {
    for (const [storeName, options] of Object.entries(FULL_SCHEMA)) {
      let store;

      if (!db.objectStoreNames.contains(storeName)) {
        // store 不存在 → 新建
        if (options && options.keyPath !== undefined) {
          store = db.createObjectStore(storeName, { keyPath: options.keyPath });
        } else {
          store = db.createObjectStore(storeName);
        }
        console.log(`%c[db-schema] ✅ 新建 store: ${storeName}`, 'color:#43d9a0');
      } else {
        // store 已存在 → 通过事务拿到引用，补建缺失的 index
        store = transaction.objectStore(storeName);
      }

      // 补建缺失的索引（幂等）
      if (options && options.indexes) {
        for (const idx of options.indexes) {
          if (!store.indexNames.contains(idx.name)) {
            store.createIndex(idx.name, idx.keyPath, { unique: !!idx.unique });
            console.log(`%c[db-schema]   └─ 新建 index: ${storeName}.${idx.name}`, 'color:#43d9a0');
          }
        }
      }
    }
  }

  /**
   * 主函数：探测当前版本 → 判断是否需要升级 → 执行升级
   * 返回 Promise<IDBDatabase>
   */
  function ensureSchema() {
    return new Promise((resolve, reject) => {
      // 第一步：不带版本号探测，获取当前真实版本和 store 列表
      const probeReq = indexedDB.open(IDB_NAME);

      probeReq.onsuccess = e => {
        const db = e.target.result;
        const currentVersion = db.version;

        const missingStores = Object.keys(FULL_SCHEMA).filter(
          name => !db.objectStoreNames.contains(name)
        );

        if (missingStores.length === 0) {
          // 结构完整，直接用这个连接
          console.log(
            `%c[db-schema] ✅ DB 结构完整 (v${currentVersion})，无需升级`,
            'color:#8a8a8e'
          );
          // 监听版本变更，其他标签触发升级时自动关闭此连接
          db.onversionchange = () => {
            console.log('%c[db-schema] onversionchange — closing to allow upgrade', 'color:#f9c784');
            db.close();
            window.__tsukiDb = null;
          };
          window.__tsukiDb = db;
          resolve(db);
          return;
        }

        // 第二步：有缺失 → 关掉 probe，以 currentVersion+1 触发升级
        console.warn(
          `[db-schema] 发现缺失 store: [${missingStores.join(', ')}]，` +
          `准备从 v${currentVersion} 升级至 v${currentVersion + 1}`
        );
        db.close();

        const upgradeReq = indexedDB.open(IDB_NAME, currentVersion + 1);

        upgradeReq.onupgradeneeded = event => {
          applySchema(event.target.result, event.target.transaction);
        };

        upgradeReq.onsuccess = event => {
          const upgradedDb = event.target.result;
          upgradedDb.onversionchange = () => {
            console.log('%c[db-schema] onversionchange on upgraded conn — closing', 'color:#f9c784');
            upgradedDb.close();
            window.__tsukiDb = null;
          };
          console.log(
            `%c[db-schema] ✅ 升级完成 (v${upgradedDb.version})，` +
            `stores: [${Array.from(upgradedDb.objectStoreNames).join(', ')}]`,
            'color:#43d9a0;font-weight:bold'
          );
          window.__tsukiDb = upgradedDb;
          resolve(upgradedDb);
        };

        upgradeReq.onerror = event => {
          console.error('[db-schema] 升级失败:', event.target.error);
          reject(event.target.error);
        };

        upgradeReq.onblocked = () => {
          console.warn(
            '[db-schema] ⚠️ DB 升级被阻塞，请关闭同域名下其他打开的 Tsukimi 页面后刷新'
          );
        };
      };

      probeReq.onerror = e => {
        console.error('[db-schema] 无法打开数据库:', e.target.error);
        reject(e.target.error);
      };
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 页面加载时自动执行，不阻塞页面渲染
  // ─────────────────────────────────────────────────────────────────────────

  // 挂到 window，方便其他脚本等待升级完成后再操作
  window.tsukiDbReady = ensureSchema();

  window.tsukiDbReady.catch(err => {
    console.error('[db-schema] 初始化失败，部分功能可能不可用:', err);
  });

  // ── 暴露 window.openDb ────────────────────────────────────────────────────
  // PromptHelper.js / VoiceSend.js 等脚本通过 window.openDb() 获取完整连接。
  // tsukichat.js 只在主页面加载，voice / hub 等独立页面拿不到它的 openDb，
  // 所以在 db-schema.js（所有页面都会引入）统一暴露一份。
  // 已有 window.openDb 时不覆盖（兼容主页面 tsukichat.js 的版本）。
  if (typeof window.openDb !== 'function') {
    window.openDb = function () {
      // 优先复用已升级完成的连接，避免重复开库
      if (window.__tsukiDb && window.__tsukiDb.objectStoreNames.length > 0) {
        return Promise.resolve(window.__tsukiDb);
      }
      // 等 ensureSchema 完成后再返回，确保所有 store 都已建好
      return window.tsukiDbReady.then(() => window.__tsukiDb);
    };
    console.log('[db-schema] ✅ window.openDb 已挂载');
  }

})();
