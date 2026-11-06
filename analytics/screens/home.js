/* ==========================================
   HOME SCREEN
   ========================================== */

const Screens = window.Screens || {};

Screens.home = async function(root) {
  const store = DB.getCurrentStore();
  const current = DB.getCurrentImport(store.id);

  if (!current) {
    // Если файлов нет — показываем экран загрузки
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

  // Если файл есть — показываем статистику
  const planKey = current.periodStart ? current.periodStart.slice(0, 7) : current.date.slice(0, 7);
  const plan = DB.getPlan(store.id, planKey);
  const planPct = plan > 0 ? Math.min(100, (current.totalSum / plan) * 100) : 0;
  
  root.innerHTML = `
    <div class="header">
      <div>
        <h1 class="h1">Главная</h1>
        <div class="subtitle">${current.periodLabel} · ${current.periodDays} дн.</div>
      </div>
      <div class="tag ${current.valid ? 'ok' : 'err'}" id="err-tag">
        ${current.valid ? 'ОК' : 'Ошибка'}
      </div>
    </div>

    <div class="card hero-card">
      <div class="card-title">Выручка магазина</div>
      <div class="hero-val num">${UI.fmt(current.totalSum)} ₽</div>
      <div class="hero-meta">
        <span>План: ${plan > 0 ? UI.fmt(plan) + ' ₽' : 'не задан'}</span>
        <span>${plan > 0 ? Math.round((current.totalSum / plan) * 100) + '%' : ''}</span>
      </div>
      <div class="progress-wrap"><div class="progress-bar" style="width:${planPct}%"></div></div>
      <div class="hero-meta" style="margin-top:10px">
        <span>Ср. чек: <b>${UI.fmt(current.avgCheck)} ₽</b></span>
      </div>
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
      <div>
        <div class="item-name">${UI.escape(r.name)}</div>
        <div class="item-desc">${r.children ? r.children.length : 0} вложенных</div>
      </div>
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
        App.route('home'); // перерисовываем
      }
    } catch (err) {
      console.error(err);
      UI.toast('Ошибка парсинга файла', 'error');
    }
  });
}

window.Screens = Screens;
