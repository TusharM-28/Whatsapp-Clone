let socket = null;
let myUsername = null;
let replyContext = null;
let isTyping = false;
let typingTimeout = null;
let searchMatches = [];
let currentSearchIdx = -1;
let unreadCount = 0;
const receivedMessageIds = new Set();
const SOUND_BEEP = 'data:audio/mp3;base64,//NExAAAAANIAAAAAExBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//NExAAAAANIAAAAAExBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq'; // short dummy base64 for simplicity

// DOM Elements
const els = {
  join: document.getElementById('join-screen'), chat: document.getElementById('chat-screen'),
  userIn: document.getElementById('username-input'), codeIn: document.getElementById('code-input'),
  joinBtn: document.getElementById('join-btn'), joinErr: document.getElementById('join-error'),
  status: document.getElementById('status'), statusDot: document.getElementById('status-dot'),
  presence: document.getElementById('presence-info'), msgs: document.getElementById('messages'),
  input: document.getElementById('message-input'), sendBtn: document.getElementById('send-btn'),
  typing: document.getElementById('typing-indicator'), fileIn: document.getElementById('file-input'),
  attachBtn: document.getElementById('attach-btn'), themeBtn: document.getElementById('theme-btn'),
  wallBtn: document.getElementById('wallpaper-btn'), themeDrop: document.getElementById('theme-dropdown'),
  wallDrop: document.getElementById('wallpaper-dropdown'), muteBtn: document.getElementById('mute-btn'),
  soundOn: document.getElementById('sound-on-icon'), soundOff: document.getElementById('sound-off-icon'),
  searchToggle: document.getElementById('search-toggle-btn'), searchBar: document.getElementById('search-bar'),
  searchIn: document.getElementById('search-input'), searchCount: document.getElementById('search-count'),
  searchPrev: document.getElementById('search-prev'), searchNext: document.getElementById('search-next'),
  searchClose: document.getElementById('search-close'), unreadBadge: document.getElementById('unread-badge'),
  unreadCount: document.getElementById('unread-count'), dropOverlay: document.getElementById('drop-overlay'),
  replyBar: document.getElementById('reply-bar'), replyName: document.getElementById('reply-name'),
  replyText: document.getElementById('reply-text'), replyClose: document.getElementById('reply-close'),
  voiceBtn: document.getElementById('voice-btn'), voiceBar: document.getElementById('voice-bar'),
  voiceCancel: document.getElementById('voice-cancel'), voiceSend: document.getElementById('voice-send'),
  voiceTimer: document.getElementById('voice-timer'), gifBtn: document.getElementById('gif-btn'),
  mediaPanel: document.getElementById('media-panel'), mediaClose: document.getElementById('media-panel-close'),
  stickerGrid: document.getElementById('sticker-grid'), gifGrid: document.getElementById('gif-grid'),
  ctxMenu: document.getElementById('context-menu'), ctxReply: document.getElementById('ctx-reply'),
  ctxReact: document.getElementById('ctx-react'), ctxDelete: document.getElementById('ctx-delete'),
  reactionPicker: document.getElementById('reaction-picker'), lightbox: document.getElementById('lightbox'),
  lightboxImg: document.getElementById('lightbox-img'), lightboxClose: document.getElementById('lightbox-close'),
  toast: document.getElementById('toast-container'), partnerAvatar: document.getElementById('partner-avatar')
};

let settings = { theme: 'dark', wallpaper: 'none', muted: false };
try { const saved = localStorage.getItem('chatSettings'); if (saved) settings = { ...settings, ...JSON.parse(saved) }; } catch (e) {}
applySettings();

// Intersection Observer for Read Receipts
const observer = new IntersectionObserver((entries) => {
  if (!document.hasFocus()) return;
  const readIds = [];
  entries.forEach(e => {
    if (e.isIntersecting) {
      const id = e.target.dataset.id;
      if (id && !e.target.dataset.readSent) {
        readIds.push(id);
        e.target.dataset.readSent = 'true';
      }
    }
  });
  if (readIds.length && socket) socket.emit('read_receipt', { messageIds: readIds });
}, { threshold: 0.5 });

// Window focus triggers read receipts
window.addEventListener('focus', () => {
  const unread = Array.from(document.querySelectorAll('.msg-wrapper.theirs[data-id]:not([data-read-sent="true"])'));
  const visible = unread.filter(el => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight; });
  if (visible.length && socket) {
    socket.emit('read_receipt', { messageIds: visible.map(el => { el.dataset.readSent='true'; return el.dataset.id; }) });
  }
});

