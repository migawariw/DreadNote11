import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut }
  from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, collection, doc, addDoc, setDoc, getDocs, deleteDoc, query, orderBy }
  from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";
const app      = initializeApp(firebaseConfig);
const auth     = getAuth(app);
const db       = getFirestore(app);
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });

// ── DOM ──
const viewLogin    = document.getElementById('view-login');
const viewApp      = document.getElementById('view-app');
const sidebar      = document.getElementById('sidebar');
const sidebarToggle = document.getElementById('sidebar-toggle');
const sidebarClose  = document.getElementById('sidebar-close');
const newChatBtn   = document.getElementById('new-chat-btn');
const newChatBtn2  = document.getElementById('new-chat-btn2');
const listPinned   = document.getElementById('list-pinned');
const listNormal   = document.getElementById('list-normal');
const pinnedSection = document.getElementById('pinned-section');
const userAvatar   = document.getElementById('user-avatar');
const userNameEl   = document.getElementById('user-name');
const goTrashBtn   = document.getElementById('go-trash-btn');
const darkBtn      = document.getElementById('dark-btn');
const logoutBtn    = document.getElementById('logout-btn');
const loginBtn     = document.getElementById('login-btn');
const headerTitle  = document.getElementById('header-title');
const paneEmpty    = document.getElementById('pane-empty');
const paneChat     = document.getElementById('pane-chat');
const paneTrash    = document.getElementById('pane-trash');
const chatFeed     = document.getElementById('chat-feed');
const inputEl      = document.getElementById('input');
const sendBtn      = document.getElementById('send-btn');
const trashList    = document.getElementById('trash-list');
const backFromTrash = document.getElementById('back-from-trash');
const emptyTrashBtn = document.getElementById('empty-trash-btn');
const toastEl      = document.getElementById('toast');

// ── State ──
// chats: {id, title, created, updated, pinned, pinnedDate, favorite, deleted}
// msgCache: {chatId: [{id, content, text, created, edited, editedAt}]}
let chats = [];
let currentChatId = null;
const msgCache = {};
let darkOn = localStorage.getItem('dn-dark') === '1';

// ── Dark mode ──
applyDark();
darkBtn.onclick = () => { darkOn = !darkOn; applyDark(); localStorage.setItem('dn-dark', darkOn ? '1' : '0'); };

function applyDark() {
  document.body.classList.toggle('dark', darkOn);
  document.documentElement.style.backgroundColor = darkOn ? '#000' : '';
  document.documentElement.style.colorScheme     = darkOn ? 'dark' : '';
  darkBtn.textContent = darkOn ? '☀️' : '🌙';
}

// ── Utilities ──
const WEEKDAYS = ['日','月','火','水','木','金','土'];
const pad = n => String(n).padStart(2,'0');

function sameDay(a, b) {
  return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate();
}

function formatTime(ts) {
  const d = new Date(ts), today = new Date();
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return sameDay(d, today) ? hm : `${d.getMonth()+1}/${d.getDate()} ${hm}`;
}

function formatDateLabel(ts) {
  const d = new Date(ts), today = new Date();
  if (sameDay(d, today)) return '今日';
  const m = d.getMonth()+1, day = d.getDate(), w = WEEKDAYS[d.getDay()];
  return today.getFullYear() === d.getFullYear()
    ? `${m}月${day}日(${w})` : `${d.getFullYear()}年${m}月${day}日(${w})`;
}

const URL_RE = /(https?:\/\/[^\s<>"]+)/g;

function escapeHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function linkify(text) {
  return escapeHtml(text).replace(URL_RE, url =>
    `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`
  );
}

let toastTimer;
function showToast(msg, ms = 3000) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms);
}

// ── Pane switching ──
function showPane(name) {
  [paneEmpty, paneChat, paneTrash].forEach(p => p.classList.remove('active'));
  const target = { empty: paneEmpty, chat: paneChat, trash: paneTrash }[name];
  if (target) target.classList.add('active');
}

// ── Sidebar ──
sidebarToggle.onclick = () => sidebar.classList.toggle('show');
sidebarClose.onclick  = () => sidebar.classList.remove('show');

document.addEventListener('click', e => {
  if (sidebar.classList.contains('show') &&
      !sidebar.contains(e.target) &&
      e.target !== sidebarToggle) {
    sidebar.classList.remove('show');
  }
});

function closeSidebar() { sidebar.classList.remove('show'); }

