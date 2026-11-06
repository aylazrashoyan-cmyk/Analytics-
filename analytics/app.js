/* ==========================================
   APP.JS - ЕДИНЫЙ ДВИЖОК ПРИЛОЖЕНИЯ
   ========================================== */

const App = {
  screen: 'home',
  dataKey: null,
  nav: [
    { id: 'home', icon: 'home', label: 'Главная' },
    { id: 'analytics', icon: 'chart', label: 'Аналитика' },
    { id: 'rails', icon: 'rail', label: 'Рейлы' },
    { id: 'settings', icon: 'settings', label: 'Настройки' },
  ],

  icons: {
    home: `<svg viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,
    chart: `<svg viewBox="0 0 24 24"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`,
    rail: `<svg viewBox="0 0 24 24"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>`,
    settings: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
  },

  async start(dataKey) {
    this.dataKey = dataKey;
    try {
      await DB.init(dataKey);
      this.renderHeader();
      this.renderNav();
      if (!DB.getStores().length) {
        this.route('stores');
      } else {
        this.route('home');
      }
    } catch (err) {
      console.error('App start error:', err);
      document.getElementById('screen').innerHTML = `<div class="empty-state"><h2>Ошибка загрузки</h2><p>${UI.escape(err.message)}</p></div>`;
    }
  },

  renderHeader() {
    const header = document.getElementById('app-header');
    const store = DB.getCurrentStore();
    if (!store) { header.innerHTML = ''; return; }
    header.innerHTML = `
      <button class="store-switch" id="store-switch">
        <span>🏬 ${UI.escape(store.name)}</span>
        <span>▾</span>
      </button>
      <div style="width: 40px"></div>
    `;
    document.getElementById('store-switch').addEventListener('click', () => this.openStoreSwitcher());
  },

  openStoreSwitcher() {
    const stores = DB.getStores();
    const current = DB.getCurrentStore();
    UI.modal(`
      <div class="modal-title">Магазины</div>
      ${stores.map(s => `
        <div class="list-item" onclick="window.App.switchStore('${s.id}')" style="cursor:pointer">
          <div class="item-name">${UI.escape(s.name)} ${s.id === current.id ? '✓' : ''}</div>
        </div>
      `).join('')}
      <button class="btn btn-secondary" style="margin-top:16px" onclick="window.App.route('stores')">Управление магазинами</button>
      <button class="btn btn-secondary" style="margin-top:8px" onclick="UI.closeModal()">Закрыть</button>
    `);
  },

  async switchStore(id) {
    await DB.setCurrentStore(id);
    UI.closeModal();
    this.renderHeader();
    this.route(this.screen);
  },

  renderNav() {
    const store = DB.getCurrentStore();
    const nav = document.getElementById('nav');
    if (!store) { nav.innerHTML = ''; return; }
    nav.innerHTML = this.nav.map(n => `
      <a class="nav-item ${this.screen === n.id ? 'active' : ''}" data-screen="${n.id}">
        ${this.icons[n.icon]}
        <span>${n.label}</span>
      </a>
    `).join('');
    nav.querySelectorAll('.nav-item').forEach(el => {
      el.addEventListener('click', () => this.route(el.dataset.screen));
    });
  },

  async route(screen) {
    this.screen = screen;
    this.renderNav();
    const root = document.getElementById('screen');
    root.innerHTML = '';
    const store = DB.getCurrentStore();
    if (!store && screen !== 'stores') { this.route('stores'); return; }

    try {
      if (screen === 'stores') await Screens.stores(root);
      if (screen === 'home') await Screens.home(root);
      if (screen === 'analytics') await Screens.analytics(root);
      if (screen === 'rails') await Screens.rails(root);
      if (screen === 'settings') await Screens.settings(root);
    } catch (err) {
      console.error('Route error:', err);
      root.innerHTML = `<div class="empty-state"><h2>Ошибка экрана</h2><p>${UI.escape(err.message)}</p></div>`;
    }
    window.scrollTo(0, 0);
  },
};

const UI = {
  toast(msg, type = 'default') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    document.getElementById('toast-container').appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 3000);
  },
  modal(html) {
    const root = document.getElementById('modal-root');
    root.innerHTML = `<div class="modal-content">${html}</div>`;
    root.classList.add('open');
    root.addEventListener('click', (e) => { if (e.target === root) this.closeModal(); });
  },
  closeModal() { document.getElementById('modal-root').classList.remove('open'); },
  escape(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); },
  fmt(n) { return Math.round(n || 0).toLocaleString('ru-RU'); },
  fmtPct(n) { return (n || 0).toFixed(1) + '%'; },
};

// ==========================================
// ЭКРАНЫ ПРИЛОЖЕНИЯ
// ==========================================
const Screens = {};

Screens.stores = async function(root) {
  const stores = DB.getStores();
  const current = DB.getCurrentStore();

  root.innerHTML = `
    <div class="header">
      <h1 class="h1">Магазины</h1>
      <button class="header-btn" id="btn-add-store">+</button>
    </div>
    ${stores.length ? stores.map(s => `
      <div class="card" style="display:flex;justify-content:space-between;align-items:center;padding:16px 20px">
        <div style="flex:1;cursor:pointer" data-store-id="${s.id}">
          <div class="item-name">${UI.escape(s.name)} ${s.id === current?.id ? '<span class="tag ok" style="margin-left:8px">текущий</span>' : ''}</div>
          <div class="item-desc">Добавлен ${new Date(s.createdAt).toLocaleDateString('ru-RU')}</div>
        </div>
        <button class="header-btn" data-delete-store="${s.id}" style="color:var(--danger)">🗑</button>
      </div>
    `).join('') : `
      <div class="card empty-state"><h2>Нет магазинов</h2><p>Добавь первый магазин, чтобы начать</p></div>
    `}
    <button class="btn btn-primary" id="btn-add-store-2" style="margin-top:8px">+ Добавить магазин</button>
  `;

  const openAdd = () => {
    UI.modal(`
      <div class="modal-title">Новый магазин</div>
      <input type="text" class="input" id="new-store-name" placeholder="Название магазина" autofocus>
      <button class="btn btn-primary" style="margin-top:16px" id="btn-save-store">Сохранить</button>
      <button class="btn btn-secondary" style="margin-top:8px" onclick="UI.closeModal()">Отмена</button>
    `);
    setTimeout(() => document.getElementById('new-store-name')?.focus(), 100);
    document.getElementById('btn-save-store').addEventListener('click', async () => {
      const name = document.getElementById('new-store-name').value.trim();
      if (!name) { UI.toast('Введи название', 'error'); return; }
      await DB.addStore(name);
      UI.closeModal();
      UI.toast('Магазин добавлен');
      App.renderHeader();
      App.route('stores');
    });
  };

  document.getElementById('btn-add-store').addEventListener('click', openAdd);
  document.getElementById('btn-add-store-2').addEventListener('click', openAdd);

  root.querySelectorAll('[data-store-id]').forEach(el => {
    el.addEventListener('click', async () => {
      await DB.setCurrentStore(el.dataset.storeId);
      App.renderHeader();
      UI.toast('Магазин выбран');
      App.route('home');
    });
  });

  root.querySelectorAll('[data-delete-store]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = el.dataset.deleteStore;
      const store = stores.find(s => s.id === id);
      UI.modal(`
        <div class="modal-title">Удалить магазин?</div>
        <div class="modal-text">«${UI.escape(store.name)}» и все его данные будут удалены.</div>
        <button class="btn btn-danger" id="btn-confirm-delete">Удалить</button>
        <button class="btn btn-secondary" style="margin-top:8px" onclick="UI.closeModal()">Отмена</button>
      `);
      document.getElementById('btn-confirm-delete').addEventListener('click', async () => {
        await DB.deleteStore(id);
        UI.closeModal();
        UI.toast('Магазин удалён');
        App.renderHeader();
        App.route('stores');
      });
    });
  });
};

Screens.home = async function(root) {
  const store = DB.getCurrentStore();
  const current = DB.getCurrentImport(store.id);

  if (!current) {
    root.innerHTML = `
      <div class="header"><h1 class="h1">Главная</h1></div>
      <div class="card empty-state">
        <h2>Нет данных</h2>
        <p>Загрузите Excel-файл, который мы сделали в нормализаторе</p>
        <input type="file" id="file-upload" accept=".xlsx" style="display:none">
        <button class="btn btn-primary" id="btn-upload">Загрузить Excel</button>
      </div>
    `;
    setupUpload(root);
    return;
  }

  const planKey = current.periodStart ? current.periodStart.slice(0, 7) : current.date.slice(0, 7);
  const plan = DB.getPlan(store.id, planKey);
  const planPct = plan > 0 ? Math.min(100, (current.totalSum / plan) * 100) : 0;
  
  root.innerHTML = `
    <div class="header">
      <div>
        <h1 class="h1">Главная</h1>
        <div class="subtitle">${current.periodLabel} · ${current.periodDays} дн.</div>
      </div>
      <div class="tag ${current.valid ? 'ok' : 'err'}">${current.valid ? 'ОК' : 'Ошибка'}</div>
    </div>
    <div class="card hero-card">
      <div class="card-title">Выручка магазина</div>
      <div class="hero-val num">${UI.fmt(current.totalSum)} ₽</div>
      <div class="hero-meta">
        <span>План: ${plan > 0 ? UI.fmt(plan) + ' ₽' : 'не задан'}</span>
        <span>${plan > 0 ? Math.round((current.totalSum / plan) * 100) + '%' : ''}</span>
      </div>
      <div class="progress-wrap"><div class="progress-bar" style="width:${planPct}%"></div></div>
      <div class="hero-meta" style="margin-top:10px"><span>Ср. чек: <b>${UI.fmt(current.avgCheck)} ₽</b></span></div>
    </div>
    <div class="card">
      <div class="card-title">Управление данными</div>
      <input type="file" id="file-upload" accept=".xlsx" style="display:none">
      <button class="btn btn-secondary" id="btn-upload">Загрузить новый Excel</button>
    </div>
    <div class="card">
      <div class="card-title">Дерево категорий (Топ-10)</div>
      ${renderTopCategories(current.roots)}
    </div>
  `;
  setupUpload(root);
};

function renderTopCategories(roots) {
  if (!roots || !roots.length) return '<p class="item-desc">Нет данных</p>';
  return roots.slice(0, 10).map(r => `
    <div class="list-item">
      <div><div class="item-name">${UI.escape(r.name)}</div><div class="item-desc">${r.children ? r.children.length : 0} вложенных</div></div>
      <div class="item-val num">${UI.fmt(r.sum)} ₽</div>
    </div>
  `).join('');
}

function setupUpload(root) {
  const fileInput = root.querySelector('#file-upload');
  const btnUpload = root.querySelector('#btn-upload');
  if (!btnUpload) return;
  btnUpload.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    UI.toast('Читаю файл...');
    try {
      const store = DB.getCurrentStore();
      const imp = await Parser.parse(file, store.id);
      if (!imp.valid && imp.errorMsg) {
        UI.toast(`Ошибка: итог ${imp.errorMsg.control} ≠ сумма ${imp.errorMsg.roots}`, 'error');
      } else {
        await DB.addImport(imp);
        UI.toast('Файл загружен!');
        App.route('home');
      }
    } catch (err) { UI.toast('Ошибка парсинга файла', 'error'); }
  });
}

Screens.analytics = async function(root) {
  root.innerHTML = `
    <div class="header"><h1 class="h1">Аналитика</h1></div>
    <div class="card empty-state"><h2>В разработке</h2><p>Здесь будет ABC-анализ и рекомендации.</p></div>
  `;
};

Screens.rails = async function(root) {
  root.innerHTML = `
    <div class="header"><h1 class="h1">Рейлы</h1></div>
    <div class="card empty-state"><h2>В разработке</h2><p>Здесь будет настройка рядов и привязка товаров.</p></div>
  `;
};

Screens.settings = async function(root) {
  const store = DB.getCurrentStore();
  const current = DB.getCurrentImport(store.id);
  const planKey = current?.periodStart ? current.periodStart.slice(0, 7) : new Date().toISOString().slice(0, 7);
  const currentPlan = DB.getPlan(store.id, planKey);

  root.innerHTML = `
    <div class="header"><h1 class="h1">Настройки</h1></div>
    <div class="card">
      <div class="card-title">План на месяц (${planKey})</div>
      <div class="input-group">
        <input type="number" class="input" id="plan-input" placeholder="Например, 1000000" value="${currentPlan || ''}">
        <button class="btn btn-primary" style="width:auto" id="btn-save-plan">OK</button>
      </div>
    </div>
    <div class="card">
      <div class="card-title">Данные магазина</div>
      <p class="item-desc" style="margin-bottom:12px">Загружено файлов: ${DB.getImports(store.id).length}</p>
      <button class="btn btn-danger" id="btn-clear">Очистить все данные</button>
    </div>
  `;

  document.getElementById('btn-save-plan').addEventListener('click', async () => {
    const val = parseFloat(document.getElementById('plan-input').value) || 0;
    await DB.setPlan(store.id, planKey, val);
    UI.toast('План сохранён');
    App.route('home');
  });

  document.getElementById('btn-clear').addEventListener('click', () => {
    UI.modal(`
      <div class="modal-title">Очистить данные?</div>
      <div class="modal-text">Все загруженные Excel-файлы будут удалены.</div>
      <button class="btn btn-danger" id="btn-confirm-clear">Да, удалить</button>
      <button class="btn btn-secondary" style="margin-top:8px" onclick="UI.closeModal()">Отмена</button>
    `);
    document.getElementById('btn-confirm-clear').addEventListener('click', async () => {
      await DB.clearImports(store.id);
      UI.closeModal();
      UI.toast('Данные очищены');
      App.route('home');
    });
  });
};

window.App = App;
window.UI = UI;
window.Screens = Screens;