function showToast(msg) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
  els.toast.appendChild(t); setTimeout(() => t.remove(), 3000);
}

// ─── INIT SOCKET ───
els.joinBtn.addEventListener('click', () => {
  myUsername = els.userIn.value.trim();
  const accessCode = els.codeIn.value.trim();
  if (!myUsername) return (els.joinErr.textContent = 'Username required');
  
  socket = io({ auth: { username: myUsername, accessCode } });
  
  socket.on('connect', () => { els.status.textContent = 'Connected'; els.statusDot.className = 'connection-status-dot connected'; });
  socket.on('disconnect', () => { els.status.textContent = 'Disconnected'; els.statusDot.className = 'connection-status-dot disconnected'; });
  socket.on('join_error', err => { els.joinErr.textContent = err; socket.disconnect(); });
  socket.on('join_success', () => { els.join.style.display = 'none'; els.chat.style.display = 'flex'; });
  
  socket.on('presence', data => {
    const others = data.users.filter(u => u !== myUsername);
    els.partnerAvatar.textContent = others.length ? others[0].charAt(0).toUpperCase() : '?';
    els.presence.textContent = `${data.online}/2 online | ${data.users.join(', ')}`;
  });
  
  socket.on('user_joined', d => addSystem(`${d.username} joined`));
  socket.on('user_left', d => { addSystem(`${d.username} left`); els.typing.textContent = ''; });
  socket.on('typing', d => els.typing.textContent = `${d.username} is typing...`);
  socket.on('stop_typing', () => els.typing.textContent = '');
  
  socket.on('chat_message', msg => {
    renderMessage(msg);
    if (msg.username !== myUsername) {
      if (!settings.muted && !document.hasFocus()) new Audio(SOUND_BEEP).play().catch(()=>{});
      const isScrolledUp = els.msgs.scrollHeight - els.msgs.scrollTop > els.msgs.clientHeight + 50;
      if (isScrolledUp) {
        unreadCount++; els.unreadCount.textContent = unreadCount; els.unreadBadge.classList.remove('hidden');
      } else {
        els.msgs.scrollTop = els.msgs.scrollHeight;
        if (document.hasFocus()) { observer.observe(document.querySelector(`[data-id="${msg.messageId}"]`)); }
      }
    } else {
      els.msgs.scrollTop = els.msgs.scrollHeight;
    }
  });

  socket.on('message_delivered', d => {
    const tick = document.getElementById(`tick-${d.messageId}`);
    if (tick && !tick.classList.contains('read')) tick.innerHTML = '✓✓';
  });

  socket.on('messages_read', d => {
    d.messageIds.forEach(id => {
      const tick = document.getElementById(`tick-${id}`);
      if (tick) { tick.innerHTML = '✓✓'; tick.classList.add('read'); }
    });
  });

  socket.on('message_deleted', d => {
    const content = document.getElementById(`content-${d.messageId}`);
    if (content) {
      content.innerHTML = '🚫 <i>This message was deleted</i>';
      content.parentElement.classList.add('deleted');
      const fileCard = content.parentElement.querySelector('.file-card');
      if (fileCard) fileCard.remove();
    }
  });

  socket.on('reaction', d => {
    let rRow = document.getElementById(`reacts-${d.messageId}`);
    if (!rRow) {
      const msgEl = document.querySelector(`[data-id="${d.messageId}"] .msg`);
      if(msgEl){ rRow = document.createElement('div'); rRow.id = `reacts-${d.messageId}`; rRow.className='reactions-row'; msgEl.appendChild(rRow); }
    }
    if (rRow) {
      const ex = Array.from(rRow.children).find(c => c.dataset.u === d.username);
      if (ex) { if (ex.textContent === d.emoji) ex.remove(); else ex.textContent = d.emoji; }
      else { const s = document.createElement('span'); s.textContent = d.emoji; s.dataset.u = d.username; rRow.appendChild(s); }
    }
  });
});

// ─── RENDERING ───
function formatText(text) {
  let html = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  html = html.replace(/\*(.*?)\*/g, "<strong>$1</strong>");
  html = html.replace(/_(.*?)_/g, "<em>$1</em>");
  html = html.replace(/~(.*?)~/g, "<del>$1</del>");
  html = html.replace(/`(.*?)`/g, "<code>$1</code>");
  html = html.replace(/(https?:\/\/[^\s]+)/g, "<a href='$1' target='_blank'>$1</a>");
  return html;
}

