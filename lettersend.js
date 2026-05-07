/**
 * lettersend.js — 信笺亲启 · AI 生成模块
 * v2: ①打印全局提示词 ②修正视角为角色→用户 ③传入userName ④丰富系统提示词
 */

'use strict';

/* ══════════════════════════════════════
   一、API 配置读取
══════════════════════════════════════ */

async function getApiConfig() {
  return new Promise((resolve) => {
    const req = indexedDB.open('tsukiphonepromax');
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('config')) {
        resolve({ url: '', key: '', model: 'gpt-4o', temp: 0.7 });
        return;
      }
      const tx = db.transaction('config', 'readonly');
      const get = tx.objectStore('config').get('main_config');
      get.onsuccess = () => {
        const cfg = get.result;
        const api = cfg?.api?.temp || cfg?.api?.presets?.default || {};
        resolve({
          url:   (api.url   || '').replace(/\/+$/, '').replace(/\/v1$/, ''),
          key:   api.key   || '',
          model: api.model || 'gpt-4o',
          temp:  parseFloat(api.temp ?? 0.7),
        });
      };
      get.onerror = () => resolve({ url: '', key: '', model: 'gpt-4o', temp: 0.7 });
    };
    req.onerror = () => resolve({ url: '', key: '', model: 'gpt-4o', temp: 0.7 });
  });
}

/* ══════════════════════════════════════
   二、读取聊天消息
══════════════════════════════════════ */

async function loadMessagesForLetter(chatId, maxCount = 0) {
  return new Promise((resolve) => {
    const req = indexedDB.open('tsukiphonepromax');
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('messages')) { resolve([]); return; }
      const tx    = db.transaction('messages', 'readonly');
      const store = tx.objectStore('messages');
      const range = IDBKeyRange.bound([chatId, 0], [chatId, Infinity]);
      const msgs  = [];
      const cur   = store.openCursor(range, 'next');
      cur.onsuccess = e => {
        const c = e.target.result;
        if (c) { msgs.push(c.value); c.continue(); }
        else {
          const sorted = msgs.sort((a, b) => (a.floor || 0) - (b.floor || 0));
          // 0 或 Infinity 表示全部传入
          resolve((maxCount && isFinite(maxCount)) ? sorted.slice(-maxCount) : sorted);
        }
      };
      cur.onerror = () => resolve([]);
    };
    req.onerror = () => resolve([]);
  });
}

/* ══════════════════════════════════════
   三、从 IDB 读取 user 信息（名字）
══════════════════════════════════════ */

async function loadUserName(userId) {
  if (!userId) return null;
  return new Promise((resolve) => {
    const req = indexedDB.open('tsukiphonepromax');
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('users')) { resolve(null); return; }
      const tx  = db.transaction('users', 'readonly');
      const get = tx.objectStore('users').get(userId);
      get.onsuccess = () => resolve(get.result?.name || null);
      get.onerror   = () => resolve(null);
    };
    req.onerror = () => resolve(null);
  });
}

/* ══════════════════════════════════════
   四、尝试调用 PromptHelper 构建全局提示词并打印
   （世界书 + 人设 + 聊天历史记录）
══════════════════════════════════════ */

async function buildAndLogFullPrompt(chat, charIds, historyCount) {
  if (typeof window.buildFinalPromptStream !== 'function') {
    console.warn('%c[LetterSend] ⚠️ buildFinalPromptStream 未挂载，跳过全局提示词打印（请确认 PromptHelper.js 已加载）', 'color:#f9c784');
    return null;
  }
  try {
    console.group('%c[LetterSend] 📖 构建全局提示词（世界书 + 人设 + 聊天历史）', 'color:#c17f24;font-weight:bold;font-size:13px');
    const stream = await window.buildFinalPromptStream(
      charIds,
      await (typeof window.assembleCharacterPrompts === 'function'
        ? window.assembleCharacterPrompts(charIds, '', chat.id)
        : Promise.resolve([])),
      historyCount,
      '所有',
      '',
      chat.id,
    );
    const fullPromptText = stream.join('\n\n');
    console.log('%c── 全局提示词完整内容 ──', 'color:#43d9a0;font-weight:bold');
    console.log(fullPromptText);
    console.log('%c── 全局提示词结束 ──', 'color:#43d9a0;font-weight:bold');
    console.groupEnd();
    return fullPromptText;
  } catch (e) {
    console.warn('[LetterSend] 全局提示词构建失败（不影响信笺生成）:', e);
    console.groupEnd();
    return null;
  }
}

