/* ═══════════════════════════════════════════════════════════════
   AUTH.JS  —  Tsukimi Cloud Login System  v2.0
   挂载：在 index.html </body> 前加 <script src="auth.js"></script>
═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const SB_URL    = 'https://kgyyoougfupjbgrgebqh.supabase.co';
  const SB_KEY    = 'sb_publishable_2ZJJB1buKLoLWLPZ3sHOug_mhmsvd8s';
  const IDB_NAME  = 'tsukiphonepromax';
  const CS        = 'config';
  const K = { dur:'auth_play_duration', code:'auth_browser_code', qq:'auth_logged_in_qq', last_dur:'auth_last_play_duration' };

  let timer=null, idle=null, counting=false, me=null;

  /* ── 立即注入加载遮罩，防止 auth 检查完成前用户操作页面 ── */
  (function _initMask(){
    const mask = document.createElement('div');
    mask.id = '_auth_mask';
    mask.style.cssText = [
      'position:fixed','inset:0','z-index:2147483647',
      'background:#0d0d0d','display:flex','align-items:center',
      'justify-content:center','flex-direction:column','gap:14px',
      'font-family:"Geist Mono",monospace'
    ].join(';');
    mask.innerHTML = `
      <svg width="28" height="26" viewBox="0 0 28 26" fill="none" xmlns="http://www.w3.org/2000/svg"
        style="animation:_mask_hb 2s ease-in-out infinite;">
        <path d="M14 23.5C14 23.5 2 15.5 2 8.5C2 5.2 4.7 2.5 8 2.5C10.2 2.5 12.1 3.7 13.1 5.4C13.5 6.1 14.5 6.1 14.9 5.4C15.9 3.7 17.8 2.5 20 2.5C23.3 2.5 26 5.2 26 8.5C26 15.5 14 23.5 14 23.5Z"
          stroke="#ffffff" stroke-width="2.2" fill="none" stroke-linejoin="round"/>
        <path d="M14 20.5C14 20.5 4.5 13.8 4.5 8.5C4.5 6.6 6.1 5 8 5C9.6 5 11 5.9 11.8 7.3C12.7 8.9 15.3 8.9 16.2 7.3C17 5.9 18.4 5 20 5C21.9 5 23.5 6.6 23.5 8.5C23.5 13.8 14 20.5 14 20.5Z"
          stroke="#f9a8d4" stroke-width="1.8" fill="none"/>
      </svg>
      <span style="font-size:9px;letter-spacing:.2em;color:rgba(255,255,255,.35);">TSUKI · 验证中...</span>
      <style>@keyframes _mask_hb{0%,100%{transform:scale(1);}50%{transform:scale(1.15);}}</style>
    `;
    // DOM 可能还没 body，等 DOMContentLoaded 再挂
    function _mount(){
      if(document.body){ document.body.appendChild(mask); }
      else { document.addEventListener('DOMContentLoaded', ()=>document.body.appendChild(mask), {once:true}); }
    }
    _mount();
  })();
  function _removeMask(){ document.getElementById('_auth_mask')?.remove(); }

  /* ── Supabase ── */
  async function sb(path,method='GET',body=null,xh={}) {
    const r = await fetch(`${SB_URL}/rest/v1/${path}`,{
      method,
      headers:{'apikey':SB_KEY,'Authorization':'Bearer '+SB_KEY,
        'Content-Type':'application/json','Prefer':'return=representation',...xh},
      body:body?JSON.stringify(body):null
    });
    const t=await r.text();
    try{return{ok:r.ok,status:r.status,data:t?JSON.parse(t):null};}
    catch{return{ok:r.ok,status:r.status,data:t};}
  }

  /* ── IndexedDB ── */
  function openDB(){
    return new Promise((res,rej)=>{
      const q=indexedDB.open(IDB_NAME);
      q.onsuccess=e=>res(e.target.result);
      q.onerror=e=>rej(e.target.error);
      q.onupgradeneeded=e=>{
        const db=e.target.result;
        if(!db.objectStoreNames.contains(CS)) db.createObjectStore(CS,{keyPath:'id'});
      };
    });
  }
  async function iGet(k){const db=await openDB();return new Promise((res,rej)=>{const tx=db.transaction(CS,'readonly'),r=tx.objectStore(CS).get(k);r.onsuccess=e=>res(e.target.result?.value??null);r.onerror=e=>rej(e.target.error);});}
  async function iSet(k,v){const db=await openDB();return new Promise((res,rej)=>{const tx=db.transaction(CS,'readwrite');tx.objectStore(CS).put({id:k,value:v});tx.oncomplete=res;tx.onerror=e=>rej(e.target.error);});}
  async function iDel(k){const db=await openDB();return new Promise((res,rej)=>{const tx=db.transaction(CS,'readwrite');tx.objectStore(CS).delete(k);tx.oncomplete=res;tx.onerror=e=>rej(e.target.error);});}

  /* ── helpers ── */
  function genPwd(qq){
    const C='ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    let h=0,s=String(qq)+'tsukiSalt_7x9q';
    for(let i=0;i<s.length;i++){h=((h<<5)-h)+s.charCodeAt(i);h|=0;}
    let r='',hh=Math.abs(h);
    for(let i=0;i<8;i++){r+=C[hh%C.length];hh=Math.abs((hh*1664525+1013904223)|0);}
    return r;
  }
  function genCode(){
    /* 仅使用不随浏览器更新变化的稳定硬件/地区信息，去除 UserAgent */
    const raw=[
      screen.width+'x'+screen.height,
      screen.colorDepth,
      navigator.language,
      Intl.DateTimeFormat().resolvedOptions().timeZone,
      navigator.hardwareConcurrency||0,
      navigator.platform||''
    ].join('|');
    let h=5381;for(let i=0;i<raw.length;i++)h=((h<<5)+h)^raw.charCodeAt(i);
    h=Math.abs(h);const L='ABCDEFGHJKLMNPQRSTUVWXYZ';let c='';
    for(let i=0;i<6;i++){c+=L[h%L.length];h=Math.floor(h/L.length)||(h+1);}
    return c;
  }
  function fmtSec(s){const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),ss=s%60;if(h>0)return`${h}小时${m}分`;if(m>0)return`${m}分${ss}秒`;return`${ss}秒`;}
  function fmtRem(exp){const d=Math.max(0,Math.floor((new Date(exp)-Date.now())/1000)),dv=Math.floor(d/86400),hv=Math.floor((d%86400)/3600);if(dv>0)return`${dv}天${hv}小时`;return fmtSec(d);}
  function parseDate8(c){if(!/^\d{8}$/.test(c))return null;const y=new Date().getFullYear(),MM=c.slice(0,2),DD=c.slice(2,4),HH=c.slice(4,6),mm=c.slice(6,8);const d=new Date(`${y}-${MM}-${DD}T${HH}:${mm}:00`);return isNaN(d)?null:d.toISOString();}
  function expired(e){return new Date(e)<new Date();}
  async function clearSess(){await iDel(K.qq);}
  function nowDate(){const n=new Date();return`${n.getFullYear()}.${String(n.getMonth()+1).padStart(2,'0')}.${String(n.getDate()).padStart(2,'0')}`;}

  /* ── Toast ── */
  let _tt=null;
  function toast(msg,type='info',dur=3500){
    let el=document.getElementById('_atoast');
    if(!el){el=document.createElement('div');el.id='_atoast';document.body.appendChild(el);}
    const base=`position:fixed;bottom:20px;left:50%;transform:translateX(-50%) translateY(8px);
      z-index:9999999;padding:6px 14px;font-size:10px;font-weight:700;
      font-family:'Geist Mono',monospace;letter-spacing:.08em;
      opacity:0;transition:all .22s cubic-bezier(.22,1,.36,1);pointer-events:none;
      max-width:90vw;text-align:center;white-space:nowrap;`;
    /* 黑粉/黑白风格：全部用黑底，用粉色或白色区分类型 */
    const T={
      success:'background:#111;color:#f9a8d4;border:1.5px solid #f9a8d4;box-shadow:2px 2px 0 #f9a8d4;',
      error:  'background:#111;color:#fff;border:1.5px solid #fff;box-shadow:2px 2px 0 rgba(255,255,255,.4);',
      warn:   'background:#111;color:#f9a8d4;border:1.5px solid rgba(249,168,212,.5);box-shadow:2px 2px 0 rgba(249,168,212,.3);',
      info:   'background:#111;color:rgba(255,255,255,.7);border:1.5px solid rgba(255,255,255,.2);box-shadow:2px 2px 0 rgba(255,255,255,.15);',
    };
    el.style.cssText=base+(T[type]||T.info);
    el.textContent=msg;
    requestAnimationFrame(()=>{el.style.opacity='1';el.style.transform='translateX(-50%) translateY(0)';});
    clearTimeout(_tt);_tt=setTimeout(()=>{el.style.opacity='0';el.style.transform='translateX(-50%) translateY(8px)';},dur);
  }

  /* ── 悬浮球 ── */
  function createOrb(user){
    ['_aorb','_aorb_panel','_aorb_style'].forEach(id=>document.getElementById(id)?.remove());

    /* 注入爱心动画样式 */
    const st=document.createElement('style');st.id='_aorb_style';
    st.textContent=`
      @keyframes _hb{0%,100%{transform:scale(1);}50%{transform:scale(1.18);}}
      @keyframes _hgrad{0%{stop-color:#f9a8d4;}50%{stop-color:#fb7185;}100%{stop-color:#f9a8d4;}}
      @keyframes _hgrad2{0%{stop-color:#fde68a;}50%{stop-color:#f9a8d4;}100%{stop-color:#fde68a;}}
      #_aorb_btn{animation:_hb 2.4s ease-in-out infinite;cursor:pointer;display:flex;align-items:center;justify-content:center;width:20px;height:20px;position:fixed;top:5px;left:50%;transform:translateX(-50%);z-index:99999;border:none;background:none;padding:0;}
      #_aorb_btn:hover svg{filter:drop-shadow(0 0 4px rgba(255,255,255,.9));}
      #_aorb_panel{position:fixed;top:32px;left:50%;z-index:99998;min-width:200px;background:#111;border:1.5px solid #fff;outline:3px solid #f9a8d4;outline-offset:-4px;opacity:0;pointer-events:none;transition:opacity .22s,transform .22s;transform:translateX(-50%) translateY(-5px);font-family:'Geist Mono',monospace;box-shadow:3px 3px 0 #f9a8d4;}
      #_aorb_panel.open{opacity:1;pointer-events:auto;transform:translateX(-50%) translateY(0);}
    `;
    document.head.appendChild(st);

    /* 双边框渐变爱心 SVG */
    const btn=document.createElement('button');btn.id='_aorb_btn';
    btn.title='查看游玩状态';
    btn.innerHTML=`<svg width="20" height="18" viewBox="0 0 28 26" fill="none" xmlns="http://www.w3.org/2000/svg">
      <!-- 外边框爱心：白色 -->
      <path d="M14 23.5C14 23.5 2 15.5 2 8.5C2 5.2 4.7 2.5 8 2.5C10.2 2.5 12.1 3.7 13.1 5.4C13.5 6.1 14.5 6.1 14.9 5.4C15.9 3.7 17.8 2.5 20 2.5C23.3 2.5 26 5.2 26 8.5C26 15.5 14 23.5 14 23.5Z"
        stroke="#ffffff" stroke-width="2.2" fill="none" stroke-linejoin="round"/>
      <!-- 内边框爱心：粉色渐变动画 -->
      <path d="M14 20.5C14 20.5 4.5 13.8 4.5 8.5C4.5 6.6 6.1 5 8 5C9.6 5 11 5.9 11.8 7.3C12.7 8.9 15.3 8.9 16.2 7.3C17 5.9 18.4 5 20 5C21.9 5 23.5 6.6 23.5 8.5C23.5 13.8 14 20.5 14 20.5Z">
        <animate attributeName="stroke" values="#f9a8d4;#fbcfe8;#fca5a5;#f9a8d4" dur="2.8s" repeatCount="indefinite"/>
        <animate attributeName="stroke-width" values="1.8;2.2;1.8" dur="2.4s" repeatCount="indefinite"/>
        <set attributeName="fill" to="none"/>
      </path>
    </svg>`;
    document.body.appendChild(btn);

    /* 展开面板 */
    const panel=document.createElement('div');panel.id='_aorb_panel';
    document.body.appendChild(panel);

    let open=false;
    let _orbTick=null;

    function _renderOrbPanel(){
      iGet(K.dur).then(d=>{
        const dur=d||0;
        const durEl=document.getElementById('_orb_dur');
        const remEl=document.getElementById('_orb_rem');
        if(durEl) durEl.textContent=fmtSec(dur);
        if(remEl) remEl.textContent=user.expire_at?fmtRem(user.expire_at):'---';
      });
      iGet(K.last_dur).then(v=>{
        const el=document.getElementById('_orb_last');
        if(el) el.textContent=v!=null?fmtSec(v):'---';
      });
    }

    btn.addEventListener('click',async(e)=>{
      e.stopPropagation();open=!open;
      if(open){
        const d=(await iGet(K.dur))||0;
        panel.innerHTML=`
          <div style="background:#f9a8d4;color:#111;padding:5px 12px;font-size:8px;letter-spacing:.15em;font-weight:700;display:flex;justify-content:space-between;align-items:center;">
            <span>TSUKI · STATUS</span><span>♥</span>
          </div>
          <div style="padding:10px 12px;display:flex;flex-direction:column;gap:7px;">
            <div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid rgba(255,255,255,.08);">
              <span style="font-size:8px;color:rgba(255,255,255,.4);letter-spacing:.12em;">已游玩</span>
              <span id="_orb_dur" style="font-size:13px;font-weight:700;color:#fff;">${fmtSec(d)}</span>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid rgba(255,255,255,.08);">
              <span style="font-size:8px;color:rgba(255,255,255,.4);letter-spacing:.12em;">上次续期时长</span>
              <span id="_orb_last" style="font-size:13px;font-weight:700;color:#fbcfe8;">···</span>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid rgba(255,255,255,.08);">
              <span style="font-size:8px;color:rgba(255,255,255,.4);letter-spacing:.12em;">剩余有效期</span>
              <span id="_orb_rem" style="font-size:13px;font-weight:700;color:#f9a8d4;">${user.expire_at?fmtRem(user.expire_at):'---'}</span>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;">
              <span style="font-size:8px;color:rgba(255,255,255,.4);letter-spacing:.12em;">浏览器码</span>
              <span style="font-size:11px;font-weight:700;color:rgba(255,255,255,.8);letter-spacing:.14em;">${user.browser_code||'未绑定'}</span>
            </div>
          </div>`;
        panel.classList.add('open');
        /* 逐秒刷新 */
        clearInterval(_orbTick);
        _orbTick=setInterval(_renderOrbPanel,1000);
        /* 立即读取上次续期时长 */
        iGet(K.last_dur).then(v=>{
          const el=document.getElementById('_orb_last');
          if(el) el.textContent=v!=null?fmtSec(v):'---';
        });
      } else {
        panel.classList.remove('open');
        clearInterval(_orbTick);_orbTick=null;
      }
    });
    document.addEventListener('click',e=>{
      if(open&&!btn.contains(e.target)&&!panel.contains(e.target)){
        open=false;panel.classList.remove('open');
        clearInterval(_orbTick);_orbTick=null;
      }
    });
  }

  /* ── 计时器 ── */
  function startTimer(){
    if(timer)return;
    /* 每秒tick，仅在 counting=true 时才累加 */
    timer=setInterval(async()=>{
      if(!counting)return;
      let d=(await iGet(K.dur))||0;
      await iSet(K.dur,++d);
    },1000);
  }

  function resetIdle(){
    /* 有用户动作时：重置为活跃，并刷新5秒倒计时 */
    counting=true;
    clearTimeout(idle);
    idle=setTimeout(()=>{ counting=false; },5000);
  }

  function initTimer(){
    const _events=['mousemove','mousedown','keydown','touchstart','scroll','wheel','click'];

    /* 在指定 document 上绑定所有交互事件 */
    function _bindDoc(doc){
      _events.forEach(e=>doc.addEventListener(e,resetIdle,{passive:true}));
    }

    /* 主页面 */
    _bindDoc(document);

    /* 对每个已加载的同域 iframe 也绑定；对尚未加载的 iframe 等 load 后再绑定 */
    function _bindIframes(){
      document.querySelectorAll('iframe').forEach(f=>{
        try{
          const fd=f.contentDocument||f.contentWindow?.document;
          if(fd&&fd.readyState!=='uninitialized'){
            _bindDoc(fd);
          } else {
            f.addEventListener('load',()=>{
              try{
                const d=f.contentDocument||f.contentWindow?.document;
                if(d)_bindDoc(d);
              }catch(err){}
            },{once:true});
          }
        }catch(err){
          /* 跨域 iframe 无法访问，退而用 focus/blur 兜底 */
          f.addEventListener('mouseenter',resetIdle,{passive:true});
        }
      });
    }
    _bindIframes();

    /* window 获得焦点（从 iframe 切回主页面）也重置 */
    window.addEventListener('focus',resetIdle,{passive:true});

    /* 若页面后续动态插入 iframe，也自动绑定 */
    if(window.MutationObserver){
      new MutationObserver(muts=>{
        muts.forEach(m=>m.addedNodes.forEach(n=>{
          if(n.nodeName==='IFRAME'){
            n.addEventListener('load',()=>{
              try{const d=n.contentDocument||n.contentWindow?.document;if(d)_bindDoc(d);}catch(err){}
            },{once:true});
          }
        }));
      }).observe(document.body,{childList:true,subtree:true});
    }

    /* 页面切换到后台立刻暂停，切回来重置5秒倒计时 */
    document.addEventListener('visibilitychange',()=>{
      if(document.hidden){
        counting=false;
        clearTimeout(idle);
      } else {
        resetIdle();
      }
    });

    /* 启动时先给一次活跃判定 */
    resetIdle();
  }
  async function syncCloud(qq){const d=(await iGet(K.dur))||0;await sb(`users?qq=eq.${encodeURIComponent(qq)}`,'PATCH',{current_play_duration:d},{'Prefer':'return=minimal'});}

  /* ══════════════════════════════════════════════════════════
     主入口
  ══════════════════════════════════════════════════════════ */
  async function _authMain(){
    _fonts();
    /* 每次都显示登录面板；读取本地账号密码用于自动填充 */
    const savedQQ  = await iGet(K.qq);
    const savedPWD = await iGet('auth_saved_pwd');
    let devWarn = null;
    if(savedQQ){
      const lc=await iGet(K.code);
      const res=await sb(`users?qq=eq.${encodeURIComponent(savedQQ)}&select=browser_code,is_admin`);
      if(res.ok&&res.data?.length){
        const u=res.data[0];
        if(u.browser_code&&lc&&u.browser_code!==lc) devWarn='⚠ 检测到设备已更换，请重置浏览器码后重新登录';
      }
    }
    _removeMask();
    showAuth('login', savedQQ||'', savedPWD||'', devWarn);
  }
  _authMain();

  function _fonts(){
    if(document.getElementById('_afont'))return;
    const l=document.createElement('link');l.id='_afont';l.rel='stylesheet';
    l.href='https://fonts.googleapis.com/css2?family=Syne:wght@400;700;800&family=Geist+Mono:wght@400;500;700&family=Noto+Serif+JP:wght@700&display=swap';
    document.head.appendChild(l);
  }

  /* ══════════════════════════════════════════════════════════
     Auth UI
  ══════════════════════════════════════════════════════════ */
  function showAuth(tab='login', prefillQQ='', prefillPWD='', warnMsg=null){
    document.body.style.overflow='hidden';
    _css();
    const ov=document.createElement('div');ov.id='_aov';
    ov.innerHTML=_html();document.body.appendChild(ov);
    const d=nowDate();
    const e1=document.getElementById('_adate1'),e2=document.getElementById('_adate2');
    if(e1)e1.textContent=`日期：${d}`;if(e2)e2.textContent=d;
    /* 自动填充本地账号密码 */
    if(prefillQQ){
      const qi=document.getElementById('login-qq');if(qi)qi.value=prefillQQ;
    }
    if(prefillPWD){
      const pi=document.getElementById('login-pwd');if(pi)pi.value=prefillPWD;
    }
    /* 设备警告 */
    if(warnMsg) setTimeout(()=>toast(warnMsg,'warn',6000),400);
    _bindEvents();_tab(tab);
  }

  function _holes(n){return Array(n).fill('<i class="af-hole"></i>').join('');}

  function _barcode(){
    return Array(14).fill(0).map((_,i)=>
      `<span style="display:inline-block;width:${i%4===0?3:i%3===0?2:1}px;height:${8+Math.abs(Math.sin(i*.9))*13}px;background:#111;margin:0 .4px;vertical-align:bottom;opacity:${.3+Math.abs(Math.sin(i*1.4))*.7}"></span>`
    ).join('');
  }

  function _html(){
    return `
<div class="av2-bg">
  <div class="av2-dots"></div>
  <div class="av2-kanji">月</div>
  <div class="av2-pinkbar"></div>
  <div class="av2-film av2-film-t">
    <div class="af-holes">${_holes(24)}</div>
    <div class="af-inner"><span class="af-txt">TSUKI · PHONE · PRO · MAX · TX 5063 · 限定アクセス · MEMBER ONLY ·&nbsp;</span><span class="af-txt">TSUKI · PHONE · PRO · MAX · TX 5063 · 限定アクセス · MEMBER ONLY ·&nbsp;</span></div>
    <div class="af-holes">${_holes(24)}</div>
  </div>
  <div class="av2-film av2-film-b">
    <div class="af-holes">${_holes(24)}</div>
    <div class="af-inner"><span class="af-txt2">That summer, I made a wish · ▶ 001 · 002 · PAGE · SN:20260517 ·&nbsp;</span><span class="af-txt2">That summer, I made a wish · ▶ 001 · 002 · PAGE · SN:20260517 ·&nbsp;</span></div>
    <div class="af-holes">${_holes(24)}</div>
  </div>
  <span class="av2-sc av2-sc1">TSUKI · PHONE · PRO · MAX</span>
  <span class="av2-sc av2-sc2">限定アクセス · MEMBER ONLY</span>
  <span class="av2-sc av2-sc3">That summer, I made a wish that the rainstorm would last a little longer</span>
  <span class="av2-corner-date" id="_adate2"></span>
  <span class="av2-tri1">▶</span><span class="av2-tri2">▶▶</span>
  <div class="av2-tagblk av2-tagblk1">#邂逅月色 · 001</div>
  <div class="av2-tagblk av2-tagblk2">#限定入场</div>
</div>

<div class="av2-sidebar">
  <div class="av2-sb-bracket">不知名俱乐部</div>
  <div class="av2-sb-jp">ツキ</div>
  <div class="av2-sb-en">TSUKI</div>
  <div class="av2-sb-sub">PHONE<br>PRO MAX</div>
  <div class="av2-sb-rule"></div>
  <div class="av2-sb-meta">MEMBER</div>
  <div class="av2-sb-meta">SYSTEM</div>
  <div class="av2-sb-meta">VER·2.0</div>
  <div class="av2-sb-dots">
    <span class="av2-dot av2-dot-on"></span>
    <span class="av2-dot"></span>
    <span class="av2-dot"></span>
  </div>
</div>

<div class="av2-card">
  <div class="av2-topbar">
    <div class="av2-topbar-l">
      <span class="av2-tsq"></span><span class="av2-tsq av2-tsq-pink"></span>
      <span class="av2-topbar-lbl">MEMBER PORTAL</span>
    </div>
    <span class="av2-topbar-date" id="_adate1"></span>
  </div>

  <div class="av2-tabs">
    <button class="av2-tab av2-tab-on" data-tab="register">
      <span class="av2-tab-n">01</span><span class="av2-tab-l">注册账号</span>
    </button>
    <button class="av2-tab" data-tab="login">
      <span class="av2-tab-n">02</span><span class="av2-tab-l">用户登录</span>
    </button>
  </div>

  <div class="av2-panel" id="auth-panel-register">
    <div class="av2-eyebrow">
      <span class="av2-eytag">#新成员申请</span>
      <span class="av2-eyen">NEW MEMBER APPLICATION</span>
    </div>
    <div class="av2-fields">
      <div class="av2-field">
        <span class="av2-flbl">QQ 号码</span>
        <div class="av2-finput-row">
          <span class="av2-fpfx">→</span>
          <input class="av2-input" id="reg-qq" type="text" placeholder="输入你的 QQ 号" inputmode="numeric" />
        </div>
      </div>
      <div class="av2-field">
        <span class="av2-flbl">备注</span>
        <div class="av2-finput-row">
          <span class="av2-fpfx">→</span>
          <input class="av2-input" id="reg-remark" type="text" placeholder="填写给月見的好友备注/QQ昵称（不可留空）" autocomplete="off" />
        </div>
      </div>
    </div>
    <button class="av2-btn" id="reg-btn">
      <span class="av2-btn-lbl">申请专属账号</span>
      <span class="av2-btn-bdg">FREE ▶</span>
    </button>
    <div class="av2-result" id="reg-result" style="display:none;">
      <div class="av2-result-bar">
        <span>▶ 专属密码已生成</span>
        <span class="av2-result-hint">点击密码框复制</span>
      </div>
      <div class="av2-result-pwd" id="reg-pwd-display">
        <span class="av2-pwd-text" id="reg-pwd-text">--------</span>
        <span class="av2-pwd-copy">COPY ⎘</span>
      </div>
      <div class="av2-result-warn">⚠ 密码无法找回，请立即记录</div>
    </div>
  </div>

  <div class="av2-panel" id="auth-panel-login" style="display:none;">
    <div class="av2-eyebrow">
      <span class="av2-eytag">#成员入场</span>
      <span class="av2-eyen">MEMBER LOGIN</span>
    </div>
    <div class="av2-fields">
      <div class="av2-field">
        <span class="av2-flbl">账号 ID</span>
        <div class="av2-finput-row">
          <span class="av2-fpfx">→</span>
          <input class="av2-input" id="login-qq" type="text" placeholder="QQ 号 / 管理员账号" />
        </div>
      </div>
      <div class="av2-field">
        <span class="av2-flbl">密码</span>
        <div class="av2-finput-row">
          <span class="av2-fpfx">→</span>
          <input class="av2-input" id="login-pwd" type="password" placeholder="输入密码" />
        </div>
      </div>
    </div>
    <button class="av2-btn" id="login-btn">
      <span class="av2-btn-lbl">进入专属空间</span>
      <span class="av2-btn-bdg">GO ▶</span>
    </button>
    <div class="av2-reset-row">
      <button class="av2-reset-link" id="reset-code-btn">· 重置浏览器码 ·</button>
    </div>
    <div class="av2-bubble" id="reset-bubble" style="display:none;">
      <div class="av2-bubble-lbl">▶ 输入当前绑定的 6 位浏览器码</div>
      <div class="av2-bubble-row">
        <input class="av2-bubble-input" id="reset-code-input" type="text" placeholder="XXXXXX" maxlength="6" />
        <button class="av2-bubble-btn" id="reset-code-confirm">确认重置</button>
      </div>
    </div>
  </div>

  <div class="av2-footer">
    <span class="av2-footer-sn">SN:TSUKI·2026</span>
    <span class="av2-footer-bar">${_barcode()}</span>
    <span class="av2-footer-copy">© TSUKI SYSTEM</span>
  </div>
</div>

<div class="av2-rightcol">
  <div class="av2-rc-lbl">PERSONAL</div>
  <div class="av2-rc-num">001</div>
</div>
    `;
  }

  function _css(){
    if(document.getElementById('_acss'))return;
    const s=document.createElement('style');s.id='_acss';
    s.textContent=`
#_aov{position:fixed;inset:0;z-index:99990;overflow:hidden;display:flex;align-items:stretch;background:#f0ebe3;font-family:'Syne','Geist Mono',sans-serif;}

/* BG */
.av2-bg{position:absolute;inset:0;pointer-events:none;overflow:hidden;}
.av2-dots{position:absolute;inset:0;background-image:radial-gradient(circle,#b0a898 1px,transparent 1px);background-size:20px 20px;opacity:.3;}
.av2-kanji{position:absolute;right:-60px;bottom:-80px;font-family:'Noto Serif JP',serif;font-size:min(55vw,500px);font-weight:700;color:rgba(0,0,0,.04);line-height:1;user-select:none;}
.av2-pinkbar{position:absolute;left:0;top:0;bottom:0;width:5px;background:linear-gradient(180deg,#f9a8d4,#fbcfe8 50%,#f9a8d4);}

/* 胶片条 */
.av2-film{position:absolute;left:0;right:0;height:26px;background:#111;display:flex;align-items:center;overflow:hidden;}
.av2-film-t{top:0;}.av2-film-b{bottom:0;}
.af-holes{display:flex;align-items:center;padding:0 6px;gap:9px;flex-shrink:0;}
.af-hole{display:inline-block;width:11px;height:9px;border-radius:2px;background:#f0ebe3;flex-shrink:0;}
.af-inner{flex:1;overflow:hidden;white-space:nowrap;height:100%;display:flex;align-items:center;}
.af-txt{font-family:'Geist Mono',monospace;font-size:8px;letter-spacing:.14em;color:rgba(255,255,255,.35);animation:af-scroll 18s linear infinite;}
.af-txt2{font-family:'Geist Mono',monospace;font-size:8px;letter-spacing:.14em;color:rgba(255,255,255,.25);animation:af-scroll 22s linear infinite reverse;}
@keyframes af-scroll{from{transform:translateX(0);}to{transform:translateX(-50%);}}

/* 散落文字 */
.av2-sc{position:absolute;font-family:'Geist Mono',monospace;white-space:nowrap;user-select:none;color:rgba(0,0,0,.1);font-size:9px;letter-spacing:.08em;}
.av2-sc1{top:34px;left:50%;transform:translateX(-50%);color:rgba(0,0,0,.16);font-size:8px;}
.av2-sc2{bottom:34px;right:20px;font-size:8px;}
.av2-sc3{top:50px;left:50%;transform:translateX(-50%);font-size:7px;color:rgba(0,0,0,.08);max-width:80vw;overflow:hidden;text-overflow:ellipsis;}
.av2-corner-date{position:absolute;top:34px;right:16px;font-family:'Geist Mono',monospace;font-size:9px;color:rgba(0,0,0,.3);letter-spacing:.06em;}
.av2-tri1{position:absolute;bottom:40px;right:72px;color:rgba(0,0,0,.2);font-size:10px;}
.av2-tri2{position:absolute;bottom:40px;right:50px;color:#f9a8d4;font-size:10px;}
.av2-tagblk{position:absolute;font-family:'Geist Mono',monospace;font-size:9px;font-weight:700;background:#111;color:#f9a8d4;padding:2px 8px;letter-spacing:.08em;}
.av2-tagblk1{bottom:68px;left:50%;transform:translateX(-50%);}
.av2-tagblk2{display:none;}

/* 左侧信息柱 */
.av2-sidebar{position:relative;z-index:2;width:68px;flex-shrink:0;display:flex;flex-direction:column;align-items:center;padding:34px 0 34px;border-right:1.5px solid rgba(0,0,0,.1);background:rgba(240,235,227,.7);gap:7px;}
.av2-sb-bracket{writing-mode:vertical-rl;font-size:8px;letter-spacing:.12em;color:rgba(0,0,0,.35);background:rgba(0,0,0,.06);padding:5px 2px;border:1px solid rgba(0,0,0,.1);font-family:'Geist Mono',monospace;}
.av2-sb-jp{font-family:'Noto Serif JP',serif;font-size:20px;font-weight:700;color:#111;line-height:1;margin-top:10px;}
.av2-sb-en{font-family:'Syne',sans-serif;font-size:10px;font-weight:800;letter-spacing:.14em;color:#111;}
.av2-sb-sub{font-family:'Geist Mono',monospace;font-size:7px;letter-spacing:.08em;color:rgba(0,0,0,.35);text-align:center;line-height:1.6;writing-mode:vertical-rl;}
.av2-sb-rule{width:28px;height:1.5px;background:#111;margin:6px 0;}
.av2-sb-meta{font-family:'Geist Mono',monospace;font-size:7px;letter-spacing:.1em;color:rgba(0,0,0,.3);writing-mode:vertical-rl;}
.av2-sb-dots{margin-top:auto;display:flex;flex-direction:column;gap:4px;align-items:center;}
.av2-dot{width:5px;height:5px;border-radius:50%;background:rgba(0,0,0,.15);}
.av2-dot-on{background:#f9a8d4;box-shadow:0 0 6px #f9a8d4;}

/* 主卡 */
.av2-card{position:relative;z-index:2;flex:1;display:flex;flex-direction:column;padding-top:26px;padding-bottom:26px;overflow-y:auto;min-width:0;}

/* 顶栏 */
.av2-topbar{display:flex;align-items:center;justify-content:space-between;padding:0 28px 14px;border-bottom:1.5px solid #111;margin-bottom:18px;}
.av2-topbar-l{display:flex;align-items:center;gap:7px;}
.av2-tsq{display:inline-block;width:9px;height:9px;background:#111;}
.av2-tsq-pink{background:#f9a8d4;}
.av2-topbar-lbl{font-family:'Geist Mono',monospace;font-size:9px;font-weight:700;letter-spacing:.16em;color:#111;}
.av2-topbar-date{font-family:'Geist Mono',monospace;font-size:9px;color:rgba(0,0,0,.35);letter-spacing:.06em;}

/* Tabs */
.av2-tabs{display:flex;padding:0 28px;margin-bottom:20px;border-bottom:1.5px solid #111;}
.av2-tab{flex:1;display:flex;align-items:baseline;gap:8px;padding:9px 0;background:none;border:none;border-bottom:2.5px solid transparent;margin-bottom:-1.5px;cursor:pointer;transition:all .18s;font-family:'Syne',sans-serif;}
.av2-tab:hover,.av2-tab-on{border-bottom-color:#111;}
.av2-tab-n{font-family:'Geist Mono',monospace;font-size:9px;font-weight:700;color:rgba(0,0,0,.25);letter-spacing:.08em;}
.av2-tab-on .av2-tab-n{color:#f9a8d4;}
.av2-tab-l{font-size:13px;font-weight:700;color:#111;letter-spacing:.04em;}

/* Panel */
.av2-panel{padding:0 28px;flex:1;}
.av2-eyebrow{display:flex;align-items:baseline;gap:10px;margin-bottom:16px;flex-wrap:wrap;}
.av2-eytag{font-family:'Geist Mono',monospace;font-size:10px;font-weight:700;background:#111;color:#f9a8d4;padding:2px 9px;letter-spacing:.08em;white-space:nowrap;}
.av2-eyen{font-size:8px;color:rgba(0,0,0,.25);letter-spacing:.12em;font-family:'Geist Mono',monospace;}

/* Fields */
.av2-fields{display:flex;flex-direction:column;gap:0;}
.av2-field{margin-bottom:14px;}
.av2-flbl{font-family:'Geist Mono',monospace;font-size:8px;letter-spacing:.16em;color:rgba(0,0,0,.35);font-weight:700;display:block;margin-bottom:5px;}
.av2-finput-row{display:flex;align-items:center;border-bottom:1.5px solid #111;}
.av2-fpfx{font-family:'Geist Mono',monospace;font-size:13px;font-weight:700;color:#f9a8d4;padding:0 7px 0 0;flex-shrink:0;}
.av2-input{flex:1;border:none;outline:none;background:transparent;font-family:'Geist Mono',monospace;font-size:14px;font-weight:500;color:#111;padding:7px 0;letter-spacing:.04em;-webkit-appearance:none;}
.av2-input::placeholder{color:rgba(0,0,0,.22);font-size:12px;}
.av2-finput-row:focus-within{border-bottom-color:#f9a8d4;}
.av2-finput-row:focus-within .av2-fpfx{color:#111;}

/* Button */
.av2-btn{width:100%;margin-top:18px;display:flex;align-items:center;justify-content:space-between;background:#111;border:none;cursor:pointer;padding:13px 18px;box-shadow:3px 3px 0 #f9a8d4;transition:all .18s;}
.av2-btn:hover{box-shadow:5px 5px 0 #f9a8d4;transform:translate(-1px,-1px);}
.av2-btn:active{box-shadow:1px 1px 0 #f9a8d4;transform:translate(1px,1px);}
.av2-btn:disabled{background:rgba(0,0,0,.18);box-shadow:none;transform:none;cursor:not-allowed;}
.av2-btn-lbl{font-family:'Syne',sans-serif;font-size:13px;font-weight:800;color:#fff;letter-spacing:.08em;}
.av2-btn-bdg{font-family:'Geist Mono',monospace;font-size:9px;font-weight:700;color:#f9a8d4;letter-spacing:.12em;}

/* Result */
.av2-result{margin-top:18px;border:1.5px solid #111;box-shadow:3px 3px 0 #f9a8d4;animation:av2-fi .3s ease;}
.av2-result-bar{background:#111;padding:5px 12px;display:flex;justify-content:space-between;align-items:center;}
.av2-result-bar>span:first-child{font-family:'Geist Mono',monospace;font-size:9px;font-weight:700;color:#f9a8d4;letter-spacing:.08em;}
.av2-result-hint{font-size:8px;color:rgba(255,255,255,.35);font-family:'Geist Mono',monospace;}
.av2-result-pwd{display:flex;align-items:center;justify-content:space-between;padding:14px 12px;cursor:pointer;transition:background .15s;}
.av2-result-pwd:hover{background:rgba(249,168,212,.07);}
.av2-result-pwd:active{background:rgba(249,168,212,.14);}
.av2-pwd-text{font-family:'Geist Mono',monospace;font-size:20px;font-weight:700;color:#111;letter-spacing:.16em;}
.av2-pwd-copy{font-family:'Geist Mono',monospace;font-size:8px;font-weight:700;color:rgba(0,0,0,.25);letter-spacing:.1em;}
.av2-result-warn{padding:5px 12px;background:rgba(249,168,212,.1);font-family:'Geist Mono',monospace;font-size:8px;font-weight:700;color:rgba(0,0,0,.45);letter-spacing:.04em;border-top:1px solid rgba(249,168,212,.35);}

/* Reset */
.av2-reset-row{margin-top:12px;text-align:center;}
.av2-reset-link{font-family:'Geist Mono',monospace;font-size:9px;letter-spacing:.1em;color:rgba(0,0,0,.28);background:none;border:none;cursor:pointer;text-decoration:underline;text-underline-offset:3px;transition:color .18s;}
.av2-reset-link:hover{color:#111;}
.av2-bubble{margin-top:10px;border:1.5px solid #111;animation:av2-fi .2s ease;}
.av2-bubble-lbl{background:#111;padding:5px 11px;font-family:'Geist Mono',monospace;font-size:8px;font-weight:700;color:rgba(255,255,255,.5);letter-spacing:.08em;}
.av2-bubble-row{display:flex;}
.av2-bubble-input{flex:1;border:none;outline:none;background:#fff;padding:9px 11px;font-family:'Geist Mono',monospace;font-size:13px;font-weight:700;letter-spacing:.16em;color:#111;text-transform:uppercase;}
.av2-bubble-btn{padding:9px 14px;background:#111;border:none;font-family:'Geist Mono',monospace;font-size:10px;font-weight:700;color:#f9a8d4;letter-spacing:.08em;cursor:pointer;transition:background .18s;white-space:nowrap;}
.av2-bubble-btn:hover{background:#333;}

/* Footer */
.av2-footer{padding:12px 28px 0;margin-top:auto;border-top:1.5px solid rgba(0,0,0,.1);display:flex;align-items:center;justify-content:space-between;gap:10px;}
.av2-footer-sn{font-family:'Geist Mono',monospace;font-size:8px;color:rgba(0,0,0,.28);letter-spacing:.08em;white-space:nowrap;}
.av2-footer-bar{display:flex;align-items:flex-end;flex-shrink:0;}
.av2-footer-copy{font-family:'Geist Mono',monospace;font-size:8px;color:rgba(0,0,0,.2);letter-spacing:.06em;white-space:nowrap;}

/* 右侧竖排 */
.av2-rightcol{position:relative;z-index:2;width:24px;flex-shrink:0;display:flex;flex-direction:column;align-items:center;justify-content:center;border-left:1.5px solid rgba(0,0,0,.1);background:rgba(240,235,227,.7);gap:6px;padding:34px 0;}
.av2-rc-lbl{writing-mode:vertical-rl;font-family:'Geist Mono',monospace;font-size:7px;font-weight:700;letter-spacing:.18em;color:rgba(0,0,0,.2);}
.av2-rc-num{writing-mode:vertical-rl;font-family:'Syne',sans-serif;font-size:9px;font-weight:800;color:rgba(0,0,0,.12);letter-spacing:.1em;}

@keyframes av2-fi{from{opacity:0;transform:translateY(5px);}to{opacity:1;transform:translateY(0);}}

/* 响应小屏 */
@media(max-width:480px){
  .av2-sidebar{width:32px;}.av2-sb-jp,.av2-sb-en,.av2-sb-sub,.av2-sb-meta,.av2-sb-bracket{display:none;}
  .av2-rightcol{width:14px;}.av2-rc-lbl,.av2-rc-num{display:none;}
  .av2-panel,.av2-topbar,.av2-tabs,.av2-footer{padding-left:14px;padding-right:14px;}
}

/* ═══ 管理员面板 ════════════════ */
#_adm{position:fixed;inset:0;z-index:99990;overflow-y:auto;background:#0d0d0d;font-family:'Geist Mono',monospace;color:#fff;}
.adm2-film{position:sticky;top:0;z-index:20;height:24px;background:#000;display:flex;align-items:center;border-bottom:1px solid rgba(255,255,255,.08);overflow:hidden;}
.adm2-fholes{display:flex;gap:8px;padding:0 6px;flex-shrink:0;}
.adm2-fhole{width:10px;height:8px;border-radius:2px;background:#0d0d0d;flex-shrink:0;}
.adm2-finner{flex:1;overflow:hidden;height:100%;display:flex;align-items:center;}
.adm2-ftxt{font-size:7px;letter-spacing:.18em;color:rgba(255,255,255,.2);white-space:nowrap;animation:af-scroll 20s linear infinite;}

.adm2-hdr{position:sticky;top:24px;z-index:10;background:rgba(13,13,13,.97);backdrop-filter:blur(16px);border-bottom:1.5px solid rgba(255,255,255,.07);padding:14px 20px;display:flex;flex-direction:column;gap:11px;}
.adm2-hdr1{display:flex;align-items:center;justify-content:space-between;}
.adm2-title{display:flex;align-items:center;gap:10px;font-family:'Syne',sans-serif;font-size:17px;font-weight:800;color:#fff;}
.adm2-badge{font-family:'Geist Mono',monospace;font-size:7px;font-weight:700;background:#f9a8d4;color:#111;padding:2px 7px;letter-spacing:.12em;}
.adm2-enter{padding:6px 14px;background:transparent;border:1.5px solid rgba(255,255,255,.15);color:rgba(255,255,255,.5);font-size:10px;font-weight:700;cursor:pointer;letter-spacing:.1em;transition:all .2s;font-family:'Geist Mono',monospace;}
.adm2-enter:hover{border-color:#f9a8d4;color:#f9a8d4;}

.adm2-statrow{display:flex;align-items:center;gap:14px;flex-wrap:wrap;}
.adm2-stat{font-size:22px;font-weight:700;color:#fff;font-family:'Syne',sans-serif;}
.adm2-stat em{color:#f9a8d4;font-style:normal;}
.adm2-stat span{color:rgba(255,255,255,.2);margin:0 3px;}
.adm2-ctrls{display:flex;align-items:center;gap:7px;flex-wrap:wrap;}
.adm2-cbtn{padding:5px 11px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);color:rgba(255,255,255,.55);font-size:10px;font-weight:700;cursor:pointer;font-family:'Geist Mono',monospace;letter-spacing:.08em;transition:all .18s;}
.adm2-cbtn:hover{background:rgba(249,168,212,.08);border-color:#f9a8d4;color:#f9a8d4;}
.adm2-cinput{padding:5px 9px;background:rgba(255,255,255,.03);border:none;border-bottom:1.5px solid rgba(255,255,255,.12);color:#fff;font-size:11px;font-family:'Geist Mono',monospace;outline:none;width:68px;}
.adm2-cinput:focus{border-bottom-color:#f9a8d4;}

.adm2-srow{display:flex;gap:7px;}
.adm2-sinput{flex:1;padding:7px 12px;background:rgba(255,255,255,.03);border:none;border-bottom:1.5px solid rgba(255,255,255,.15);color:#fff;font-size:11px;outline:none;font-family:'Geist Mono',monospace;letter-spacing:.04em;}
.adm2-sinput::placeholder{color:rgba(255,255,255,.18);}
.adm2-sinput:focus{border-bottom-color:#f9a8d4;}
.adm2-sbtn{padding:7px 14px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);color:rgba(255,255,255,.55);font-size:10px;font-weight:700;cursor:pointer;font-family:'Geist Mono',monospace;letter-spacing:.1em;transition:all .18s;}
.adm2-sbtn:hover{background:rgba(249,168,212,.1);color:#f9a8d4;border-color:#f9a8d4;}

.adm2-list{padding:14px 20px;display:flex;flex-direction:column;gap:7px;}
.adm2-card{border:1px solid rgba(255,255,255,.07);overflow:hidden;transition:border-color .18s;}
.adm2-card:hover{border-color:rgba(255,255,255,.13);}
.adm2-row{display:flex;align-items:center;justify-content:space-between;padding:11px 16px;cursor:pointer;transition:background .15s;}
.adm2-row:hover{background:rgba(255,255,255,.02);}
.adm2-info{display:flex;flex-direction:column;gap:3px;}
.adm2-name{font-size:12px;font-weight:700;color:#fff;letter-spacing:.05em;}
.adm2-meta{font-size:9px;color:rgba(255,255,255,.25);letter-spacing:.07em;}
.adm2-chev{color:rgba(255,255,255,.18);font-size:15px;font-weight:700;transition:transform .25s cubic-bezier(.22,1,.36,1);flex-shrink:0;}
.adm2-chev.open{transform:rotate(90deg);}
.adm2-detail{max-height:0;overflow:hidden;padding:0 16px;transition:max-height .35s cubic-bezier(.22,1,.36,1),padding .35s;}
.adm2-detail.open{max-height:700px;padding:0 16px 16px;}
.adm2-sep{height:1px;background:rgba(255,255,255,.06);margin-bottom:13px;}
.adm2-grid{display:grid;grid-template-columns:1fr 1fr;gap:11px;margin-bottom:14px;}
.adm2-ditem{display:flex;flex-direction:column;gap:3px;}
.adm2-dlbl{font-size:8px;color:rgba(255,255,255,.22);letter-spacing:.14em;font-weight:700;}
.adm2-dval{font-size:11px;color:rgba(255,255,255,.65);letter-spacing:.04em;}
.adm2-dval.ok{color:#f9a8d4;}.adm2-dval.na{color:rgba(255,255,255,.18);}
.adm2-ops{display:flex;flex-direction:column;gap:7px;}
.adm2-orow{display:flex;gap:7px;align-items:center;flex-wrap:wrap;}
.adm2-olbl{font-size:8px;color:rgba(255,255,255,.22);min-width:56px;letter-spacing:.12em;}
.adm2-oinput{padding:5px 9px;background:rgba(255,255,255,.03);border:none;border-bottom:1.5px solid rgba(255,255,255,.12);color:#fff;font-size:11px;font-family:'Geist Mono',monospace;outline:none;width:100px;letter-spacing:.06em;}
.adm2-oinput:focus{border-bottom-color:#f9a8d4;}
.adm2-obtn{padding:5px 12px;border:none;font-size:9px;font-weight:700;cursor:pointer;font-family:'Geist Mono',monospace;letter-spacing:.1em;transition:all .18s;}
.adm2-obtn.blue{background:#f9a8d4;color:#111;}.adm2-obtn.blue:hover{background:#fbcfe8;}
.adm2-obtn.amber{background:rgba(251,191,36,.1);color:#fbbf24;border:1px solid rgba(251,191,36,.2);}.adm2-obtn.amber:hover{background:rgba(251,191,36,.2);}
.adm2-obtn.red{background:rgba(239,68,68,.08);color:#ef4444;border:1px solid rgba(239,68,68,.18);}.adm2-obtn.red:hover{background:rgba(239,68,68,.18);}
.adm2-row-expired{background:rgba(249,168,212,.06);border-left:3px solid #f9a8d4;}
.adm2-expired-badge{display:inline-block;margin-left:8px;padding:1px 7px;background:#f9a8d4;color:#111;font-size:8px;font-weight:700;letter-spacing:.1em;vertical-align:middle;font-family:'Geist Mono',monospace;}
.adm2-back{padding:6px 12px;background:transparent;border:1.5px solid rgba(255,255,255,.2);color:rgba(255,255,255,.5);font-size:13px;cursor:pointer;font-family:'Geist Mono',monospace;transition:all .2s;line-height:1;}
.adm2-back:hover{border-color:#f9a8d4;color:#f9a8d4;}
.adm2-pink{color:#f9a8d4!important;}
.adm2-copyable{cursor:pointer;transition:opacity .15s;}
.adm2-copyable:hover{opacity:.75;}
.adm2-copy-icon{font-size:9px;color:rgba(249,168,212,.45);margin-left:4px;}
    `;
    document.head.appendChild(s);
  }

  function _tab(tab){
    document.querySelectorAll('.av2-tab').forEach(t=>t.classList.toggle('av2-tab-on',t.dataset.tab===tab));
    document.querySelectorAll('.av2-panel').forEach(p=>p.style.display=p.id.endsWith(tab)?'block':'none');
  }

  function _bindEvents(){
    document.querySelectorAll('.av2-tab').forEach(t=>t.addEventListener('click',()=>_tab(t.dataset.tab)));
    const rb=document.getElementById('reg-btn');let done=false;
    rb?.addEventListener('click',async()=>{if(done)return;done=true;rb.disabled=true;await handleReg();});
    document.getElementById('reg-pwd-display')?.addEventListener('click',()=>{
      const t=document.getElementById('reg-pwd-text')?.textContent;
      if(!t||t==='--------')return;
      navigator.clipboard.writeText(t).then(()=>toast('✔ 密码已复制','success'));
    });
    document.getElementById('login-btn')?.addEventListener('click',handleLogin);
    document.getElementById('login-pwd')?.addEventListener('keydown',e=>{if(e.key==='Enter')handleLogin();});
    document.getElementById('reg-qq')?.addEventListener('keydown',e=>{if(e.key==='Enter')document.getElementById('reg-remark')?.focus();});
    const rBtn=document.getElementById('reset-code-btn'),rBub=document.getElementById('reset-bubble');
    rBtn?.addEventListener('click',()=>{rBub.style.display=rBub.style.display==='none'?'block':'none';});
    document.getElementById('reset-code-input')?.addEventListener('input',e=>{e.target.value=e.target.value.toUpperCase();});
    document.getElementById('reset-code-confirm')?.addEventListener('click',handleReset);
  }

  /* ── 注册 ── */
  async function handleReg(){
    const qq=document.getElementById('reg-qq')?.value.trim();
    const rm=document.getElementById('reg-remark')?.value.trim()||'';
    if(!qq){toast('请输入 QQ 号','warn');_reReg();return;}
    if(!rm){toast('请填写备注','warn');_reReg();return;}
    const cr=await sb(`config?key=in.(max_users,current_count)&select=*`);
    if(!cr.ok){toast('网络错误，请稍后重试','error');_reReg();return;}
    const cm={};(cr.data||[]).forEach(r=>cm[r.key]=parseInt(r.value));
    if((cm.current_count||0)>=(cm.max_users||0)){toast('♬ 注册名额已满，请联系管理员','error',4000);_reReg();return;}
    const er=await sb(`users?qq=eq.${encodeURIComponent(qq)}&select=qq`);
    if(er.ok&&er.data?.length){toast('该 QQ 号已注册，请直接登录','warn');_reReg();return;}
    const pwd=genPwd(qq);
    const ir=await sb('users','POST',{qq,password:pwd,remark:rm,expire_at:null,browser_code:null,last_play_duration:0,current_play_duration:0,is_admin:false});
    if(!ir.ok){toast('注册失败：'+(ir.data?.message||'服务器错误'),'error');_reReg();return;}
    await sb(`config?key=eq.current_count`,'PATCH',{value:String((cm.current_count||0)+1)},{'Prefer':'return=minimal'});
    document.getElementById('reg-pwd-text').textContent=pwd;
    document.getElementById('reg-result').style.display='block';
    toast('✔ 注册成功！点击密码框即可复制','success',5000);
  }
  function _reReg(){const b=document.getElementById('reg-btn');if(b)b.disabled=false;}

  /* ── 登录 ── */
  async function handleLogin(){
    const qq=document.getElementById('login-qq')?.value.trim();
    const pw=document.getElementById('login-pwd')?.value.trim();
    if(!qq||!pw){toast('请填写账号和密码','warn');return;}
    /* 账密全部交给云端验证，不在本地硬编码任何账密 */
    const res=await sb(`users?qq=eq.${encodeURIComponent(qq)}&select=*`);
    if(!res.ok||!res.data?.length){toast('账号或密码错误','error');return;}
    const user=res.data[0];
    if(user.password!==pw){toast('账号或密码错误','error');return;}
    /* 管理员：云端 is_admin=true 才进面板，无需本地存账密 */
    if(user.is_admin){
      await iSet(K.qq,qq);await iSet('auth_saved_pwd',pw);
      _rmAuth();showAdmin(user);return;
    }
    const lc=await iGet(K.code);
    if(user.browser_code){
      if(!lc){toast('⚠ 该账号已绑定其他设备，如需更换请重置浏览器码','error',5000);return;}
      if(lc!==user.browser_code){toast('⚠ 设备不符，请使用绑定设备或重置浏览器码','error',5000);return;}
    } else {
      const code=lc||genCode();
      await sb(`users?qq=eq.${encodeURIComponent(qq)}`,'PATCH',{browser_code:code},{'Prefer':'return=minimal'});
      await iSet(K.code,code);user.browser_code=code;
    }
    const ld=(await iGet(K.dur))||0;
    await sb(`users?qq=eq.${encodeURIComponent(qq)}`,'PATCH',{current_play_duration:ld},{'Prefer':'return=minimal'});
    if(!user.expire_at){
      const exp=new Date(Date.now()+3*86400*1000).toISOString();
      await sb(`users?qq=eq.${encodeURIComponent(qq)}`,'PATCH',{expire_at:exp,last_play_duration:0,current_play_duration:0},{'Prefer':'return=minimal'});
      await iSet(K.dur,0);user.expire_at=exp;user.last_play_duration=0;
      await iSet(K.qq,qq);await iSet('auth_saved_pwd',pw);me=user;_rmAuth();
      toast('✔ 首次登录成功♡已赠送 3 天免费时长，欢迎使用','success',5000);
      enterIndex(user);return;
    }
    if(expired(user.expire_at)){
      const diff=ld-(user.last_play_duration||0);
      //!!
      if(diff>=7200){
        const exp=new Date(Date.now()+3*86400*1000).toISOString();
        await sb(`users?qq=eq.${encodeURIComponent(qq)}`,'PATCH',{expire_at:exp,last_play_duration:ld,current_play_duration:ld},{'Prefer':'return=minimal'});
        user.expire_at=exp;user.last_play_duration=ld;
        await iSet(K.qq,qq);await iSet('auth_saved_pwd',pw);await iSet('auth_last_play_duration',ld);me=user;_rmAuth();
        toast('✔ 续期成功！已自动延长 3 天','success',4000);enterIndex(user);
      } else {toast(`⚠ 游玩时长不足 2 小时，还需 ${fmtSec(7200-diff)}`,'error',6000);}
      return;
    }
    await iSet(K.qq,qq);await iSet('auth_saved_pwd',pw);me=user;_rmAuth();
    toast(`✔ 登录成功，浏览器码：${user.browser_code}`,'success',3000);
    enterIndex(user);
  }

  /* ── 重置浏览器码 ── */
  async function handleReset(){
    const ic=document.getElementById('reset-code-input')?.value.trim().toUpperCase();
    const qq=document.getElementById('login-qq')?.value.trim();
    if(!qq){toast('请先填写账号','warn');return;}
    if(!ic||ic.length!==6){toast('请输入 6 位浏览器码','warn');return;}
    const r=await sb(`users?qq=eq.${encodeURIComponent(qq)}&select=browser_code`);
    if(!r.ok||!r.data?.length){toast('账号不存在','error');return;}
    const cc=r.data[0].browser_code;
    if(!cc){toast('该账号尚未绑定浏览器码','info');return;}
    if(ic!==cc){toast('浏览器码错误，请确认后重试','error');return;}
    await sb(`users?qq=eq.${encodeURIComponent(qq)}`,'PATCH',{browser_code:null},{'Prefer':'return=minimal'});
    await iDel(K.code);
    document.getElementById('reset-bubble').style.display='none';
    toast('✔ 浏览器码已重置，下次登录将自动绑定当前设备','success',4000);
  }

  function enterIndex(user){
    document.body.style.overflow='';startTimer();initTimer();createOrb(user);
    /* 有效期到期监测：每30秒检查一次，到期后弹提示并3秒后刷新 */
    if(user.expire_at){
      const _expCheck=setInterval(()=>{
        if(new Date(user.expire_at)<new Date()){
          clearInterval(_expCheck);
          let sec=3;
          const _cd=setInterval(async()=>{
            toast(`⚠ 有效期已到期，${sec}秒后自动刷新页面...`,'warn',3500);
            sec--;
            if(sec<0){
              clearInterval(_cd);
              /* 先清除本地登录态，避免刷新后再次进入过期循环 */
              await clearSess();
              location.reload();
            }
          },1000);
          toast(`⚠ 有效期已到期，3秒后自动刷新页面...`,'warn',3500);
        }
      },30000);
    }
  }
  function _rmAuth(){document.getElementById('_aov')?.remove();}

  /* ══════════════════════════════════════════════════════════
     管理员面板
  ══════════════════════════════════════════════════════════ */
  async function showAdmin(adminUser){
    _rmAuth();document.body.style.overflow='auto';
    const p=document.createElement('div');p.id='_adm';document.body.appendChild(p);
    await _renderAdmin(p,adminUser);
  }

  async function _renderAdmin(panel,adminUser){
    const fh=n=>Array(n).fill('<i class="adm2-fhole"></i>').join('');
    const [ur,cr]=await Promise.all([sb('users?order=remark.asc&select=*'),sb('config?key=in.(max_users,current_count)&select=*')]);
    const all=(ur.data||[]).filter(u=>!u.is_admin);
    const cm={};(cr.data||[]).forEach(r=>cm[r.key]=r.value);
    const max=parseInt(cm.max_users||10),cur=parseInt(cm.current_count||0);
    panel.innerHTML=`
      <div class="adm2-film">
        <div class="adm2-fholes">${fh(20)}</div>
        <div class="adm2-finner"><span class="adm2-ftxt">TSUKI · ADMIN PANEL · TX 5063 · 管理员专区 ·&nbsp;</span><span class="adm2-ftxt">TSUKI · ADMIN PANEL · TX 5063 · 管理员专区 ·&nbsp;</span></div>
        <div class="adm2-fholes">${fh(20)}</div>
      </div>
      <div class="adm2-hdr">
        <div class="adm2-hdr1">
          <div class="adm2-title">管理员面板<span class="adm2-badge">ADMIN</span></div>
          <div style="display:flex;gap:8px;align-items:center;">
            <button class="adm2-back" id="adm-back">←</button>
            <button class="adm2-enter" id="adm-enter">进入 Index →</button>
          </div>
        </div>
        <div class="adm2-statrow">
          <div class="adm2-stat">已注册 <em>${cur}</em><span>/</span><em id="adm-max">${max}</em></div>
          <div class="adm2-ctrls">
            <button class="adm2-cbtn" id="adm-plus10">＋10</button>
            <input class="adm2-cinput" id="adm-limit" type="number" placeholder="自定义" min="1" />
            <button class="adm2-cbtn" id="adm-set">设置</button>
          </div>
        </div>
        <div class="adm2-srow">
          <input class="adm2-sinput" id="adm-search" placeholder="QQ1#QQ2#QQ3 — 批量搜索，清空后搜索显示全部" />
          <button class="adm2-sbtn" id="adm-sgo">搜索</button>
        </div>
      </div>
      <div class="adm2-list" id="adm-list"></div>
    `;
    _renderList(all,all);

    document.getElementById('adm-back')?.addEventListener('click',()=>{
      document.getElementById('_adm')?.remove();
      showAuth('login');
    });
    document.getElementById('adm-enter')?.addEventListener('click',()=>{
      document.getElementById('_adm')?.remove();document.body.style.overflow='';me=adminUser;toast('已切换至 Index','info');
    });
    document.getElementById('adm-plus10')?.addEventListener('click',async()=>{
      const nm=max+10;await sb(`config?key=eq.max_users`,'PATCH',{value:String(nm)},{'Prefer':'return=minimal'});
      document.getElementById('adm-max').textContent=nm;toast(`✔ 上限已更新为 ${nm}`,'success');
    });
    document.getElementById('adm-set')?.addEventListener('click',async()=>{
      const v=parseInt(document.getElementById('adm-limit')?.value);
      if(!v||v<1){toast('请输入有效数字','warn');return;}
      await sb(`config?key=eq.max_users`,'PATCH',{value:String(v)},{'Prefer':'return=minimal'});
      document.getElementById('adm-max').textContent=v;document.getElementById('adm-limit').value='';
      toast(`✔ 上限已设置为 ${v}`,'success');
    });
    document.getElementById('adm-sgo')?.addEventListener('click',()=>{
      const raw=document.getElementById('adm-search')?.value.trim();
      if(!raw){_renderList(all,all);return;}
      const keys=raw.split('#').map(s=>s.trim().toLowerCase()).filter(Boolean);
      _renderList(all.filter(u=>keys.some(k=>u.qq?.toLowerCase().includes(k))),all,true);
    });
    document.getElementById('adm-search')?.addEventListener('keydown',e=>{if(e.key==='Enter')document.getElementById('adm-sgo')?.click();});
  }

  function _renderList(users,all,autoOpen=false){
    const list=document.getElementById('adm-list');if(!list)return;list.innerHTML='';
    if(!users.length){list.innerHTML='<div style="text-align:center;padding:48px;color:rgba(255,255,255,.12);font-size:10px;letter-spacing:.14em;">— 暂无用户数据 —</div>';return;}
    users.forEach(u=>{
      const c=document.createElement('div');c.className='adm2-card';c.id=`_ac_${u.qq}`;
      c.innerHTML=_cardHTML(u);list.appendChild(c);_cardEvents(c,u,all);
      if(autoOpen){
        const det=c.querySelector('.adm2-detail'),ch=c.querySelector('.adm2-chev');
        if(det)det.classList.add('open');if(ch)ch.classList.add('open');
      }
    });
  }

  function _cardHTML(u){
    const hc=!!u.browser_code;
    const ex=u.expire_at?new Date(u.expire_at).toLocaleString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'未设置';
    const isExp=u.expire_at?new Date(u.expire_at)<new Date():false;
    return `
      <div class="adm2-row${isExp?' adm2-row-expired':''}" data-qq="${u.qq}">
        <div class="adm2-info">
          <div class="adm2-name">${u.remark||'（无备注）'}${isExp?'<span class="adm2-expired-badge">已失效</span>':''}</div>
        </div>
        <span class="adm2-chev">›</span>
      </div>
      <div class="adm2-detail" id="det_${u.qq}">
        <div class="adm2-sep"></div>
        <div class="adm2-grid">
          <div class="adm2-ditem">
            <div class="adm2-dlbl">QQ 账号</div>
            <div class="adm2-dval adm2-pink adm2-copyable" data-copy="${u.qq}" title="点击复制">${u.qq}</div>
          </div>
          <div class="adm2-ditem">
            <div class="adm2-dlbl">密码</div>
            <div class="adm2-dval adm2-pink adm2-copyable" data-copy="${u.password}" title="点击复制">${u.password} <span class="adm2-copy-icon">⎘</span></div>
          </div>
          <div class="adm2-ditem">
            <div class="adm2-dlbl">浏览器码</div>
            <div class="adm2-dval ${hc?'adm2-pink adm2-copyable':'na'}" id="dc_${u.qq}" ${hc?`data-copy="${u.browser_code}" title="点击复制"`:''}>${hc?u.browser_code+'<span class="adm2-copy-icon">⎘</span>':'未绑定'}</div>
          </div>
          <div class="adm2-ditem">
            <div class="adm2-dlbl">到期时间</div>
            <div class="adm2-dval" id="de_${u.qq}">${ex}</div>
          </div>
          <div class="adm2-ditem">
            <div class="adm2-dlbl">上次续期时长</div>
            <div class="adm2-dval">${fmtSec(u.last_play_duration||0)}</div>
          </div>
          <div class="adm2-ditem">
            <div class="adm2-dlbl">当前游玩时长</div>
            <div class="adm2-dval">${fmtSec(u.current_play_duration||0)}</div>
          </div>
        </div>
        <div class="adm2-ops">
          <div class="adm2-orow">
            <span class="adm2-olbl">快速</span>
            <button class="adm2-obtn blue" data-action="addThreeDays" data-qq="${u.qq}">＋3天</button>
          </div>
          <div class="adm2-orow"><span class="adm2-olbl">有效期</span><input class="adm2-oinput" id="oe_${u.qq}" placeholder="MMDDHHmm" maxlength="8"/><button class="adm2-obtn blue" data-action="setExpire" data-qq="${u.qq}">确认</button></div>
          <div class="adm2-orow"><span class="adm2-olbl">浏览器码</span><button class="adm2-obtn amber" data-action="resetCode" data-qq="${u.qq}">重置</button></div>
          <div class="adm2-orow"><span class="adm2-olbl">账号</span><button class="adm2-obtn red" data-action="deleteUser" data-qq="${u.qq}">删除账号</button></div>
        </div>
      </div>
    `;
  }

  function _cardEvents(card,u,all){
    card.querySelector('.adm2-row')?.addEventListener('click',()=>{
      const d=card.querySelector('.adm2-detail'),ch=card.querySelector('.adm2-chev'),o=d.classList.contains('open');
      d.classList.toggle('open',!o);ch.classList.toggle('open',!o);
    });
    /* 点击复制 */
    card.querySelectorAll('.adm2-copyable').forEach(el=>{
      el.style.cursor='pointer';
      el.addEventListener('click',()=>{
        const txt=el.dataset.copy||el.textContent.replace('⎘','').trim();
        navigator.clipboard.writeText(txt).then(()=>toast('✔ 已复制','success',1800));
      });
    });
    /* 快速 +3天 */
    card.querySelector('[data-action="addThreeDays"]')?.addEventListener('click',async()=>{
      const res=await sb(`users?qq=eq.${encodeURIComponent(u.qq)}&select=expire_at`);
      const cur=res.data?.[0]?.expire_at;
      const base=cur&&new Date(cur)>new Date()?new Date(cur):new Date();
      const newExp=new Date(base.getTime()+3*86400*1000).toISOString();
      await sb(`users?qq=eq.${encodeURIComponent(u.qq)}`,'PATCH',{expire_at:newExp},{'Prefer':'return=minimal'});
      const el=document.getElementById(`de_${u.qq}`);
      if(el)el.textContent=new Date(newExp).toLocaleString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
      toast(`✔ ${u.remark||u.qq} 已延长 3 天`,'success');
    });
    card.querySelector('[data-action="setExpire"]')?.addEventListener('click',async()=>{
      const code=document.getElementById(`oe_${u.qq}`)?.value.trim();
      const iso=parseDate8(code);if(!iso){toast('格式错误，请输入 MMDDHHmm（如 05051200）','warn');return;}
      await sb(`users?qq=eq.${encodeURIComponent(u.qq)}`,'PATCH',{expire_at:iso},{'Prefer':'return=minimal'});
      const el=document.getElementById(`de_${u.qq}`);
      if(el)el.textContent=new Date(iso).toLocaleString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
      toast(`✔ ${u.remark||u.qq} 有效期已更新`,'success');
    });
    card.querySelector('[data-action="resetCode"]')?.addEventListener('click',async()=>{
      await sb(`users?qq=eq.${encodeURIComponent(u.qq)}`,'PATCH',{browser_code:null},{'Prefer':'return=minimal'});
      const el=document.getElementById(`dc_${u.qq}`);if(el){el.textContent='未绑定';el.className='adm2-dval na';}
      toast(`✔ ${u.remark||u.qq} 浏览器码已重置`,'success');
    });
    card.querySelector('[data-action="deleteUser"]')?.addEventListener('click',async()=>{
      if(!confirm(`确定要删除账号「${u.remark||u.qq}」吗？此操作不可恢复。`))return;
      await sb(`users?qq=eq.${encodeURIComponent(u.qq)}`,'DELETE',null,{'Prefer':'return=minimal'});
      const cr=await sb(`config?key=eq.current_count&select=*`);
      const cv=parseInt(cr.data?.[0]?.value||0);
      await sb(`config?key=eq.current_count`,'PATCH',{value:String(Math.max(0,cv-1))},{'Prefer':'return=minimal'});
      const se=document.querySelector('.adm2-stat em');if(se)se.textContent=String(Math.max(0,cv-1));
      card.style.transition='opacity .28s,transform .28s';card.style.opacity='0';card.style.transform='translateX(10px)';
      setTimeout(()=>card.remove(),300);
      toast(`✘ 账号「${u.remark||u.qq}」已删除`,'warn');
    });
  }

})();