// ── Auth ──
loginBtn.onclick = async () => {
  try { await signInWithPopup(auth, provider); }
  catch(e) { showToast('ログイン失敗: ' + e.message); }
};

logoutBtn.onclick = async () => {
  closeSidebar();
  chats = [];
  currentChatId = null;
  await signOut(auth);
};

onAuthStateChanged(auth, async user => {
  document.body.classList.remove('auth-loading');
  if (!user) {
    viewLogin.hidden = false;
    viewApp.hidden   = true;
    return;
  }
  viewLogin.hidden = true;
  viewApp.hidden   = false;

  userAvatar.src    = user.photoURL || '';
  userAvatar.hidden = !user.photoURL;
  userNameEl.textContent = user.displayName || user.email || '';

  await loadChats(user.uid);
  renderChatList();

  const active = chats.filter(c => !c.deleted).sort((a,b) => b.updated - a.updated);
  if (active.length > 0) await selectChat(active[0].id);
  else showPane('empty');
});

// ── Firestore collections ──
const chatCol = uid => collection(db, 'users', uid, 'chats');
const msgCol  = (uid, cid) => collection(db, 'users', uid, 'chats', cid, 'messages');

// ── Load ──
async function loadChats(uid) {
  const snap = await getDocs(chatCol(uid));
  chats = snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function loadMessages(uid, chatId) {
  const q = query(msgCol(uid, chatId), orderBy('created', 'asc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ── Chat CRUD ──
async function createChat() {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  closeSidebar();
  const now = Date.now();
  const data = { title: '新しいチャット', created: now, updated: now, pinned: false, pinnedDate: null, favorite: false, deleted: false };
  const ref  = await addDoc(chatCol(uid), data);
  chats.push({ id: ref.id, ...data });
  renderChatList();
  await selectChat(ref.id);
}

newChatBtn.onclick  = createChat;
newChatBtn2.onclick = createChat;

async function selectChat(id) {
  currentChatId = id;
  if (!msgCache[id]) {
    msgCache[id] = await loadMessages(auth.currentUser.uid, id);
  }
  const chat = chats.find(c => c.id === id);
  headerTitle.textContent = chat?.title || '新しいチャット';
  renderChatList();
  renderMessages();
  showPane('chat');
  closeSidebar();
  if (window.innerWidth >= 768) inputEl.focus();
}

async function updateChat(uid, id, fields) {
  const chat = chats.find(c => c.id === id);
  if (chat) Object.assign(chat, fields);
  await setDoc(doc(db, 'users', uid, 'chats', id), fields, { merge: true });
}

async function softDeleteChat(uid, id) {
  await updateChat(uid, id, { deleted: true });
  if (currentChatId === id) {
    currentChatId = null;
    showPane('empty');
    headerTitle.textContent = '';
  }
  renderChatList();
  showToast('ゴミ箱へ移動しました');
}

async function restoreChat(uid, id) {
  await updateChat(uid, id, { deleted: false });
  renderTrash();
  renderChatList();
  showToast('復元しました');
}

async function permanentDeleteChat(uid, id) {
  const msgs = msgCache[id] || [];
  for (const msg of msgs) {
    await deleteDoc(doc(db, 'users', uid, 'chats', id, 'messages', msg.id)).catch(() => {});
  }
  await deleteDoc(doc(db, 'users', uid, 'chats', id));
  chats = chats.filter(c => c.id !== id);
  delete msgCache[id];
  renderTrash();
  renderChatList();
}

// ── Chat list rendering ──
function renderChatList() {
  const active = chats.filter(c => !c.deleted);
  const pinned = active.filter(c => c.pinned).sort((a,b) => (b.pinnedDate||b.updated) - (a.pinnedDate||a.updated));
  const normal = active.filter(c => !c.pinned).sort((a,b) => b.updated - a.updated);

  pinnedSection.hidden = pinned.length === 0;
  listPinned.innerHTML = '';
  listNormal.innerHTML = '';

  pinned.forEach(c => listPinned.appendChild(buildChatItem(c)));
  normal.forEach(c => listNormal.appendChild(buildChatItem(c)));
}

function buildChatItem(chat) {
  const uid = auth.currentUser.uid;
  const li  = document.createElement('li');
  li.className = 'chat-item'
    + (chat.id === currentChatId ? ' active' : '')
    + (chat.favorite ? ' is-favorite' : '');
  li.dataset.id = chat.id;

  const icon = document.createElement('span');
  icon.className   = 'chat-item-icon';
  icon.textContent = '💬';

  const main  = document.createElement('div');
  main.className = 'chat-item-main';

  const title = document.createElement('span');
  title.className   = 'chat-item-title';
  title.textContent = chat.title || '新しいチャット';
  main.appendChild(title);

  const actions = document.createElement('div');
  actions.className = 'chat-item-actions';

  // ピン
  const pinBtn = document.createElement('button');
  pinBtn.textContent = '📌';
  pinBtn.title = chat.pinned ? 'ピン解除' : 'ピン留め';
  pinBtn.style.opacity = chat.pinned ? '1' : '0.4';
  pinBtn.onclick = async e => {
    e.stopPropagation();
    if (chat.pinned) await updateChat(uid, chat.id, { pinned: false, pinnedDate: null });
    else             await updateChat(uid, chat.id, { pinned: true, pinnedDate: Date.now() });
    renderChatList();
  };

  // お気に入り
  const favBtn = document.createElement('button');
  favBtn.textContent = chat.favorite ? '★' : '☆';
  favBtn.title = chat.favorite ? 'お気に入り解除' : 'お気に入り';
  favBtn.style.color = chat.favorite ? '#f5a623' : '';
  favBtn.onclick = async e => {
    e.stopPropagation();
    await updateChat(uid, chat.id, { favorite: !chat.favorite });
    renderChatList();
  };

  // 削除
  const delBtn = document.createElement('button');
  delBtn.textContent = '🗑';
  delBtn.title = 'ゴミ箱へ';
  delBtn.onclick = async e => { e.stopPropagation(); await softDeleteChat(uid, chat.id); };

  actions.append(pinBtn, favBtn, delBtn);
  li.append(icon, main, actions);
  li.onclick = () => selectChat(chat.id);

  // モバイル長押し
  let pressTimer;
  li.addEventListener('touchstart', () => {
    pressTimer = setTimeout(() => actions.classList.toggle('force-show'), 600);
  }, { passive: true });
  li.addEventListener('touchend',  () => clearTimeout(pressTimer));
  li.addEventListener('touchmove', () => clearTimeout(pressTimer));

  return li;
}

// ── Message rendering ──
function renderMessages() {
  const msgs = (msgCache[currentChatId] || []).slice().sort((a,b) => a.created - b.created);
  chatFeed.innerHTML = '';

  if (msgs.length === 0) {
    const el = document.createElement('div');
    el.className   = 'empty-note';
    el.textContent = 'メッセージを入力してください';
    chatFeed.appendChild(el);
    return;
  }

  let lastDate = null;
  msgs.forEach(msg => {
    const ds = new Date(msg.created).toDateString();
    if (ds !== lastDate) {
      const div = document.createElement('div');
      div.className   = 'date-divider';
      div.textContent = formatDateLabel(msg.created);
      chatFeed.appendChild(div);
      lastDate = ds;
    }
    chatFeed.appendChild(buildBubble(msg));
  });

  chatFeed.scrollTop = chatFeed.scrollHeight;
}

function buildBubble(msg) {
  const uid    = auth.currentUser.uid;
  const chatId = currentChatId;
  const isImageOnly = !msg.text && msg.content?.includes('<img');

  const wrap = document.createElement('div');
  wrap.className = 'bubble-wrap';
  wrap.dataset.id = msg.id;

  const bubble = document.createElement('div');
  bubble.className = 'bubble';

  const content = document.createElement('div');
  content.className = 'bubble-content';
  content.innerHTML = msg.content || '';

  const footer = document.createElement('div');
  footer.className = 'bubble-footer';

  const meta = document.createElement('div');
  meta.className = 'bubble-meta';

  if (msg.edited) {
    const tag = document.createElement('span');
    tag.className   = 'edited-tag';
    tag.textContent = '編集済み';
    meta.appendChild(tag);
  }

  const timeEl = document.createElement('span');
  timeEl.className   = 'bubble-time';
  timeEl.textContent = formatTime(msg.created);
  meta.appendChild(timeEl);

  const actions = document.createElement('div');
  actions.className = 'bubble-actions';

  // 編集ボタン（テキストメッセージのみ）
  if (!isImageOnly) {
    const editBtn = document.createElement('button');
    editBtn.className   = 'bub-btn';
    editBtn.textContent = '✏️';
    editBtn.title       = '編集';
    editBtn.onclick = e => { e.stopPropagation(); enterEditMode(bubble, msg, uid, chatId); };
    actions.appendChild(editBtn);
  }

  // 削除ボタン
  const delBtn = document.createElement('button');
  delBtn.className   = 'bub-btn';
  delBtn.textContent = '🗑';
  delBtn.title       = '削除';
  delBtn.onclick = async e => {
    e.stopPropagation();
    if (!confirm('このメッセージを削除しますか？')) return;
    msgCache[chatId] = (msgCache[chatId] || []).filter(m => m.id !== msg.id);
    await deleteDoc(doc(db, 'users', uid, 'chats', chatId, 'messages', msg.id));
    renderMessages();
  };
  actions.appendChild(delBtn);

  footer.append(meta, actions);
  bubble.append(content, footer);
  wrap.appendChild(bubble);

  // モバイル長押しでアクション表示
  let pressTimer;
  bubble.addEventListener('touchstart', () => {
    pressTimer = setTimeout(() => actions.classList.toggle('force-show'), 500);
  }, { passive: true });
  bubble.addEventListener('touchend',  () => clearTimeout(pressTimer));
  bubble.addEventListener('touchmove', () => clearTimeout(pressTimer));

  return wrap;
}

// ── 編集モード ──
function enterEditMode(bubble, msg, uid, chatId) {
  bubble.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.className = 'edit-wrap';

  const textarea = document.createElement('textarea');
  textarea.className = 'edit-textarea';
  textarea.value = msg.text || '';

  requestAnimationFrame(() => {
    textarea.style.height = 'auto';
    textarea.style.height = textarea.scrollHeight + 'px';
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  });

  textarea.addEventListener('input', () => {
    textarea.style.height = 'auto';
    textarea.style.height = textarea.scrollHeight + 'px';
  });

  const buttons = document.createElement('div');
  buttons.className = 'edit-buttons';

  const cancelBtn = document.createElement('button');
  cancelBtn.className   = 'btn-cancel';
  cancelBtn.textContent = 'キャンセル';
  cancelBtn.onclick = () => renderMessages();

  const saveBtn = document.createElement('button');
  saveBtn.className   = 'btn-save';
  saveBtn.textContent = '保存';

  const doSave = async () => {
    const newText = textarea.value;
    if (!newText.trim()) return;
    const now     = Date.now();
    const content = linkify(newText);
    const updates = { content, text: newText, edited: true, editedAt: now };

    const cached = (msgCache[chatId] || []).find(m => m.id === msg.id);
    if (cached) Object.assign(cached, updates);

    await setDoc(doc(db, 'users', uid, 'chats', chatId, 'messages', msg.id), updates, { merge: true });
    renderMessages();
  };

  saveBtn.onclick = doSave;

  textarea.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSave(); }
    if (e.key === 'Escape') { e.preventDefault(); renderMessages(); }
  });

  buttons.append(cancelBtn, saveBtn);
  wrap.append(textarea, buttons);
  bubble.appendChild(wrap);
}

// ── メッセージ送信 ──
sendBtn.onclick = sendMessage;

inputEl.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});