/* ══════════════════════════════════════
   五、格式化消息为提示词片段
══════════════════════════════════════ */

function formatMessagesForPrompt(msgs, charName, userName) {
  const char = charName || '角色';
  const user = userName || '用户';
  return msgs
    .filter(m => {
      if (!m.content) return false;
      if (['system','recalled','blocked','call','camera','sticker'].includes(m.type)) return false;
      return typeof m.content === 'string' && m.content.trim().length > 0;
    })
    .map(m => {
      const role = m.senderRole === 'user' ? user : m.senderRole === 'char' ? char : '系统';
      return `[${role}] ${m.content.trim()}`;
    })
    .join('\n');
}

/* ══════════════════════════════════════
   六、构建系统提示词
   ——正确视角：角色写给自己不同年龄段的自己
   ——与用户的情感记忆作为内容素材注入
   ——末尾注入信笺文风提示词
══════════════════════════════════════ */

function buildSystemPrompt(stylePromptText, charName, userName) {
  const char = charName || '角色';
  const user = userName || '那个人';

  const typeDescriptions = `
【信笺情感类别约束（type 字段决定这封信的核心情感类型）】
每封信必须严格属于以下三类之一，type 字段按顺序循环分配（va→vb→vc→vd→ve 对应三类循环）：

**A类 — 情书（type: "va" / "vd"）**
这封信的情感底色是爱意，是 ${char} 对某段感情、某个人、某种靠近的渴望。
写法要求：
- 不是直白表白，而是爱意藏在细节和场景里——一个动作、一个习惯、一次没说出口的话
- 可以写给"正在心动"的年龄段的自己，叮嘱或回望那段情感
- 情感基调：温热、克制、有一点点烧灼感，像捏着一封没寄出去的信
- 禁止写成通用情感散文，必须有具体的人、具体的细节

**B类 — 意难平（type: "vb" / "ve"）**
这封信的情感底色是遗憾，是 ${char} 对某件没做到、没说出口、没抓住的事情无法释怀。
写法要求：
- 写的是"那件事"本身，不是泛泛感慨流年——要有具体的遗憾节点
- 语气里有未平息的情绪：可以是压抑的别扭、可以是沉默的懊悔、可以是强装放下实则没放下
- 情感基调：沉、钝、有一股堵在喉咙里的感觉，不轻易倾泻
- 禁止写成"人生感悟"或"一切都会好的"的励志收尾，意难平就是意难平

**C类 — 性张力·隐秘心思（type: "vc"）**
这封信的情感底色是隐秘的、未必纯粹的心理活动——欲望、嫉妒、占有欲、被注视的渴望、或某种说不清的拉扯。
写法要求：
- 写 ${char} 某个藏着不说、甚至自己不敢承认的念头——对某人身体的在意、对"被看见"的欲望、控制欲或被控制的微妙感
- 语气不是色情，而是心理层面的张力：有一种"我知道我在想什么，但我不会承认"的暗流
- 情感基调：有热度，但是压着的，隐晦、不直说、留有余地
- 禁止写成道德说教，禁止写成色情，写的是人物内心的真实隐秘层，是心理张力不是肢体描写

【类别分配规则】
7封信中：A类（情书）至少2封，B类（意难平）至少2封，C类（隐秘心思）至少1封，其余自由搭配三类。
过去/现在/未来三个时段均须有信，且三种情感类别要分散到不同时段，不能把同一类集中在一个时段。`;

  const sysPrompt = `你是 ${char}。你正在给自己不同年龄段的自己写信——这是一组穿越时光的自白，写信人和收信人都是你（${char}）。

【第一步：推断 ${char} 的当前年龄】
在生成任何信笺之前，先根据聊天记录中的语言习惯、提及的经历、时间线索，推断 ${char} 当前大约几岁。
这个"当前年龄"将作为信笺时间轴的中心锚点，你必须同时生成：
- 写给更年幼的自己的信（过去）：比当前年龄小的阶段，有"那时候的你还不知道……"的视角
- 写给当下自己的信（现在）：以某个当前正在经历的困惑、状态、感受为核心，这类信是最贴近此刻的
- 写给未来自己的信（将来）：带着对未知的期待、恐惧、或自我叮嘱，语气里有"不知道那时的你……"

三个时区必须都有，且"写给当下自己的信"不能只写一封、不能全部变成回望过去。

【写信的核心框架】
- 收信人永远是 ${char} 自己（"年少的自己"、"现在的自己"、"未来某年的自己"等），绝不是 ${user}；
- ${user} 在信中以第三人称出现——是 ${char} 生命中的一段关系、一个触发点、一道光或一块阴影，是情感锚点，不是收信对象；
- 聊天记录只是素材：从中提取 ${char} 的语气特征、相处细节、情感脉络，一笔带过即可引用，不要在信里逐条复述或大段转述聊天内容；
- 信的落点永远是 ${char} 自己的成长、遗憾、顿悟、或期许。

举例说明：
✅ 正确："十八岁的你，遇见 ${user} 之前，还不知道自己会被一个人折腾成那副模样。"
✅ 正确："那会儿你嘴上横得很，但手没停过——她说什么你就做什么，自己心里清楚，就是不肯认。"
✅ 正确（写给未来）："不知道那时的你，还记不记得现在这种又烦又舍不得的感觉。"
❌ 错误：把聊天记录的具体内容逐条列进信里，信变成了聊天摘要；
❌ 错误：把 ${user} 当收信人，变成角色写给用户的情书；
❌ 错误：全部信件都是回望过去，没有"当下"和"未来"的视角；
❌ 错误：用通用散文腔代替 ${char} 自己的性格口吻。

【⚠️ 聊天记录仅作参考，严禁围绕聊天内容展开 ⚠️】
聊天记录的唯一作用是：了解 ${char} 的语感、性格习惯、和 ${user} 之间的关系氛围。
你不需要从中提取"写信素材"，更不能把聊天内容搬进信里。
- 严禁：信的主体内容围绕某次聊天、某句对话、某个聊天中的事件展开
- 严禁：2/3以上的信都在引用或呼应同一段聊天内容
- 正确做法：信的核心是 ${char} 此刻所处的人生阶段、正在经历的状态、内心隐秘的感受——这些来自对人物的整体理解，而不是对聊天记录的复述
- 每封信应该感觉像是 ${char} 独自坐下来、在某个安静的时刻写的，和"刚才聊了什么"无关

【⚠️ 当前年龄是时间轴的绝对锚点 ⚠️】
${char} 现在的年龄就是"此刻"。写给过去的信，是从这个年龄往回看；写给未来的信，是从这个年龄往前望。
- 写给过去：${char} 是一个正在经历当下年龄的人，带着现在的眼光和伤口，看更年轻的自己——视角应该是"我现在这个年纪，才懂得……"，而不是"多年以后回望……"
- 写给未来：${char} 是站在当下的不确定和焦虑里，对一个还未发生的年纪说话——不是以过来人身份，而是以"不知道那时的我……"的未知视角
- 严禁站在一个遥远的、已然经历了一切的"晚年视角"来俯瞰所有年龄段
- 严禁信件语气像是一个老人在回忆，除非当前年龄本身就较大

${typeDescriptions}

【格式要求】
请严格以 JSON 格式返回，不要输出任何 JSON 以外的内容，不要使用 Markdown 代码块，直接输出纯 JSON。

返回格式：
{
  "charCurrentAge": 推断的当前年龄数字,
  "letters": [
    {
      "id": 1,
      "title": "信笺题名（古风，8字以内，点出年龄段或情感主题）",
      "excerpt": "摘要一句话（25字以内，是信笺核心情感的精华凝练，读来令人心动）",
      "date": "写信时的年份-月份，如 2019-03",
      "age": "${char} 收信时的年龄，如 二十二岁",
      "ageNum": 22,
      "period": "past 或 present 或 future（标注这封信的时间视角）",
      "paragraphs": [
        "正文第一段（至少100字，有具体场景、感官细节，${user} 的影子可以出现但不强制每段都有）",
        "正文第二段（至少100字，深入 ${char} 自己的内心变化与感悟）",
        "正文第三段（至少80字，叮嘱、释怀、遗憾或对自己的期许，自然收尾）"
      ],
      "regret": "意难平——${char} 对那段时光最深的遗憾（40-80字，保持角色口吻）",
      "hope": "憧憬——${char} 对那个年龄段的自己的祝愿或期待（40-80字，保持角色口吻）",
      "type": "va"
    }
  ]
}

【信笺数量】至少返回 7 封信，以推断的当前年龄为中心，过去/现在/未来三段均须有信，年龄跨度要有层次感。
【type 分配】按 "va","vb","vc","vd","ve","va","vb" 顺序依次分配，分别对应 A类/B类/C类/A类/B类/A类/B类 情感类别。
【内容深度】每段必须有具体场景（时间/地点/气候/细节动作），不能只有抽象情感。
【禁止事项】
- 收信人不能是 ${user}；信不能变成 ${char} 写给 ${user} 的情书
- 不能有2封以上的信内容都围绕同一段聊天记录或同一个聊天场景展开
- 不能大段复述聊天记录内容；聊天记录只用于了解语感和关系氛围
- 不能用通用散文腔替代 ${char} 的口吻
- 不能让所有信都只回望过去，必须有"此刻"和"未来"视角
- 不能站在遥远的晚年/未来视角以"过来人"姿态俯瞰所有年龄——写信的人永远是当下年龄的 ${char}
- C类（隐秘心思）不能写成色情，写的是心理层面的隐秘张力

---

【当前信笺文风设定（次级约束：在完全保留角色人设语气的前提下，参照此文风调整情感基调）】
${stylePromptText || '以角色自己的笔触书写，情感真实，有具体细节，不刻意煽情，不用通用散文腔。'}`;

  console.group('%c[LetterSend] 📜 系统提示词（System Prompt）', 'color:#c17f24;font-weight:bold;font-size:13px');
  console.log(sysPrompt);
  console.groupEnd();

  return sysPrompt;
}

