/* ==========================================
   НОРМАЛИЗАТОР 1С
   Вход: сырой xlsx из 1С
   Выход: чистый xlsx (уровень | имя | кол-во | сумма)
   ========================================== */

// ---------- STATE ----------
const State = {
  rows: [],        // { id, level, name, qty, sum, raw, flags: [] }
  removed: [],     // удалённый мусор
  issues: { errors: [], warnings: [], infos: [] },
  fileName: '',
};

// ---------- UTILS ----------
const Utils = {
  normalize(s) {
    return String(s ?? '')
      .toLowerCase()
      .replace(/ё/g, 'е')
      .replace(/\u00A0/g, ' ')
      .trim();
  },

  trimInvisible(s) {
    return String(s ?? '')
      .replace(/\u00A0/g, ' ')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .trim();
  },

  hasLatin(s) {
    return /[a-zA-Z]/.test(String(s ?? ''));
  },

  hasCyrillic(s) {
    return /[а-яА-Я]/.test(String(s ?? ''));
  },

  hasMixedScript(s) {
    return this.hasLatin(s) && this.hasCyrillic(s);
  },

  hasInvisible(s) {
    return /[\u00A0\u200B-\u200D\uFEFF]/.test(String(s ?? ''));
  },

  hasTrailingSpace(s) {
    return /\s$/.test(String(s ?? '')) || /^\s/.test(String(s ?? ''));
  },

  levenshtein(a, b) {
    a = String(a); b = String(b);
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    const prev = new Array(b.length + 1);
    for (let j = 0; j <= b.length; j++) prev[j] = j;
    for (let i = 1; i <= a.length; i++) {
      let curr = [i];
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        curr[j] = Math.min(
          curr[j - 1] + 1,
          prev[j] + 1,
          prev[j - 1] + cost
        );
      }
      for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
    }
    return prev[b.length];
  },

  toNum(v) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    const cleaned = String(v).replace(/[\s\u00A0]/g, '').replace(',', '.');
    const n = parseFloat(cleaned);
    return Number.isFinite(n) ? n : null;
  },

  fmtSum(n) {
    if (n === null || n === undefined) return '';
    return Math.round(n).toLocaleString('ru-RU');
  },
};

// ---------- READ ----------
const Reader = {
  read(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const wb = XLSX.read(e.target.result, { type: 'array', cellStyles: true });
          const sheet = wb.Sheets[wb.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });
          resolve(rows);
        } catch (err) { reject(err); }
      };
      reader.onerror = () => reject(new Error('FileReader error'));
      reader.readAsArrayBuffer(file);
    });
  },
};

