/**
 * Tsukimi 提示词管理调试脚本 - 全链路监控版
 */

const IDB_CONFIG = {
  name: 'tsukiphonepromax',
  stores: {
    chars: 'chars',
    users: 'users',
    chats: 'chats',
    messages: 'messages',
    worldbook: 'worldbook',
  },
};

// ---------------- 基础工具函数 ----------------

async function getDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_CONFIG.name);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function dbGet(storeName, key) {
  if (!key) return null;
  const db = await getDb();
  return new Promise(resolve => {
    try {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch (e) {
      resolve(null);
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
  const triggered = keys.some(key => target.includes(key));
  // console.debug(`[关键词检查] 目标: "${text}", 需求: [${keys}], 结果: ${triggered}`);
  return triggered;
}

/**
 * 辅助工具：通用排序（强制转换数字，防止字符串 "100" 排序失效）
 */
const sortByPriority = (a, b) => Number(b.priority || 100) - Number(a.priority || 100);

function formatTime(ts) {
  const d = new Date(ts);
  const weeks = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  // return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} ${weeks[d.getDay()]} ${ts}`;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} ${weeks[d.getDay()]}`;
}

// ---------------- 核心逻辑 (带详细日志) ----------------

/**
 * 调试版：组装角色人设 (带详细内容日志)
 */
async function assembleCharacterPrompts(ids, latestMessage, chatUserId = null) {
  console.group('%c🧬 [Step 1: 角色与人设组装]', 'color: #00d4ff; font-weight: bold;');
  const charIds = Array.isArray(ids) ? ids : ids ? [ids] : [];
  console.log(`> 待处理角色 IDs:`, charIds);

  let allCharPrompts = [];

  for (const id of charIds) {
    const char = await dbGet(IDB_CONFIG.stores.chars, id);
    if (!char) {
      console.error(`> ❌ 角色 ID [${id}] 在数据库中不存在！`);
      continue;
    }
    console.log(`> ✅ 成功找到角色: ${char.name}`);

    let charSegment = [];
    const wb = char.worldbook || [];

    // ==========================================
    // A. 角色私有世界书 (Pre)
    // ==========================================
    const preWbAll = wb.filter(s => s.type === 'pre' && s.enabled);
    const preWbTriggered = preWbAll.filter(s => isKeywordTriggered(latestMessage, s.keys)).sort(sortByPriority);

    console.log(`  - 📖 角色私有(Pre): 触发 ${preWbTriggered.length} 条`);
    preWbTriggered.forEach(s => {
      const text = `[Memory Shard: ${s.title}]\n${s.content}`;
      console.log(`%c    [拼接 Pre Wb] ->\n${text}`, 'color: #8a8a8e; font-style: italic;');
      charSegment.push(text);
    });

    // ==========================================
    // B. 角色核心人设 (Persona)
    // ==========================================
    const nameInfo = char.remark ? `${char.name} (备注: ${char.remark})` : char.name;
    const nameStr = `[Character Identification]\nName: ${nameInfo}`;
    console.log(`%c    [拼接 角色身份] ->\n${nameStr}`, 'color: #d4ff4d;');
    charSegment.push(nameStr);

    if (char.persona) {
      const personaStr = `[Character Persona]\n${char.persona}`;
      console.log(`%c    [拼接 核心人设] ->\n${personaStr}`, 'color: #d4ff4d;');
      charSegment.push(personaStr);
    }

    // ==========================================
    // C. 角色自带的绑定用户 (Owner)
    // ==========================================
    if (char.bindId) {
      const charUser = await dbGet(IDB_CONFIG.stores.users, char.bindId);
      if (charUser) {
        const ownerStr = `[Character Owner: ${charUser.name}]\nOwner Persona: ${charUser.persona || 'None'}`;
        console.log(`%c    [拼接 绑定主人] ->\n${ownerStr}`, 'color: #ff9f43;');
        charSegment.push(ownerStr);
      }
    }

    // ==========================================
    // D. 角色私有世界书 (Post)
    // ==========================================
    const postWbAll = wb.filter(s => s.type === 'post' && s.enabled);
    const postWbTriggered = postWbAll.filter(s => isKeywordTriggered(latestMessage, s.keys)).sort(sortByPriority);

    console.log(`  - 📖 角色私有(Post): 触发 ${postWbTriggered.length} 条`);
    postWbTriggered.forEach(s => {
      const text = `[Author Notes: ${s.title}]\n${s.content}`;
      console.log(`%c    [拼接 Post Wb] ->\n${text}`, 'color: #8a8a8e; font-style: italic;');
      charSegment.push(text);
    });

    allCharPrompts.push(...charSegment);
  }

  // E. 聊天室活跃用户处理 (Active User)
  if (chatUserId) {
    const activeUser = await dbGet(IDB_CONFIG.stores.users, chatUserId);
    if (activeUser) {
      const activeUserStr = `[Active User in Chat: ${activeUser.name}]\nUser Persona: ${activeUser.persona || 'No persona.'}`;
      console.log(`%c  - 👤 [拼接 活跃用户] ->\n${activeUserStr}`, 'color: #ff9f43;');
      allCharPrompts.push(activeUserStr);
    }
  }

  console.log(`> Step 1 完成，共生成 ${allCharPrompts.length} 个提示词分片`);
  console.groupEnd();
  return allCharPrompts;
}

/**
 * 调试版：组装最终提示词流 (带详细内容日志)
 */
async function buildFinalPromptStream(
  charIds,
  personaPrompts = [],
  historyCount = 0,
  category = '所有',
  latestMessage = '',
  chatId = null,
) {
  console.group('%c🏗️ [Step 2: 全局流组装]', 'color: #ffa500; font-weight: bold;');
  const db = await getDb();
  const finalStream = [];
  const cIds = Array.isArray(charIds) ? charIds : charIds ? [charIds] : [];

  async function getGlobalWb(key) {
    const data = await dbGet(IDB_CONFIG.stores.worldbook, key);
    return Array.isArray(data) ? data : [];
  }

  // 辅助函数：过滤并打印世界书内容
  const pushWbWithLog = (list, label) => {
    const filtered = list
      .filter(
        item =>
          item.enabled &&
          (!item.category || item.category === '所有' || item.category === category) &&
          isKeywordTriggered(latestMessage, item.keys),
      )
      .sort(sortByPriority);

    console.log(`  - [${label}] 触发: ${filtered.length} 条`);
    filtered.forEach(item => {
      console.log(`%c    [注入 ${label} 内容] ->\n${item.content}`, 'color: #a78bfa;');
      finalStream.push(item.content);
    });
  };

  // 1-3. 全局世界书
  pushWbWithLog(await getGlobalWb('wb_pre'), '头部(Pre)');
  pushWbWithLog(await getGlobalWb('wb_mid'), '中部(Mid)');
  pushWbWithLog(await getGlobalWb('wb_global'), '全局(Global)');

  // 4. 插入人设
  console.log(`  - [人设分片] 准备注入 ${personaPrompts.length} 个块`);
  personaPrompts.forEach((p, idx) => {
    console.log(`%c    [注入 人设块 ${idx + 1}] ->\n${p}`, 'color: #5b7cfa;');
    finalStream.push(p);
  });

  // 5. 局部世界书
  const localWbList = await getGlobalWb('wb_local');
  const filteredLocal = localWbList
    .filter(item => {
      const boundIds = Array.isArray(item.charIds) ? item.charIds : item.charIds ? [item.charIds] : [];
      return item.enabled && cIds.some(id => boundIds.includes(id)) && isKeywordTriggered(latestMessage, item.keys);
    })
    .sort(sortByPriority);

  console.log(`  - [局部(Local)] 触发: ${filteredLocal.length} 条`);
  filteredLocal.forEach(item => {
    console.log(`%c    [注入 局部 Wb] ->\n${item.content}`, 'color: #a78bfa;');
    finalStream.push(item.content);
  });

  // 6. 聊天历史
  if (chatId) {
    console.log(`  - [历史记录] 拉取 ${historyCount} 条...`);
    const chatHistory = await buildChatHistoryPrompt(chatId, historyCount);
    if (chatHistory.length > 0) {
      finalStream.push(`\n========== CHAT HISTORY START ==========`);
      console.log(`%c    [注入 历史记录块] ->\n${chatHistory.join('\n')}`, 'color: #43d9a0;');
      finalStream.push(...chatHistory);
      finalStream.push(`========== CHAT HISTORY END ==========\n`);
    } else {
      finalStream.push(`\n[System: No chat history.]\n`);
    }
  }

  // 7. 尾部世界书
  pushWbWithLog(await getGlobalWb('wb_post'), '尾部(Post)');

  console.log(`%c> Step 2 完成，最终交付流共 ${finalStream.length} 个分片`, 'color: #00ff00;');
  console.groupEnd();
  return finalStream;
}

// buildChatHistoryPrompt 保持你最新的修复逻辑即可...
// async function buildChatHistoryPrompt(chatId, historyCount = 0) {
//   const db = await getDb();
//   let historyPrompts = [];
//   const chat = await dbGet(IDB_CONFIG.stores.chats, chatId);
//   if (!chat) return [];

//   const user = await dbGet(IDB_CONFIG.stores.users, chat.userId);
//   const userName = user ? user.name : 'User';
//   const char = await dbGet(IDB_CONFIG.stores.chars, chat.charIds[0]);
//   const charName = char ? char.name : 'Char';

//   const messages = await new Promise(res => {
//     try {
//       const tx = db.transaction(IDB_CONFIG.stores.messages, 'readonly');
//       const store = tx.objectStore(IDB_CONFIG.stores.messages);
//       const req = store.getAll(); // 简单起见，调试时拉取全量过滤
//       req.onsuccess = () => res((req.result || []).filter(m => m.chatId === chatId));
//       req.onerror = () => res([]);
//     } catch (e) {
//       res([]);
//     }
//   });

//   let targetMessages = messages.sort((a, b) => a.floor - b.floor);
//   if (historyCount > 0) targetMessages = targetMessages.slice(-historyCount);

//   for (const msg of targetMessages) {
//     let senderName = msg.senderRole === 'user' ? userName : msg.senderRole === 'char' ? charName : '系统';
//     let content = msg.content;
//     // 🌟 针对文件类型的特殊处理：拆包并读取文本内容
//     if (msg.type === 'file' && content && content.files) {
//       let fileDetails = [];
//       for (const f of content.files) {
//         let fileStr = `[文件名: ${f.name}]`;

//         // 检查是否是文本类文件，并且 blob 确实存在
//         const isTextFile =
//           f.type.includes('text') || f.type.includes('json') || f.name.endsWith('.txt') || f.name.endsWith('.md');

//         if (isTextFile && f.blob instanceof Blob) {
//           try {
//             // 核心提取：将 Blob 读取为真实文本！
//             const textContent = await f.blob.text();
//             fileStr += `\n--- ${f.name} 内容开始 ---\n${textContent}\n--- ${f.name} 内容结束 ---`;
//           } catch (e) {
//             fileStr += `\n(读取文件内容失败)`;
//           }
//         } else {
//           fileStr += `\n(非文本文件或无文本内容，无法直接读取)`;
//         }
//         fileDetails.push(fileStr);
//       }
//       content = fileDetails.join('\n\n');
//     }
//     // 其他对象类型（如图文、位置等）正常转字符串
//     else if (typeof content === 'object') {
//       content = JSON.stringify(content);
//     }
//     historyPrompts.push(`[${senderName}|${formatTime(msg.timestamp)}|${msg.type}] ${content}`);
//   }
//   return historyPrompts;
// }

async function buildChatHistoryPrompt(chatId, historyCount = 0) {
  const db = await getDb();
  let historyPrompts = [];
  const chat = await dbGet(IDB_CONFIG.stores.chats, chatId);
  if (!chat) return [];

  const user = await dbGet(IDB_CONFIG.stores.users, chat.userId);
  const userName = user ? user.name : 'User';
  const char = await dbGet(IDB_CONFIG.stores.chars, chat.charIds[0]);
  const charName = char ? char.name : 'Char';

  const messages = await new Promise(res => {
    try {
      const tx = db.transaction(IDB_CONFIG.stores.messages, 'readonly');
      const store = tx.objectStore(IDB_CONFIG.stores.messages);
      const req = store.getAll(); // 简单起见，调试时拉取全量过滤
      req.onsuccess = () => res((req.result || []).filter(m => m.chatId === chatId));
      req.onerror = () => res([]);
    } catch (e) {
      res([]);
    }
  });

  let targetMessages = messages.sort((a, b) => a.floor - b.floor);
  if (historyCount > 0) targetMessages = targetMessages.slice(-historyCount);

  for (const msg of targetMessages) {
    let senderName = msg.senderRole === 'user' ? userName : msg.senderRole === 'char' ? charName : '系统';
    let content = msg.content;
    let msgType = msg.type; // 提取出来，因为可能会修正类型（如 call 转为 voice_call）

    // 🌟 针对文件类型的特殊处理：拆包并读取文本内容
    if (msgType === 'file' && content && content.files) {
      let fileDetails = [];
      for (const f of content.files) {
        let fileStr = `[文件名: ${f.name}]`;

        // 检查是否是文本类文件，并且 blob 确实存在
        const isTextFile =
          f.type.includes('text') || f.type.includes('json') || f.name.endsWith('.txt') || f.name.endsWith('.md');

        if (isTextFile && f.blob instanceof Blob) {
          try {
            // 核心提取：将 Blob 读取为真实文本！
            const textContent = await f.blob.text();
            fileStr += `\n--- ${f.name} 内容开始 ---\n${textContent}\n--- ${f.name} 内容结束 ---`;
          } catch (e) {
            fileStr += `\n(读取文件内容失败)`;
          }
        } else {
          fileStr += `\n(非文本文件或无文本内容，无法直接读取)`;
        }
        fileDetails.push(fileStr);
      }
      content = fileDetails.join('\n\n');
    }
    // 🌟 核心修改：针对其他对象类型，严格按照 Prompt 规则拆解为自然字符串！禁止传 JSON！
    else if (content && typeof content === 'object') {
      if (msgType === 'voice') {
        content = content.transcript || '';
      } else if (msgType === 'image') {
        content = content.text || '';
      } else if (msgType === 'transfer') {
        content = `${content.amount || '0.00'}|${content.note || ''}`;
      } else if (msgType === 'location') {
        content = content.location || '';
      } else if (msgType === 'gift') {
        content = `${content.item || ''}|${content.note || ''}`;
      } else if (msgType === 'sticker') {
        // 🌟🌟🌟 表情包“断头”修复逻辑 🌟🌟🌟

        // 1. 清洗名字：把名字里误入的 "https" 砍掉
        let rawName = content.name || '表情包';
        let cleanName = rawName
          .split(/http/i)[0]
          .replace(/[:：|]\s*$/, '')
          .replace(/\.(jpg|jpeg|gif|png|webp)$/i, '')
          .trim();

        // 2. 修复 URL：如果数据库里存的是 // 开头，强行补齐 https:
        let stickerUrl = content.url || '';
        if (stickerUrl.startsWith('//')) {
          stickerUrl = 'https:' + stickerUrl;
        }

        // 3. 拼接给 AI：名字|完整URL
        if (stickerUrl) {
          content = `${cleanName}|${stickerUrl}`;
        } else {
          content = cleanName;
        }
      } else if (msgType === 'call') {
        // 修正数据库里的 call 类型，使其对齐 prompt 里的 voice_call / video_call
        msgType = content.callType === 'video' ? 'video_call' : 'voice_call';
        content = content.callType === 'video' ? '视频通话邀请' : '语音通话邀请';
      } else if (msgType === 'camera') {
        content = `[发送了${content.urls?.length || 0}张照片]`;
      } else {
        // 如果遇到未知的特殊对象兜底
        try {
          content = JSON.stringify(content);
        } catch (e) {
          content = '';
        }
      }
    }

    // 🌟 严格按照你要求的格式拼接作为历史记录传给 AI
    // 格式：[角色/用户名/系统消息|时间|消息类别] 消息完整内容
    historyPrompts.push(`[${senderName}|${formatTime(msg.timestamp)}|${msgType}] ${content}`);
  }

  return historyPrompts;
}

// async function buildChatHistoryPrompt(chatId, historyCount = 0) {
//   const db = await getDb();
//   let historyPrompts = [];
//   const chat = await dbGet(IDB_CONFIG.stores.chats, chatId);
//   if (!chat) return [];

//   const user = await dbGet(IDB_CONFIG.stores.users, chat.userId);
//   const userName = user ? user.name : 'User';
//   const char = await dbGet(IDB_CONFIG.stores.chars, chat.charIds[0]);
//   const charName = char ? char.name : 'Char';

//   const messages = await new Promise(res => {
//     try {
//       const tx = db.transaction(IDB_CONFIG.stores.messages, 'readonly');
//       const store = tx.objectStore(IDB_CONFIG.stores.messages);
//       const req = store.getAll();
//       req.onsuccess = () => res((req.result || []).filter(m => m.chatId === chatId));
//       req.onerror = () => res([]);
//     } catch (e) {
//       res([]);
//     }
//   });

//   let targetMessages = messages.sort((a, b) => a.floor - b.floor);
//   if (historyCount > 0) targetMessages = targetMessages.slice(-historyCount);

//   for (const msg of targetMessages) {
//     let senderName = msg.senderRole === 'user' ? userName : msg.senderRole === 'char' ? charName : '系统';
//     let content = msg.content;
//     let msgType = msg.type;

//     // 1. 针对文件类型的特殊处理 (保持不变)
//     if (msgType === 'file' && content && content.files) {
//       let fileDetails = [];
//       for (const f of content.files) {
//         let fileStr = `[文件名: ${f.name}]`;
//         const isTextFile =
//           f.type.includes('text') || f.type.includes('json') || f.name.endsWith('.txt') || f.name.endsWith('.md');
//         if (isTextFile && f.blob instanceof Blob) {
//           try {
//             const textContent = await f.blob.text();
//             fileStr += `\n--- ${f.name} 内容开始 ---\n${textContent}\n--- ${f.name} 内容结束 ---`;
//           } catch (e) {
//             fileStr += `\n(读取文件内容失败)`;
//           }
//         } else {
//           fileStr += `\n(非文本文件，无法读取内容)`;
//         }
//         fileDetails.push(fileStr);
//       }
//       content = fileDetails.join('\n\n');
//     }

//     // 2. 🌟 核心修改：针对对象类型，将原始数据展开为字符串
//     else if (content && typeof content === 'object') {
//       if (msgType === 'camera') {
//         // 【核心修复】：展开多张照片的原始 URL/Base64 内容
//         if (content.urls && Array.isArray(content.urls)) {
//           content = content.urls.map((url, index) => `[图片内容${index + 1}: ${url}]`).join('\n');
//         } else {
//           content = `[无照片数据]`;
//         }
//       } else if (msgType === 'image') {
//         // 图文卡片：包含描述文字 + 原始图片链接/数据
//         const textPart = content.text ? `(描述: ${content.text}) ` : '';
//         const dataPart = content.url ? `[图片内容: ${content.url}]` : '[无图片数据]';
//         content = textPart + dataPart;
//       } else if (msgType === 'voice') {
//         content = content.transcript || '';
//       } else if (msgType === 'transfer') {
//         content = `${content.amount || '0.00'}|${content.note || ''}`;
//       } else if (msgType === 'location') {
//         content = content.location || '';
//       } else if (msgType === 'gift') {
//         content = `${content.item || ''}|${content.note || ''}`;
//       } else if (msgType === 'sticker') {
//         content = content.name || '';
//       } else if (msgType === 'call') {
//         msgType = content.callType === 'video' ? 'video_call' : 'voice_call';
//         content = content.callType === 'video' ? '视频通话邀请' : '语音通话邀请';
//       } else {
//         // 兜底：如果还有其他未知对象，转为字符串但不使用复杂的 JSON 格式
//         try {
//           content = JSON.stringify(content);
//         } catch (e) {
//           content = '[数据解析失败]';
//         }
//       }
//     }

//     // 格式化输出：[角色|时间|类别] 内容
//     historyPrompts.push(`[${senderName}|${formatTime(msg.timestamp)}|${msgType}] ${content}`);
//   }

//   return historyPrompts;
// }

/**
 * ── 调试启动 ──
 */
(async function initAndDebug() {
  console.clear();
  console.log('%c🚀 [Tsukimi] 开启调试模式...', 'font-size: 20px; font-weight: bold;');

  try {
    const db = await getDb();
    const allChats = await new Promise(res => {
      const tx = db.transaction(IDB_CONFIG.stores.chats, 'readonly');
      const req = tx.objectStore(IDB_CONFIG.stores.chats).getAll();
      req.onsuccess = () => res(req.result || []);
    });

    if (allChats.length === 0) return console.error('无聊天数据');

    // 💡 智能过滤：为了防止再踩到“幽灵”聊天室的坑，我们找一个确保 charIds 有效的聊天室
    const targetChat = allChats.sort((a, b) => b.updatedAt - a.updatedAt)[0];
    const mockMsg = '测试一下 pre1 和 aft2 关键词能不能触发';

    // ✅ 新增参数：将 targetChat.userId 传进去
    const personaResults = await assembleCharacterPrompts(targetChat.charIds, mockMsg, targetChat.userId);

    // 运行 Step 2
    const finalPrompts = await buildFinalPromptStream(
      targetChat.charIds,
      personaResults,
      10,
      'Online',
      mockMsg,
      targetChat.id,
    );

    console.log('%c══════════ FINAL OUTPUT ══════════', 'color: #d4ff4d; font-weight: bold;');
    finalPrompts.forEach((p, i) => console.log(`[#${i + 1}]`, p));
  } catch (err) {
    console.error('致命错误:', err);
  }
})();