function renderMessage(msg) {
  const isMine = msg.username === myUsername;
  const wrap = document.createElement('div');
  wrap.className = `msg-wrapper ${isMine ? 'mine' : 'theirs'}`;
  wrap.dataset.id = msg.messageId;
  
  const inner = document.createElement('div'); inner.className = 'msg';
  
  // Header
  const head = document.createElement('div'); head.className = 'msg-header';
  const uname = document.createElement('span'); uname.className = 'username-lbl'; uname.textContent = msg.username;
  head.appendChild(uname);
  inner.appendChild(head);
  
  // Quote
  if (msg.replyTo) {
    const q = document.createElement('div'); q.className = 'quote-box';
    q.innerHTML = `<div class="quote-name">${msg.replyTo.username}</div><div class="quote-text">${msg.replyTo.preview}</div>`;
    inner.appendChild(q);
  }
  
  // Content
  const content = document.createElement('div'); content.className = 'content'; content.id = `content-${msg.messageId}`;
  if (msg.type === 'text') content.innerHTML = formatText(msg.text);
  else if (msg.type === 'image' || msg.type === 'gif' || msg.type === 'sticker') {
    const img = document.createElement('img'); img.src = msg.fileData || msg.gifUrl;
    img.onclick = () => { els.lightboxImg.src = img.src; els.lightbox.classList.remove('hidden'); };
    content.appendChild(img);
    if(msg.text) { const t = document.createElement('div'); t.innerHTML = formatText(msg.text); content.appendChild(t); }
  } else if (msg.type === 'file') {
    const fc = document.createElement('div'); fc.className = 'file-card';
    fc.innerHTML = `<div class="file-icon">📄</div><div class="file-info"><span class="file-name">${msg.fileName}</span><span class="file-size">${(msg.fileSize/1024).toFixed(1)} KB</span></div>`;
    fc.onclick = () => { const a = document.createElement('a'); a.href = msg.fileData; a.download = msg.fileName; a.click(); };
    inner.appendChild(fc);
  } else if (msg.type === 'voice') {
    content.innerHTML = `<div class="voice-msg"><button class="voice-play-btn" onclick="new Audio('${msg.fileData}').play()">▶</button><div class="voice-track"><div class="voice-progress" style="width:100%"></div></div><div class="voice-time">0:00</div></div>`;
  }
  
  inner.appendChild(content);
  
  // Meta
  const meta = document.createElement('div'); meta.className = 'meta-row';
  const time = document.createElement('span'); time.className = 'time';
  time.textContent = new Date(msg.timestamp).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
  meta.appendChild(time);
  if (isMine) {
    const tick = document.createElement('span'); tick.className = 'read-receipt'; tick.id = `tick-${msg.messageId}`; tick.innerHTML = '✓';
    meta.appendChild(tick);
  }
  inner.appendChild(meta);
  
  wrap.appendChild(inner);
  
  // Context Menu Events
  wrap.addEventListener('contextmenu', e => {
    e.preventDefault(); targetMsgId = msg.messageId; targetMsgText = msg.text || msg.fileName || msg.type;
    els.ctxMenu.style.left = `${e.pageX}px`; els.ctxMenu.style.top = `${e.pageY}px`;
    els.ctxDelete.style.display = isMine ? 'flex' : 'none';
    els.ctxMenu.classList.remove('hidden');
  });
  wrap.addEventListener('dblclick', e => {
    targetMsgId = msg.messageId;
    els.reactionPicker.style.left = `${e.pageX - 50}px`; els.reactionPicker.style.top = `${e.pageY - 40}px`;
    els.reactionPicker.classList.remove('hidden');
  });

  els.msgs.appendChild(wrap);
  if (!isMine && document.hasFocus()) observer.observe(wrap);
}

function addSystem(text) {
  const d = document.createElement('div'); d.className = 'system'; d.textContent = text;
  els.msgs.appendChild(d); els.msgs.scrollTop = els.msgs.scrollHeight;
}

// ─── INPUT HANDLING ───
els.input.addEventListener('input', () => {
  els.input.style.height = 'auto';
  els.input.style.height = Math.min(els.input.scrollHeight, 120) + 'px';
  if(!socket) return;
  if(!isTyping) { isTyping = true; socket.emit('typing'); }
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => { socket.emit('stop_typing'); isTyping = false; }, 1000);
});

els.input.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendText(); }
});
els.sendBtn.addEventListener('click', sendText);