// ---------- CLEAN ----------
const Cleaner = {
  // Известный мусор — удаляем автоматом
  KNOWN_JUNK: [
    /^номенклатура$/i,
    /^отбор[:\s]/i,
    /^количество товаров$/i,
    /^сумма продаж/i,
    /^итого$/i,        // контрольную строку сохраняем отдельно
    /^всего$/i,
    /^мода$/i,
  ],

  clean(rawRows) {
    const out = [];
    const removed = [];
    let controlRow = null;

    for (let i = 0; i < rawRows.length; i++) {
      const r = rawRows[i] || [];
      const a = r[0];
      const b = r[1] ?? null;
      const c = r[2] ?? null;
      const d = r[3] ?? null;
      const e = r[4] ?? null;

      // Пустая строка
      if (a === null && b === null && c === null && d === null && e === null) {
        continue;
      }
      if (String(a ?? '').trim() === '' && String(b ?? '').trim() === '') continue;

      const name = Utils.trimInvisible(a);
      if (!name) { continue; }

      // Контрольная строка «Итого» / «Мода» / «Всего»
      if (/^(итого|всего|мода)$/i.test(name)) {
        // определяем, где сумма: в 4-й или 5-й колонке
        const sumVal = Utils.toNum(e) ?? Utils.toNum(d) ?? Utils.toNum(c) ?? Utils.toNum(b);
        const qtyVal = Utils.toNum(d) ?? Utils.toNum(c);
        controlRow = { name, qty: qtyVal, sum: sumVal, rawIdx: i };
        removed.push({ idx: i + 1, name, reason: 'контрольная строка → перенесена вниз' });
        continue;
      }

      // Известный мусор
      let isJunk = false;
      for (const re of this.KNOWN_JUNK) {
        if (re.test(name)) { isJunk = true; break; }
      }
      if (isJunk) {
        removed.push({ idx: i + 1, name, reason: 'известный мусор' });
        continue;
      }

      // Определяем колонки: qty и sum.
      // В 1С: A=имя, B=пусто, C=кол-во, D=сумма, E=сумма без скидки
      // Или: A=имя, B=кол-во, C=сумма
      // Пытаемся найти: имя в A, два числа в оставшихся
      let qty = null, sum = null;
      const nums = [b, c, d, e].map(v => Utils.toNum(v)).filter(v => v !== null);
      // Если в строке 3 числа (b,c,d,e) — берём предпоследнее как qty, последнее как sum
      // Но точнее: ищем по позициям. В нашем случае:
      //   c = qty, d = sum, e = sum без скидки
      // Если e заполнено и d заполнено — берём d (сумма со скидкой) или e?
      // В файле 1С: D = «Количество товаров» по шапке? Нет:
      //   шапка: A=Номенклатура, D=Количество товаров, E=Сумма продаж без скидки
      //   значит qty в D (индекс 3), sum в E (индекс 4)
      // Но у нас в данных: «Одежда | | | 152 | 182298» → c=null? Нет:
      //   row = [a, b, c, d, e] = [«Одежда», null, null, 152, 182298]
      //   т.е. qty в d (индекс 3), sum в e (индекс 4)
      // Проверим: у папок qty null, sum есть. У листьев qty есть, sum есть.
      // Универсально: qty = первое число, sum = второе число (если оба есть)
      // Если одно число — это sum (у папок), qty = null
      const rawQty = Utils.toNum(d);  // D
      const rawSum = Utils.toNum(e);  // E
      if (rawSum !== null) {
        qty = rawQty;
        sum = rawSum;
      } else {
        // fallback: если E пусто, пробуем C/D
        const cNum = Utils.toNum(c);
        const dNum = Utils.toNum(d);
        if (dNum !== null && cNum === null) { sum = dNum; qty = null; }
        else if (cNum !== null && dNum !== null) { qty = cNum; sum = dNum; }
        else if (dNum !== null && cNum !== null) { qty = dNum; sum = null; }
        else if (cNum !== null && dNum === null) { sum = cNum; qty = null; }
        else { sum = null; qty = null; }
      }

      // Если ни qty, ни sum — возможно, это тоже мусор
      if (qty === null && sum === null) {
        removed.push({ idx: i + 1, name, reason: 'нет чисел (ни кол-ва, ни суммы)' });
        continue;
      }

      out.push({
        id: out.length,
        level: null,           // заполним в guessLevels
        name,
        qty,
        sum,
        rawIdx: i,
        flags: [],
      });
    }

    // Контрольную строку добавляем в конец (уровень 0)
    if (controlRow) {
      out.push({
        id: out.length,
        level: 0,
        name: controlRow.name || 'ИТОГО',
        qty: controlRow.qty,
        sum: controlRow.sum,
        rawIdx: controlRow.rawIdx,
        flags: [],
        isControl: true,
      });
    }

    return { rows: out, removed };
  },
};

// ---------- GUESS ----------
const Guesser = {
  guess(rows) {
    // Эвристики:
    // 1. Листья (есть qty и sum) → уровень 3
    // 2. Папки (только sum, без qty) → null (разметить вручную)
    // 3. Контрольная → 0 (уже стоит)
    // 4. Если имя похоже на «Мужская/Женская/Детская/Девочки/Мальчики» → уровень 2
    // 5. Корневые (Одежда/Обувь/Аксессуары/Распродажа) → уровень 1

    const ROOT_HINTS = /^(одежда|обувь|аксессуары|распродажа)$/i;
    const SUB_HINTS = /^(мужская|женская|детская|девочки|мальчики|унисекс)$/i;

    for (const row of rows) {
      if (row.isControl) { row.level = 0; continue; }
      if (row.level !== null) continue; // уже размечено

      const norm = Utils.normalize(row.name);

      if (ROOT_HINTS.test(norm)) { row.level = 1; continue; }
      if (SUB_HINTS.test(norm)) { row.level = 2; continue; }

      if (row.qty !== null && row.sum !== null) {
        row.level = 3; // лист
      } else if (row.sum !== null && row.qty === null) {
        row.level = null; // папка — разметить вручную
      } else {
        row.level = null;
      }
    }
  },
};