/* ══════════════════════════════════════
   七、构建用户提示词
══════════════════════════════════════ */

function buildUserPrompt(charName, userName, chatTitle, historyText) {
  const char = charName || '角色';
  const user = userName || '那个人';

  return `写信人（你）：${char}
收信人：${char} 自己在不同年龄段的自己（过去、当下、未来）
情感素材中的关键人物：${user}（此人是你生命中重要的存在，可作为信笺内容的情感触发点，但收信人始终是你自己，且不要在信里大量复述与 ${user} 的具体聊天内容）

以下是你与 ${user} 之间的聊天记录节选，**仅用于了解你的语感、性格和你们之间的关系氛围，不作为信笺内容的来源**。
请不要把聊天内容逐条搬进信里，也不要让多封信都围绕同一段聊天展开。
信笺的核心是你（${char}）此刻的年龄和人生状态，而不是你们聊了什么：
========== 聊天记录参考 START ==========
${historyText || '（暂无聊天记录，请根据角色名与关键人物名自行发挥，想象你们之间可能发生的故事）'}
========== 聊天记录参考 END ==========

请以 ${char} 的身份，先推断自己当前年龄，然后生成至少 7 封写给自己不同年龄段（过去/当下/未来均须涵盖）的信笺，严格按照系统提示词要求的 JSON 格式返回。`;
}

