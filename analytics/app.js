/* ==========================================
   APP ROUTER
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
    if (!store) {
      header.innerHTML = '';
      return;
    }
    header.innerHTML = `
      <button class="store-switch" id="store-switch">
        <span>🏬 ${UI.escape(store.name)}</span>
        <span>▾</span>
      </button>
      <div style="width: 40px"></div>
    `;
    document.getElementById('store-switch').addEventListener('click', () => {
      this.openStoreSwitcher();
    });
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
    if (!store) {
      nav.innerHTML = '';
      return;
    }
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
    if (!store && screen !== 'stores') {
      this.route('stores');
      return;
    }

    try {
      if (screen === 'stores' && Screens.stores) await Screens.stores(root);
      if (screen === 'home' && Screens.home) await Screens.home(root);
      if (screen === 'analytics' && Screens.analytics) await Screens.analytics(root);
      if (screen === 'rails' && Screens.rails) await Screens.rails(root);
      if (screen === 'settings' && Screens.settings) await Screens.settings(root);
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

window.App = App;
window.UI = UI;