// ---------- CHECKS ----------
const Checks = {
  run(rows) {
    const errors = [];
    const warnings = [];
    const infos = [];

    // Разбиваем на «дерево» по уровням для проверок
    const nonControl = rows.filter(r => !r.isControl);
    const control = rows.find(r => r.isControl);

    // ---- 1. Первый уровень должен быть 1 ----
    const firstWithLevel = nonControl.find(r => r.level !== null);
    if (firstWithLevel && firstWithLevel.level !== 1) {
      errors.push({
        rowId: firstWithLevel.id,
        text: `Строка ${firstWithLevel.id + 1}: первый уровень = ${firstWithLevel.level}, ожидался 1 (корень)`,
      });
    }

    // ---- 2. Пропущен уровень ----
    let prevLevel = 0;
    for (let i = 0; i < nonControl.length; i++) {
      const row = nonControl[i];
      if (row.level === null) continue; // не размечено — пропускаем (это не ошибка, а «надо разметить»)
      if (row.level > prevLevel + 1) {
        errors.push({
          rowId: row.id,
          text: `Строка ${row.id + 1} «${row.name}»: уровень ${row.level}, а предыдущий ${prevLevel} — пропущен уровень ${prevLevel + 1}`,
        });
      }
      prevLevel = row.level;
    }

    // ---- 3. Неразмеченные папки ----
    const unset = nonControl.filter(r => r.level === null);
    if (unset.length) {
      errors.push({
        rowId: unset[0].id,
        text: `Не размечено уровней: ${unset.length} строк. Проставь уровень в таблице.`,
      });
    }

    // ---- 4. Сумма детей ≠ родитель ----
    // Строим дерево по уровням
    const tree = this.buildTree(nonControl);
    this.checkSums(tree, errors, warnings);

    // ---- 5. Итого ≠ сумма корней ----
    if (control) {
      const rootsSum = tree.reduce((acc, n) => acc + (n.row.sum || 0), 0);
      const diff = Math.abs(rootsSum - (control.sum || 0));
      if (diff > 1) {
        errors.push({
          rowId: control.id,
          text: `ИТОГО: ${Utils.fmtSum(control.sum)} ₽, а сумма корней ${Utils.fmtSum(rootsSum)} ₽ — расхождение ${Utils.fmtSum(diff)} ₽`,
        });
      } else {
        infos.push({
          rowId: control.id,
          text: `ИТОГО сходится: ${Utils.fmtSum(control.sum)} ₽`,
        });
      }
    } else {
      warnings.push({
        rowId: null,
        text: `Нет контрольной строки (ИТОГО/Мода/Всего) — проверка сумм по корням недоступна`,
      });
    }

    // ---- 6. Дубли имён под одним родителем ----
    this.checkDuplicates(tree, errors, warnings);

    // ---- 7. Опечатки (Левенштейн) ----
    this.checkTypos(tree, warnings, infos);

    // ---- 8. Отрицательные суммы ----
    for (const row of nonControl) {
      if (row.sum !== null && row.sum < 0) {
        warnings.push({
          rowId: row.id,
          text: `Строка ${row.id + 1} «${row.name}»: сумма отрицательная (${Utils.fmtSum(row.sum)} ₽)`,
        });
      }
    }

    // ---- 9. Кол-во у папки ----
    for (const row of nonControl) {
      if (row.level !== null && row.level < 3 && row.qty !== null && row.qty > 0) {
        warnings.push({
          rowId: row.id,
          text: `Строка ${row.id + 1} «${row.name}»: папка (уровень ${row.level}), но кол-во ${row.qty}`,
        });
      }
    }

    // ---- 10. Лист без суммы ----
    for (const row of nonControl) {
      if (row.level === 3 && row.sum === null) {
        errors.push({
          rowId: row.id,
          text: `Строка ${row.id + 1} «${row.name}»: лист (уровень 3), но сумма пустая`,
        });
      }
    }

    // ---- 11. Сумма 0 при кол-ве > 0 ----
    for (const row of nonControl) {
      if (row.qty !== null && row.qty > 0 && row.sum === 0) {
        warnings.push({
          rowId: row.id,
          text: `Строка ${row.id + 1} «${row.name}»: кол-во ${row.qty}, но сумма 0`,
        });
      }
    }

    // ---- 12. Латинские буквы ----
    for (const row of nonControl) {
      if (Utils.hasLatin(row.name)) {
        warnings.push({
          rowId: row.id,
          text: `Строка ${row.id + 1} «${row.name}»: есть латинские буквы`,
        });
      }
    }

    // ---- 13. Невидимые символы ----
    for (const row of nonControl) {
      if (Utils.hasInvisible(row.name)) {
        warnings.push({
          rowId: row.id,
          text: `Строка ${row.id + 1} «${row.name}»: невидимые символы (nbsp/zero-width)`,
        });
      }
    }

    // ---- 14. Пробелы по краям ----
    for (const row of nonControl) {
      if (Utils.hasTrailingSpace(row.name)) {
        warnings.push({
          rowId: row.id,
          text: `Строка ${row.id + 1} «${row.name}»: пробел в начале или конце имени`,
        });
      }
    }

    return { errors, warnings, infos };
  },

  buildTree(rows) {
    const roots = [];
    const stack = [];
    for (const row of rows) {
      if (row.level === null) continue;
      const node = { row, children: [] };
      while (stack.length && stack[stack.length - 1].row.level >= row.level) stack.pop();
      if (stack.length) stack[stack.length - 1].children.push(node);
      else roots.push(node);
      stack.push(node);
    }
    return roots;
  },

  checkSums(tree, errors, warnings) {
    const walk = (nodes, parentName) => {
      for (const node of nodes) {
        const { row, children } = node;
        if (children.length === 0) continue; // лист — нечего сверять
        const childrenSum = children.reduce((acc, c) => acc + (c.row.sum || 0), 0);
        const parentSum = row.sum || 0;
        const diff = Math.abs(childrenSum - parentSum);
        if (diff > 1) {
          errors.push({
            rowId: row.id,
            text: `«${row.name}»: сумма ${Utils.fmtSum(parentSum)} ₽, а сумма детей ${Utils.fmtSum(childrenSum)} ₽ — расхождение ${Utils.fmtSum(diff)} ₽`,
          });
        }
        walk(children, row.name);
      }
    };
    walk(tree, '');
  },

  checkDuplicates(tree, errors, warnings) {
    const walk = (nodes, parentPath) => {
      const seen = new Map();
      for (const node of nodes) {
        const norm = Utils.normalize(node.row.name);
        if (seen.has(norm)) {
          warnings.push({
            rowId: node.row.id,
            text: `Дубль имени «${node.row.name}» под «${parentPath || 'корень'}» (строки ${seen.get(norm) + 1} и ${node.row.id + 1})`,
          });
        } else {
          seen.set(norm, node.row.id);
        }
        walk(node.children, parentPath ? `${parentPath} > ${node.row.name}` : node.row.name);
      }
    };
    walk(tree, '');
  },

  checkTypos(tree, warnings, infos) {
    const walk = (nodes, parentPath) => {
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i].row;
          const b = nodes[j].row;
          const normA = Utils.normalize(a.name);
          const normB = Utils.normalize(b.name);
          if (normA === normB) continue; // точный дубль — уже проверили
          const dist = Utils.levenshtein(normA, normB);
          const threshold = Math.min(normA.length, normB.length) >= 5 ? 2 : 1;
          if (dist > 0 && dist <= threshold) {
            warnings.push({
              rowId: b.id,
              text: `Возможная опечатка: «${a.name}» (строка ${a.id + 1}) и «${b.name}» (строка ${b.id + 1}) — расстояние ${dist}`,
            });
          }
        }
        walk(nodes[i].children, parentPath ? `${parentPath} > ${nodes[i].row.name}` : nodes[i].row.name);
      }
    };
    walk(tree, '');
  },
};

