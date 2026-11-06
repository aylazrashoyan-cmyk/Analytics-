const Screens = window.Screens || {};

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
      <div class="modal-text">Все загруженные Excel-файлы будут удалены. Настройки рейлов останутся.</div>
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

window.Screens = Screens;