function sendText() {
  const text = els.input.value;
  if (!text.trim() || !socket) return;
  const payload = { type: 'text', text: text };
  if (replyContext) { payload.replyTo = replyContext; closeReply(); }
  socket.emit('chat_message', payload);
  els.input.value = ''; els.input.style.height = 'auto';
  clearTimeout(typingTimeout); socket.emit('stop_typing'); isTyping = false;
}

// ─── FILE UPLOAD ───
els.attachBtn.onclick = () => els.fileIn.click();
els.fileIn.onchange = e => { if(e.target.files.length) handleFile(e.target.files[0]); };

document.addEventListener('dragover', e => { e.preventDefault(); els.dropOverlay.classList.remove('hidden'); });
els.dropOverlay.addEventListener('dragleave', e => els.dropOverlay.classList.add('hidden'));
els.dropOverlay.addEventListener('drop', e => {
  e.preventDefault(); els.dropOverlay.classList.add('hidden');
  if(e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
});

document.addEventListener('paste', e => {
  const items = e.clipboardData.items;
  for(let i=0; i<items.length; i++) {
    if(items[i].type.indexOf('image') !== -1) handleFile(items[i].getAsFile());
  }
});

function handleFile(file) {
  if(file.size > 10 * 1024 * 1024) return showToast("File exceeds 10MB limit");
  const reader = new FileReader();
  reader.onload = e => {
    socket.emit('chat_message', {
      type: file.type.startsWith('image/') ? 'image' : 'file',
      fileData: e.target.result, fileName: file.name, fileSize: file.size, fileType: file.type
    });
  };
  reader.readAsDataURL(file);
}

// ─── CONTEXT & REPLY ───
let targetMsgId = null; let targetMsgText = null;
document.addEventListener('click', e => {
  if(!e.target.closest('.context-menu')) els.ctxMenu.classList.add('hidden');
  if(!e.target.closest('.reaction-picker')) els.reactionPicker.classList.add('hidden');
  if(!e.target.closest('.dropdown-menu') && !e.target.closest('.header-btn')) {
    els.themeDrop.classList.remove('show'); els.wallDrop.classList.remove('show');
  }
});

els.ctxReply.onclick = () => {
  replyContext = { messageId: targetMsgId, username: document.querySelector(`[data-id="${targetMsgId}"] .username-lbl`)?.textContent || myUsername, preview: targetMsgText };
  els.replyName.textContent = replyContext.username; els.replyText.textContent = replyContext.preview;
  els.replyBar.classList.remove('hidden'); els.input.focus(); els.ctxMenu.classList.add('hidden');
};
function closeReply() { replyContext = null; els.replyBar.classList.add('hidden'); }
els.replyClose.onclick = closeReply;

els.ctxDelete.onclick = () => { socket.emit('delete_message', { messageId: targetMsgId }); els.ctxMenu.classList.add('hidden'); };
els.ctxReact.onclick = e => { els.ctxMenu.classList.add('hidden'); els.reactionPicker.style.left=`${e.pageX}px`; els.reactionPicker.style.top=`${e.pageY}px`; els.reactionPicker.classList.remove('hidden'); };

document.querySelectorAll('.reaction-btn').forEach(b => {
  b.onclick = () => { socket.emit('reaction', { messageId: targetMsgId, emoji: b.dataset.emoji }); els.reactionPicker.classList.add('hidden'); };
});

// ─── MEDIA PANEL (GIFs/Stickers) ───
els.gifBtn.onclick = () => els.mediaPanel.classList.toggle('hidden');
els.mediaClose.onclick = () => els.mediaPanel.classList.add('hidden');
document.querySelectorAll('.media-tab').forEach(b => {
  b.onclick = () => {
    document.querySelectorAll('.media-tab').forEach(t=>t.classList.remove('active')); b.classList.add('active');
    els.stickerGrid.classList.toggle('hidden', b.dataset.tab !== 'stickers');
    els.gifGrid.classList.toggle('hidden', b.dataset.tab !== 'gifs');
  };
});
// Dummy population
['😀','😂','😍','😎','😭','😡','👍','🎉'].forEach(s => {
  const d = document.createElement('div'); d.className='media-item'; d.style.fontSize='40px'; d.style.textAlign='center'; d.textContent=s;
  d.onclick = () => { socket.emit('chat_message', {type:'text', text: s}); els.mediaPanel.classList.add('hidden'); };
  els.stickerGrid.appendChild(d);
});
['https://media.giphy.com/media/xT0xezQGU5xCDJuCPe/giphy.gif','https://media.giphy.com/media/3o7TKSjRrfIPjeiVyM/giphy.gif'].forEach(url => {
  const img = document.createElement('img'); img.src=url; img.className='media-item';
  img.onclick = () => { socket.emit('chat_message', {type:'gif', gifUrl: url}); els.mediaPanel.classList.add('hidden'); };
  els.gifGrid.appendChild(img);
});

// ─── SEARCH ───
els.searchToggle.onclick = () => { els.searchBar.classList.toggle('hidden'); if(!els.searchBar.classList.contains('hidden')) els.searchIn.focus(); };
els.searchClose.onclick = () => { els.searchBar.classList.add('hidden'); clearSearch(); };
els.searchIn.addEventListener('input', e => doSearch(e.target.value));
function clearSearch() { searchMatches.forEach(el => { el.innerHTML = el.textContent; }); searchMatches = []; currentSearchIdx = -1; els.searchCount.textContent=''; }
function doSearch(query) {
  clearSearch(); if(!query.trim()) return;
  document.querySelectorAll('.content').forEach(el => {
    if(el.textContent.toLowerCase().includes(query.toLowerCase())) {
      const regex = new RegExp(`(${query})`, 'gi');
      el.innerHTML = el.innerHTML.replace(regex, '<mark>$1</mark>');
      searchMatches.push(el);
    }
  });
  els.searchCount.textContent = searchMatches.length ? `1/${searchMatches.length}` : '0/0';
  if(searchMatches.length) { currentSearchIdx=0; searchMatches[0].scrollIntoView({behavior:'smooth', block:'center'}); }
}
els.searchNext.onclick = () => { if(!searchMatches.length) return; currentSearchIdx = (currentSearchIdx+1)%searchMatches.length; searchMatches[currentSearchIdx].scrollIntoView(); els.searchCount.textContent=`${currentSearchIdx+1}/${searchMatches.length}`; };
els.searchPrev.onclick = () => { if(!searchMatches.length) return; currentSearchIdx = (currentSearchIdx-1+searchMatches.length)%searchMatches.length; searchMatches[currentSearchIdx].scrollIntoView(); els.searchCount.textContent=`${currentSearchIdx+1}/${searchMatches.length}`; };

// ─── THEMES & SETTINGS ───
function saveSettings() { localStorage.setItem('chatSettings', JSON.stringify(settings)); applySettings(); }
function applySettings() {
  document.documentElement.setAttribute('data-theme', settings.theme);
  document.documentElement.setAttribute('data-wallpaper', settings.wallpaper);
  els.soundOn.style.display = settings.muted ? 'none' : 'block';
  els.soundOff.style.display = settings.muted ? 'block' : 'none';
}
els.themeBtn.onclick = e => { e.stopPropagation(); els.themeDrop.classList.toggle('show'); };
els.wallBtn.onclick = e => { e.stopPropagation(); els.wallDrop.classList.toggle('show'); };
els.muteBtn.onclick = () => { settings.muted = !settings.muted; saveSettings(); showToast(settings.muted ? "Sounds muted" : "Sounds unmuted"); };
document.querySelectorAll('#theme-dropdown .dropdown-item').forEach(b => b.onclick = () => { settings.theme = b.dataset.theme; saveSettings(); els.themeDrop.classList.remove('show'); });
document.querySelectorAll('#wallpaper-dropdown .dropdown-item').forEach(b => b.onclick = () => { settings.wallpaper = b.dataset.wallpaper; saveSettings(); els.wallDrop.classList.remove('show'); });

// Lightbox
els.lightboxClose.onclick = () => els.lightbox.classList.add('hidden');

// Badge
els.msgs.addEventListener('scroll', () => {
  const isAtBottom = els.msgs.scrollHeight - els.msgs.scrollTop <= els.msgs.clientHeight + 50;
  if(isAtBottom) { els.unreadBadge.classList.add('hidden'); unreadCount = 0; }
});
els.unreadBadge.onclick = () => { els.msgs.scrollTop = els.msgs.scrollHeight; };

// ─── VOICE (Dummy implementation for brevity) ───
els.voiceBtn.onmousedown = () => { els.voiceBar.classList.remove('hidden'); els.input.parentElement.classList.add('hidden'); };
els.voiceCancel.onclick = () => { els.voiceBar.classList.add('hidden'); els.input.parentElement.classList.remove('hidden'); };
els.voiceSend.onclick = () => { els.voiceBar.classList.add('hidden'); els.input.parentElement.classList.remove('hidden'); socket.emit('chat_message', {type:'voice', fileData:'dummy'}); };