// ---------- UI ----------
const UI = {
  toast(msg, type = 'default') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    document.getElementById('toast-container').appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 3000);
  },

  renderAll() {
    this.renderSummary();
    this.renderTable();
    this.renderIssues();
    this.updateExportButton();
  },

  renderSummary() {
    const card = document.getElementById('summary-card');
    card.classList.remove('hidden');
    document.getElementById('sum-rows').textContent = State.rows.length;
    const e = State.issues.errors.length;
    const w = State.issues.warnings.length;
    const i = State.issues.infos.length;
    const bE = document.getElementById('sum-errors');
    const bW = document.getElementById('sum-warnings');
    const bI = document.getElementById('sum-infos');
    bE.textContent = `🔴 ${e}`;
    bW.textContent = `🟡 ${w}`;
    bI.textContent = `ℹ ${i}`;
    bE.className = 'badge ' + (e ? 'err' : '');
    bW.className = 'badge ' + (w ? 'warn' : '');
    bI.className = 'badge ' + (i ? 'info' : '');
    document.getElementById('removed-count').textContent = State.removed.length;
  },

  renderTable() {
    const card = document.getElementById('table-card');
    card.classList.remove('hidden');
    const tbody = document.getElementById('table-body');
    const errorRows = new Set(State.issues.errors.map(x => x.rowId));
    const warnRows = new Set(State.issues.warnings.map(x => x.rowId));

    tbody.innerHTML = State.rows.map((row, idx) => {
      const rowClass = errorRows.has(row.id) ? 'row-err' : warnRows.has(row.id) ? 'row-warn' : '';
      const flag = errorRows.has(row.id) ? '🔴' : warnRows.has(row.id) ? '🟡' : '';
      const levelClass = row.level === null ? 'lvl-unset' : `lvl-${row.level}`;
      const levelOpts = [0,1,2,3].map(l =>
        `<option value="${l}" ${row.level === l ? 'selected' : ''}>${l}</option>`
      ).join('');
      return `
        <tr data-row-id="${row.id}" class="${rowClass}">
          <td class="td-num">${idx + 1}</td>
          <td>
            <select class="level-select ${levelClass}" data-id="${row.id}">
              <option value="" ${row.level === null ? 'selected' : ''}>—</option>
              ${levelOpts}
            </select>
          </td>
          <td class="td-name" title="${this.escape(row.name)}">${this.escape(row.name)}</td>
          <td class="td-qty">${row.qty !== null ? row.qty : ''}</td>
          <td class="td-sum">${row.sum !== null ? Utils.fmtSum(row.sum) : ''}</td>
          <td class="td-flag">${flag}</td>
        </tr>
      `;
    }).join('');

    // Обработчик смены уровня
    tbody.querySelectorAll('.level-select').forEach(sel => {
      sel.addEventListener('change', (e) => {
        const id = Number(e.target.dataset.id);
        const val = e.target.value;
        const row = State.rows.find(r => r.id === id);
        if (row) {
          row.level = val === '' ? null : Number(val);
          State.issues = Checks.run(State.rows);
          UI.renderAll();
        }
      });
    });
  },

  renderIssues() {
    const card = document.getElementById('issues-card');
    card.classList.remove('hidden');

    const blockE = document.getElementById('issues-errors');
    const blockW = document.getElementById('issues-warnings');
    const blockI = document.getElementById('issues-infos');

    const renderBlock = (block, list, type) => {
      if (!list.length) { block.innerHTML = ''; return; }
      block.innerHTML = list.map(item => `
        <div class="issue-item ${type}" data-row-id="${item.rowId ?? ''}">
          <span class="issue-icon">${type === 'error' ? '🔴' : type === 'warn' ? '🟡' : 'ℹ'}</span>
          <span class="issue-text">${this.escape(item.text)}</span>
        </div>
      `).join('');
    };

    renderBlock(blockE, State.issues.errors, 'error');
    renderBlock(blockW, State.issues.warnings, 'warn');
    renderBlock(blockI, State.issues.infos, 'info');

    // Клик по ошибке → скролл к строке
    card.querySelectorAll('.issue-item').forEach(el => {
      el.addEventListener('click', () => {
        const rowId = el.dataset.rowId;
        if (rowId === '' || rowId === undefined) return;
        const tr = document.querySelector(`tr[data-row-id="${rowId}"]`);
        if (tr) {
          tr.scrollIntoView({ behavior: 'smooth', block: 'center' });
          tr.classList.add('row-flash');
          setTimeout(() => tr.classList.remove('row-flash'), 1000);
        }
      });
    });
  },

  updateExportButton() {
    const actions = document.getElementById('actions-card');
    actions.classList.remove('hidden');
    const btn = document.getElementById('btn-export');
    const hint = document.getElementById('export-hint');
    const hasErrors = State.issues.errors.length > 0;
    btn.disabled = hasErrors;
    if (hasErrors) {
      hint.textContent = `Исправь ${State.issues.errors.length} красных ошибок, чтобы скачать`;
    } else if (State.issues.warnings.length) {
      hint.textContent = `Есть ${State.issues.warnings.length} предупреждений — можно скачать, но проверь`;
    } else {
      hint.textContent = 'Всё ок — можно скачать';
    }
  },

  renderRemoved() {
    const list = document.getElementById('removed-list');
    const btn = document.getElementById('btn-show-removed');
    if (!State.removed.length) { list.innerHTML = '<div class="removed-item">Пусто</div>'; return; }
    list.innerHTML = State.removed.map(r =>
      `<div class="removed-item">Строка ${r.idx}: «${this.escape(r.name)}» — ${r.reason}</div>`
    ).join('');
  },

  escape(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  },
};