async function sendMessage() {
  const uid = auth.currentUser?.uid;
  if (!uid || !currentChatId) return;
  const text = inputEl.value;
  if (!text.trim()) return;

  const now     = Date.now();
  const content = linkify(text);
  const data    = { content, text, created: now, edited: false, editedAt: null };
  const ref     = await addDoc(msgCol(uid, currentChatId), data);
  const msg     = { id: ref.id, ...data };

  if (!msgCache[currentChatId]) msgCache[currentChatId] = [];
  msgCache[currentChatId].push(msg);

  // チャットのメタ更新
  const chat = chats.find(c => c.id === currentChatId);
  if (chat) {
    const chatUpdate = { updated: now };
    // 初回メッセージでタイトル自動生成
    if (chat.title === '新しいチャット' && msgCache[currentChatId].length === 1) {
      chatUpdate.title = text.replace(/\n/g,' ').slice(0, 30);
      headerTitle.textContent = chatUpdate.title;
    }
    await updateChat(uid, currentChatId, chatUpdate);
  }

  inputEl.value = '';
  resizeInput();
  renderMessages();
  renderChatList();
  chatFeed.scrollTo({ top: chatFeed.scrollHeight, behavior: 'smooth' });
}

function resizeInput() {
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(inputEl.scrollHeight, 160) + 'px';
}
inputEl.addEventListener('input', resizeInput);

