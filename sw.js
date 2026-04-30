// sw.js — TSUKIMI Push Service Worker v3（云端 AI 生成架构）
// 云端 Edge Function 已完成 AI 生成并写入 cloud_offline_messages
// SW 收到 push 后：
//   · 直接用 payload 里的内容弹通知（无需页面在线）
//   · 同时 postMessage 通知前端页面拉取收件箱写入 IDB

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

// ── 头像缓存读取 ──────────────────────────────────────────────────
async function resolveIcon(charName) {
  try {
    const cache = await caches.open('tsukimi-avatar-cache');
    const key = `/tsukimi-avatar/${encodeURIComponent(charName || '')}`;
    const cached = await cache.match(key);
    if (cached) return key;
  } catch {}
  return './icon-192.png';
}

// ── Push 事件处理 ──────────────────────────────────────────────────
self.addEventListener('push', e => {
  let d = { messages: null, title: '✨ 新消息', body: '', icon: '', chatId: '', count: 1 };
  if (e.data) {
    try { d = { ...d, ...e.data.json() }; }
    catch { d.body = e.data.text() || d.body; }
  }

  console.log('[SW·push] 收到 push，type=' + d.type + ' count=' + d.count + ' chatId=' + d.chatId);
  console.log('[SW·push] messages 数组长度=' + (Array.isArray(d.messages) ? d.messages.length : '(无数组)'));

  e.waitUntil((async () => {

    // ── 通知所有前端窗口去拉收件箱 ──────────────────────────────────
    try {
      const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
      console.log('[SW·push] 找到前端窗口数=' + clients.length);
      for (const c of clients) {
        c.postMessage({ type: 'offline_messages_ready', payload: d });
      }
    } catch(err) {
      console.log('[SW·push] postMessage 失败: ' + err);
    }

    // ── 展开 messages 数组为多条通知 ────────────────────────────────
    const msgs = Array.isArray(d.messages) && d.messages.length
      ? d.messages
      : [{ title: d.title || '✨ 新消息', body: d.body || '点击查看', icon: d.icon || './icon-192.png' }];

    console.log('[SW·push] 准备展示通知条数=' + msgs.length);

    const baseTs = Date.now();
    const NOTIF_DELAY_MS = 1500; // 每条通知间隔 1.5 秒

    // 串行发出，每条间隔 NOTIF_DELAY_MS，保证通知逐条弹出而不是同时堆叠
    for (let i = 0; i < msgs.length; i++) {
      const msg = msgs[i];
      const title = msg.title || '✨ 新消息';
      const body  = msg.body  || '点击查看';

      let icon = './icon-192.png';
      if (msg.icon && !msg.icon.startsWith('data:')) {
        icon = msg.icon;
      } else {
        icon = await resolveIcon(title);
      }

      // 每条用独立 tag（chatId + 基准时间戳 + 序号），保证互不覆盖
      const tag = 'tsukimi-' + (d.chatId || 'default') + '-' + baseTs + '-' + i;

      console.log('[SW·push] 发起第' + (i+1) + '条通知 tag=' + tag + ' title=' + title + ' body=' + body.slice(0, 30));
      try {
        await self.registration.showNotification(title, {
          body,
          icon,
          badge: './icon-192.png',
          tag,
          renotify: true,
          vibrate: [200, 80, 200],
          data: d,
        });
        console.log('[SW·push] ✓ 第' + (i+1) + '条通知已发出');
      } catch(err) {
        console.log('[SW·push] ✗ 第' + (i+1) + '条通知失败: ' + err);
      }

      // 最后一条不需要等待
      if (i < msgs.length - 1) {
        await new Promise(resolve => setTimeout(resolve, NOTIF_DELAY_MS));
      }
    }
    console.log('[SW·push] 全部通知处理完毕');

  })());
});

// ── 通知点击 ──────────────────────────────────────────────────────
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const notifData = e.notification.data || {};

  e.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window' });

    if (clients.length) {
      const c = clients[0];
      await c.focus();
      // 告诉页面去拉收件箱
      c.postMessage({ type: 'offline_messages_ready', payload: notifData });
    } else {
      // 没有打开的窗口：带参数打开，页面启动后检测到 heartbeat=1 自动拉收件箱
      await self.clients.openWindow('./?heartbeat=1');
    }
  })());
});