// ---------- EXPORT ----------
const Exporter = {
  export() {
    // Формируем данные: уровень | имя | кол-во | сумма
    const data = State.rows.map(row => {
      // чистим имя
      const name = Utils.trimInvisible(row.name);
      return [row.level, name, row.qty, row.sum];
    });

    // Создаём workbook
    const ws = XLSX.utils.aoa_to_sheet(data);
    // Ширина колонок
    ws['!cols'] = [
      { wch: 8 },  // уровень
      { wch: 40 }, // имя
      { wch: 10 }, // кол-во
      { wch: 14 }, // сумма
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Данные');

    // Имя файла: исходное + _clean
    const base = State.fileName.replace(/\.xlsx?$/i, '');
    const outName = `${base}_clean.xlsx`;

    XLSX.writeFile(wb, outName);
    UI.toast(`Скачано: ${outName}`);
  },
};

// ---------- MAIN ----------
document.addEventListener('DOMContentLoaded', () => {
  const fileInput = document.getElementById('file-input');
  const btnUpload = document.getElementById('btn-upload');
  const btnValidate = document.getElementById('btn-validate');
  const btnExport = document.getElementById('btn-export');
  const btnShowRemoved = document.getElementById('btn-show-removed');

  btnUpload.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    State.fileName = file.name;
    document.getElementById('file-info').textContent = `Файл: ${file.name}`;
    UI.toast('Читаю файл...');
    try {
      const rawRows = await Reader.read(file);
      const { rows, removed } = Cleaner.clean(rawRows);
      if (!rows.length) {
        UI.toast('Не найдено строк с данными', 'error');
        return;
      }
      Guesser.guess(rows);
      State.rows = rows;
      State.removed = removed;
      State.issues = Checks.run(rows);
      UI.renderRemoved();
      UI.renderAll();
      UI.toast(`Загружено: ${rows.length} строк, удалено мусора: ${removed.length}`);
    } catch (err) {
      console.error(err);
      UI.toast('Ошибка чтения файла', 'error');
    }
  });

  btnValidate.addEventListener('click', () => {
    State.issues = Checks.run(State.rows);
    UI.renderAll();
    UI.toast('Проверено');
  });

  btnExport.addEventListener('click', () => {
    if (State.issues.errors.length) {
      UI.toast('Есть красные ошибки — исправь', 'error');
      return;
    }
    Exporter.export();
  });

  btnShowRemoved.addEventListener('click', () => {
    const list = document.getElementById('removed-list');
    list.classList.toggle('hidden');
  });
});