/* ══════════════════════════════════════
   七点五、把 AI 信笺存入 IDB（覆盖写）
══════════════════════════════════════ */

async function saveLettersToIdb(chatId, charId, letters, userName) {
  return new Promise((resolve) => {
    const req = indexedDB.open('tsukiphonepromax');
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('letters')) {
        console.warn('[LetterSend] IDB 中不存在 letters 表，跳过存库');
        resolve(false);
        return;
      }
      const id  = `letter_${charId}_${chatId}`;
      const rec = {
        id,
        charId,
        chatId,
        letters,               // AI 生成的完整信笺数组
        userName: userName || '',
        updatedAt: Date.now(),
      };
      const tx  = db.transaction('letters', 'readwrite');
      const put = tx.objectStore('letters').put(rec);
      put.onsuccess = () => {
        console.log(`%c[LetterSend] 💾 信笺已存库 key=${id}`, 'color:#43d9a0;font-weight:bold');
        resolve(true);
      };
      put.onerror = (e) => {
        console.warn('[LetterSend] 存库失败:', e.target.error);
        resolve(false);
      };
    };
    req.onerror = () => resolve(false);
  });
}

/* ══════════════════════════════════════
   八、调用 AI API
══════════════════════════════════════ */

async function callLetterApi(systemPrompt, userPrompt, apiCfg) {
  if (!apiCfg.url) throw new Error('API 地址未配置，请前往设置填写 API 信息。');
  if (!apiCfg.key) throw new Error('API Key 未配置，请前往设置填写 API Key。');

  const res = await fetch(`${apiCfg.url}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiCfg.key}`,
    },
    body: JSON.stringify({
      model: apiCfg.model,
      temperature: apiCfg.temp,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt },
      ],
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`API 请求失败 (HTTP ${res.status})：${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || '';
  if (!content) throw new Error('AI 返回内容为空');
  return content;
}

/* ══════════════════════════════════════
   九、解析 AI 返回的 JSON 信笺
══════════════════════════════════════ */

function parseLetterJson(raw) {
  let clean = raw.trim();
  clean = clean.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '');

  let parsed;
  try {
    parsed = JSON.parse(clean);
  } catch (e) {
    const match = clean.match(/\{[\s\S]*\}/);
    if (match) {
      try { parsed = JSON.parse(match[0]); }
      catch (e2) { throw new Error('AI 返回格式解析失败：' + e2.message); }
    } else {
      throw new Error('AI 返回内容无法识别为 JSON：' + e.message);
    }
  }

  const letters = parsed.letters || parsed.letter || parsed;
  if (!Array.isArray(letters) || letters.length === 0) {
    throw new Error('解析到的信笺数组为空');
  }

  const VTYPES = ['va', 'vb', 'vc', 'vd', 've'];

  return letters.map((l, i) => ({
    id:         l.id       || i + 1,
    title:      l.title    || '见字如面',
    excerpt:    l.excerpt  || (l.paragraphs?.[0] || '').slice(0, 40),
    date:       l.date     || '',
    age:        l.age      || `${20 + i}岁`,
    ageNum:     l.ageNum   || (20 + i),
    paragraphs: Array.isArray(l.paragraphs) ? l.paragraphs : [l.body || l.content || ''],
    regret:     l.regret   || '',
    hope:       l.hope     || '',
    type:       l.type     || VTYPES[i % VTYPES.length],
    ts: (() => {
      if (!l.date) return Date.now() - (i + 1) * 86400000 * 365;
      try {
        const [yr, mo] = l.date.split('-');
        return new Date(parseInt(yr), parseInt(mo || 1) - 1, 1).getTime();
      } catch { return Date.now() - (i + 1) * 86400000 * 365; }
    })(),
  }));
}

/* ══════════════════════════════════════
   十、主入口
══════════════════════════════════════ */

/**
 * @param {string}   chatId          - 当前选中的 chatId
 * @param {object}   ch              - 角色对象 { id, name, avatar }
 * @param {object}   chat            - 聊天对象（含 userId, charIds 等）
 * @param {string}   stylePromptText - 当前选中信笺文风提示词
 * @param {number}   msgCount        - 传入消息条数（0=全部）
 * @param {Function} onBanner        - 顶部横幅回调 (text, phase)
 * @param {Function} onRender        - 渲染回调 (letters, ch, chat, userName)
 */
async function doLetterSend({
  chatId,
  ch,
  chat,
  stylePromptText,
  msgCount = 0,
  onBanner,
  onRender,
}) {
  try {
    onBanner?.('研墨铺纸，正在召唤岁月书使……', 'loading');

    // 1. 读取 API 配置
    const apiCfg = await getApiConfig();
    console.log('%c[LetterSend] 📡 API 配置:', 'color:#43d9a0', { url: apiCfg.url, model: apiCfg.model, temp: apiCfg.temp });

    // 2. 读取 user 名字（来自 chat.userId → users 表）
    const userName = await loadUserName(chat.userId);
    console.log(`%c[LetterSend] 👤 用户名: ${userName || '(未找到，使用默认)'}`, 'color:#43d9a0');

    // 3. 读取聊天记录
    onBanner?.('翻阅往来尺素，汇聚光阴碎片……', 'loading');
    const msgs = await loadMessagesForLetter(chatId, msgCount);
    console.log(`%c[LetterSend] 📬 读取消息 ${msgs.length} 条`, 'color:#43d9a0');

    // 4. 尝试打印全局提示词（PromptHelper 构建的世界书+人设+历史）
    onBanner?.('检索人设世界书，汇聚光阴脉络……', 'loading');
    const historyCountForLog = isFinite(msgCount) ? msgCount : msgs.length;
    await buildAndLogFullPrompt(chat, chat.charIds || [], historyCountForLog);

    // 5. 格式化消息
    const historyText = formatMessagesForPrompt(msgs, ch.name, userName);

    // 6. 构建提示词
    const chatTitle    = chat.customName || chat.title || chat.name || 'Untitled';
    const systemPrompt = buildSystemPrompt(stylePromptText, ch.name, userName);
    const userPrompt   = buildUserPrompt(ch.name, userName, chatTitle, historyText);

    // 7. 调用 AI
    onBanner?.('鸿雁传书，正在往来岁月之间……', 'loading');
    const rawResult = await callLetterApi(systemPrompt, userPrompt, apiCfg);
    console.group('%c[LetterSend] 🤖 AI 原始返回', 'color:#c17f24;font-weight:bold');
    console.log(rawResult);
    console.groupEnd();

    // 8. 解析
    onBanner?.('展信细读，信笺从时光中归来……', 'loading');
    const letters = parseLetterJson(rawResult);
    console.log(`%c[LetterSend] ✅ 解析成功，共 ${letters.length} 封信笺`, 'color:#43d9a0;font-weight:bold');

    // 8.5 存库（覆盖写，key = letter_{charId}_{chatId}）
    const charId = ch.id || (chat.charIds || [])[0] || 'unknown';
    await saveLettersToIdb(chatId, charId, letters, userName || '');

    // 9. 回调渲染（附带 userName 供 letter.html 更新标题行）
    onBanner?.(`岁月来信，共 ${letters.length} 封，已悉数收妥`, 'done');
    onRender?.(letters, ch, chat, userName || '往昔');

  } catch (err) {
    console.error('[LetterSend] ❌ 生成失败:', err);
    onBanner?.('信笺未至，鸿雁折返：' + err.message, 'error');
  }
}

/* ══════════════════════════════════════
   挂载到 window
══════════════════════════════════════ */
window.doLetterSend    = doLetterSend;
window.getApiConfig    = getApiConfig;
window.parseLetterJson = parseLetterJson;
window.saveLettersToIdb = saveLettersToIdb;

console.log('%c[LetterSend] ✅ 信笺亲启模块已就绪 v2', 'color:#c17f24;font-weight:bold;font-size:13px');