// ── ゴミ箱 ──
goTrashBtn.onclick = () => {
  showPane('trash');
  renderTrash();
  closeSidebar();
  headerTitle.textContent = 'ゴミ箱';
};

backFromTrash.onclick = () => {
  if (currentChatId) {
    const chat = chats.find(c => c.id === currentChatId);
    headerTitle.textContent = chat?.title || '';
    showPane('chat');
  } else {
    headerTitle.textContent = '';
    showPane('empty');
  }
};

function renderTrash() {
  const uid     = auth.currentUser?.uid;
  const deleted = chats.filter(c => c.deleted).sort((a,b) => b.updated - a.updated);
  trashList.innerHTML = '';

  if (deleted.length === 0) {
    const el = document.createElement('div');
    el.className   = 'empty-note';
    el.textContent = 'ゴミ箱は空です';
    trashList.appendChild(el);
    return;
  }

  deleted.forEach(chat => {
    const item = document.createElement('div');
    item.className = 'trash-item';

    const titleEl = document.createElement('span');
    titleEl.className   = 'trash-item-title';
    titleEl.textContent = chat.title || '新しいチャット';

    const acts = document.createElement('div');
    acts.className = 'trash-item-actions';

    const restoreBtn = document.createElement('button');
    restoreBtn.className   = 'btn-restore';
    restoreBtn.textContent = '↩️ 復元';
    restoreBtn.onclick = () => restoreChat(uid, chat.id);

    const delBtn = document.createElement('button');
    delBtn.className   = 'btn-perm-del';
    delBtn.textContent = '❌ 削除';
    delBtn.onclick = async () => {
      if (!confirm(`「${chat.title || '新しいチャット'}」を完全削除しますか？`)) return;
      await permanentDeleteChat(uid, chat.id);
    };

    acts.append(restoreBtn, delBtn);
    item.append(titleEl, acts);
    trashList.appendChild(item);
  });
}

