/* ==========================================
   STORES SCREEN
   Список магазинов, добавление, удаление, выбор
   ========================================== */

const Screens = window.Screens || {};

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
      <div class="card empty-state">
        <h2>Нет магазинов</h2>
        <p>Добавь первый магазин, чтобы начать</p>
      </div>
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
    document.getElementById('new-store-name').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('btn-save-store').click();
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
        <div class="modal-text">
          «${UI.escape(store.name)}» и все его данные (импорты, рейлы, план) будут удалены. Это необратимо.
        </div>
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

window.Screens = Screens;