emptyTrashBtn.onclick = async () => {
  const uid     = auth.currentUser?.uid;
  const deleted = chats.filter(c => c.deleted);
  if (!deleted.length) { showToast('ゴミ箱は空です'); return; }
  if (!confirm(`ゴミ箱内 ${deleted.length} 件を完全削除しますか？`)) return;
  for (const chat of deleted) await permanentDeleteChat(uid, chat.id);
  showToast('ゴミ箱を空にしました');
};

// ── 画像ペースト ──
document.addEventListener('paste', async e => {
  if (!auth.currentUser || !currentChatId || !paneChat.classList.contains('active')) return;
  const imgItem = [...(e.clipboardData?.items||[])].find(i => i.type.startsWith('image/'));
  if (!imgItem) return;
  e.preventDefault();
  const file = imgItem.getAsFile();
  if (file) await pasteImage(file);
});

async function pasteImage(file) {
  const uid = auth.currentUser?.uid;
  if (!uid || !currentChatId) return;
  showToast('画像を処理中...');

  const img = new Image();
  const blobUrl = URL.createObjectURL(file);
  img.src = blobUrl;
  await img.decode().catch(() => {});
  URL.revokeObjectURL(blobUrl);

  const MAX_W = 1024;
  let w = img.naturalWidth, h = img.naturalHeight;
  if (w > MAX_W) { h = Math.round(h * MAX_W / w); w = MAX_W; }

  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(img, 0, 0, w, h);

  let quality = 0.82;
  let blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', quality));
  while (blob.size > 120000 && quality > 0.15) {
    quality -= 0.1;
    blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', quality));
  }

  const base64 = await new Promise(r => {
    const fr = new FileReader();
    fr.onloadend = () => r(fr.result);
    fr.readAsDataURL(blob);
  });

  const now  = Date.now();
  const data = { content: `<img src="${base64}" alt="">`, text: null, created: now, edited: false, editedAt: null };
  const ref  = await addDoc(msgCol(uid, currentChatId), data);

  if (!msgCache[currentChatId]) msgCache[currentChatId] = [];
  msgCache[currentChatId].push({ id: ref.id, ...data });

  const chat = chats.find(c => c.id === currentChatId);
  if (chat) await updateChat(uid, currentChatId, { updated: now });

  renderMessages();
  renderChatList();
  chatFeed.scrollTo({ top: chatFeed.scrollHeight, behavior: 'smooth' });
  showToast('画像を追加しました');
}
