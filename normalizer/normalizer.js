// ==========================================
// НОРМАЛИЗАТОР 1С — v1.1 (Полный код)
// ==========================================

const CONFIG = {
  LEVENSHTEIN_SHORT: 1, 
  LEVENSHTEIN_LONG: 2, 
  SUM_TOLERANCE: 1, 
  BIG_SUM_MULTIPLIER: 5,
  GARBAGE_NAMES: ['номенклатура', 'отбор', 'итого', 'мода', 'всего', 'продажи', 'магазин', 'склад', 'торговый зал'],
};

// ==========================================
// УТИЛИТЫ
// ==========================================
const Utils = {
  toNum(v) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return v;
    const cleaned = String(v).replace(/[\s\u00A0]/g, '').replace(',', '.');
    const n = parseFloat(cleaned);
    return Number.isFinite(n) ? n : null;
  },
  normalize(s) { 
    return String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim(); 
  },
  hasLatin(s) { return /[a-zA-Z]/.test(String(s || '')); },
  hasCyrillic(s) { return /[а-яА-ЯёЁ]/.test(String(s || '')); },
  hasInvisible(s) { return /[\u00A0\u200B\uFEFF\u2007\u202F]/.test(String(s || '')); },
  hasTrailingSpace(s) { return /^\s|\s$/.test(String(s || '')); },
  hasDoubleSpace(s) { return /\s{2,}/.test(String(s || '')); },
  
  levenshtein(a, b) {
    a = String(a || ''); b = String(b || '');
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    const matrix = Array.from({ length: b.length + 1 }, (_, i) => [i]);
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        const cost = a[j - 1] === b[i - 1] ? 0 : 1;
        matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost);
      }
    }
    return matrix[b.length][a.length];
  },
  
  median(nums) {
    const arr = nums.filter(n => Number.isFinite(n)).sort((a, b) => a - b);
    if (!arr.length) return 0;
    const mid = Math.floor(arr.length / 2);
    return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
  },
  
  isGarbageName(name) {
    const n = Utils.normalize(name);
    return CONFIG.GARBAGE_NAMES.some(g => n === g || n.startsWith(g + ' ') || n.startsWith(g + ':'));
  },
};

// ==========================================
// ЧТЕНИЕ ФАЙЛА
// ==========================================
const Reader = {
  read(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const wb = XLSX.read(e.target.result, { type: 'array', cellStyles: true });
          const sheet = wb.Sheets[wb.SheetNames[0]];
          const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });
          resolve({ raw, sheetName: wb.SheetNames[0] });
        } catch (err) { 
          reject(err); 
        }
      };
      reader.onerror = () => reject(new Error('Ошибка чтения файла'));
      reader.readAsArrayBuffer(file);
    });
  },
};

// ==========================================
// ОЧИСТКА
// ==========================================
const Cleaner = {
  clean(raw) {
    const removed = []; 
    const rows = [];
    
    for (let i = 0; i < raw.length; i++) {
      const r = raw[i] || [];
      const nameRaw = r[0];
      const name = nameRaw == null ? '' : String(nameRaw).trim();
      
      if (!name) { 
        removed.push({ idx: i + 1, name: '(пусто)', reason: 'пустая строка' }); 
        continue; 
      }
      
      const normName = Utils.normalize(name);
      const isControl = ['итого', 'мода', 'всего'].includes(normName);
      
      if (Utils.isGarbageName(name) && !isControl) {
        removed.push({ idx: i + 1, name, reason: 'служебная строка' }); 
        continue;
      }

      let qty = null, sum = null;
      const nums = [];
      
      // Ищем числа в строке: предпоследнее считаем кол-вом, последнее - суммой
      for (let c = 1; c < r.length; c++) {
        const v = Utils.toNum(r[c]);
        if (v !== null) nums.push({ col: c, val: v });
      }
      
      if (nums.length >= 2) { 
        qty = nums[nums.length - 2].val; 
        sum = nums[nums.length - 1].val; 
      } else if (nums.length === 1) { 
        sum = nums[0].val; 
      }

      // Если нет ни суммы, ни кол-ва — это мусор
      if (sum === null && qty === null) {
        removed.push({ idx: i + 1, name, reason: 'нет суммы и кол-ва' }); 
        continue;
      }

      rows.push({ 
        id: 'row_' + i, 
        origIdx: i + 1, 
        name, 
        qty, 
        sum, 
        level: null 
      });
    }
    return { rows, removed };
  },
};

// ==========================================
// АВТОУГАДЫВАНИЕ УРОВНЕЙ
// ==========================================
const Guesser = {
  guess(rows) {
    for (const row of rows) {
      const n = Utils.normalize(row.name);
      
      if (['итого', 'мода', 'всего'].includes(n)) { 
        row.level = 0; 
        continue; 
      }
      
      // Если есть кол-во и сумма > 0, это лист (товар)
      if (row.qty !== null && row.sum !== null && row.qty > 0) { 
        row.level = 3; 
      } else { 
        row.level = null; // Папка — разметить вручную
      }
    }
    return rows;
  },
};

// ==========================================
// ПРОВЕРКИ (ВАЛИДАЦИЯ)
// ==========================================
const Checks = {
  all(rows) {
    const errors = []; 
    const warnings = []; 
    const infos = [];
    
    this.structure(rows, errors, warnings, infos);
    this.typos(rows, errors, warnings, infos);
    this.logic(rows, errors, warnings, infos);
    
    return { errors, warnings, infos };
  },

  structure(rows, errors, warnings, infos) {
    const marked = rows.filter(r => r.level !== null);
    
    // 1. Первый уровень должен быть 1 или 0
    if (marked.length > 0 && marked[0].level !== 0 && marked[0].level !== 1) {
      errors.push({ 
        row: marked[0].origIdx, 
        msg: `Строка ${marked[0].origIdx}: уровень ${marked[0].level}, ожидался 1 или 0` 
      });
    }

    // 2. Пропуск уровней
    let prev = null;
    for (const r of marked) {
      if (r.level === 0) continue;
      if (prev && prev.level !== 0 && r.level > prev.level + 1) {
        errors.push({ 
          row: r.origIdx, 
          msg: `Строка ${r.origIdx}: уровень ${r.level}, предыдущий ${prev.level} — пропуск уровня` 
        });
      }
      prev = r;
    }

    // 3. Проверка сумм детей
    const tree = this.buildTree(rows);
    this.checkSums(tree, errors);

    // 4. Сверка с ИТОГО
    const control = rows.find(r => r.level === 0);
    const roots = rows.filter(r => r.level === 1);
    if (control && roots.length) {
      const sumRoots = roots.reduce((s, r) => s + (r.sum || 0), 0);
      const diff = Math.abs(sumRoots - (control.sum || 0));
      if (diff > CONFIG.SUM_TOLERANCE) {
        errors.push({ 
          row: control.origIdx, 
          msg: `ИТОГО ${control.sum}, а сумма корней ${sumRoots} (расхождение ${Math.round(diff)} ₽)` 
        });
      }
    }
    
    if (!control) {
      warnings.push({ row: null, msg: `Нет строки уровня 0 (ИТОГО/Мода) — сверка сумм недоступна` });
    }

    // 5. Дубли
    const pathMap = new Map();
    for (const r of rows) {
      if (r.level === null || r.level === 0) continue;
      const pathKey = this.getPath(rows, r).join(' > ');
      if (pathMap.has(pathKey)) {
        errors.push({ 
          row: r.origIdx, 
          msg: `Строка ${r.origIdx}: «${r.name}» дубль (уже есть в строке ${pathMap.get(pathKey)})` 
        });
      } else { 
        pathMap.set(pathKey, r.origIdx); 
      }
    }

    // Одиночные проверки
    for (const r of rows) {
      if (r.level === 3 && (r.sum === null || r.sum === 0)) {
        warnings.push({ row: r.origIdx, msg: `Строка ${r.origIdx}: «${r.name}» — лист, но сумма 0` });
      }
      if (r.level !== null && r.level < 3 && r.qty !== null && r.qty > 0) {
        warnings.push({ row: r.origIdx, msg: `Строка ${r.origIdx}: «${r.name}» — папка, но есть кол-во ${r.qty}` });
      }
      if (r.sum !== null && r.sum < 0) {
        warnings.push({ row: r.origIdx, msg: `Строка ${r.origIdx}: «${r.name}» — отрицательная сумма` });
      }
    }
  },

  typos(rows, errors, warnings, infos) {
    const groups = new Map();
    for (const r of rows) {
      if (r.level === null || r.level === 0) continue;
      const key = this.getPath(rows, r).slice(0, -1).join(' > ') + '||' + r.level;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    }
    
    for (const [key, group] of groups) {
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const a = group[i], b = group[j];
          const na = Utils.normalize(a.name), nb = Utils.normalize(b.name);
          if (na === nb) continue;
          
          const dist = Utils.levenshtein(na, nb);
          const threshold = Math.min(na.length, nb.length) < 5 ? CONFIG.LEVENSHTEIN_SHORT : CONFIG.LEVENSHTEIN_LONG;
          
          if (dist <= threshold) {
            warnings.push({ 
              row: b.origIdx, 
              msg: `Строка ${b.origIdx}: «${b.name}» похоже на «${a.name}» (опечатка?)` 
            });
          }
        }
      }
    }
    
    for (const r of rows) {
      if (Utils.hasTrailingSpace(r.name)) {
        warnings.push({ row: r.origIdx, msg: `Строка ${r.origIdx}: «${r.name}» — пробел в начале/конце` });
      }
      if (Utils.hasDoubleSpace(r.name)) {
        warnings.push({ row: r.origIdx, msg: `Строка ${r.origIdx}: «${r.name}» — двойной пробел` });
      }
      if (Utils.hasInvisible(r.name)) {
        warnings.push({ row: r.origIdx, msg: `Строка ${r.origIdx}: «${r.name}» — невидимый символ` });
      }
      if (Utils.hasLatin(r.name) && Utils.hasCyrillic(r.name)) {
        warnings.push({ row: r.origIdx, msg: `Строка ${r.origIdx}: «${r.name}» — латинские буквы в русском` });
      }
    }
  },

  logic(rows, errors, warnings, infos) {
    const sums = rows.filter(r => r.sum !== null && r.sum > 0).map(r => r.sum);
    const med = Utils.median(sums);
    if (med > 0) {
      for (const r of rows) {
        if (r.sum !== null && r.sum > med * CONFIG.BIG_SUM_MULTIPLIER) {
          infos.push({ 
            row: r.origIdx, 
            msg: `Строка ${r.origIdx}: «${r.name}» — сумма ${r.sum} в ${Math.round(r.sum / med)}× больше медианы` 
          });
        }
      }
    }
  },

  // --- Вспомогательные методы ---
  buildTree(rows) {
    const roots = []; 
    const stack = [];
    for (const r of rows) {
      if (r.level === null || r.level === 0) continue;
      while (stack.length && stack[stack.length - 1].level >= r.level) stack.pop();
      const node = { ...r, children: [] };
      if (stack.length) stack[stack.length - 1].children.push(node); 
      else roots.push(node);
      stack.push(node);
    }
    return roots;
  },

  checkSums(nodes, errors) {
    for (const n of nodes) {
      if (n.children.length > 0) {
        this.checkSums(n.children, errors);
        const sumChildren = n.children.reduce((s, c) => s + (c.sum || 0), 0);
        const diff = Math.abs(sumChildren - (n.sum || 0));
        
        if (diff > CONFIG.SUM_TOLERANCE) {
          errors.push({ 
            row: n.origIdx, 
            msg: `«${n.name}»: сумма ${n.sum}, а сумма детей ${sumChildren} (расхождение ${Math.round(diff)} ₽)` 
          });
        }
      }
    }
  },

  getPath(rows, target) {
    const path = [target.name];
    let currentLevel = target.level;
    const targetIdx = rows.indexOf(target);
    
    for (let i = targetIdx - 1; i >= 0; i--) {
      const r = rows[i];
      if (r.level !== null && r.level < currentLevel) { 
        path.unshift(r.name); 
        currentLevel = r.level; 
        if (currentLevel === 1) break; 
      }
    }
    return path;
  }
};

// ==========================================
// UI ИНТЕРФЕЙС
// ==========================================
const App = {
  state: { rows: [], removed: [], filename: '' },
  
  init() {
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    
    dropZone.onclick = () => fileInput.click();
    fileInput.onchange = (e) => this.handleFile(e.target.files[0]);
    
    document.getElementById('btn-new').onclick = () => {
      this.state = { rows: [], removed: [], filename: '' };
      document.getElementById('screen-work').hidden = true;
      document.getElementById('screen-upload').hidden = false;
      document.querySelector('.upload-title').textContent = 'Нажми, чтобы выбрать файл';
      fileInput.value = '';
    };
    
    document.getElementById('btn-check').onclick = () => this.check();
    document.getElementById('btn-export').onclick = () => this.export();
  },

  async handleFile(file) {
    if (!file) return;
    
    document.querySelector('.upload-title').textContent = 'Чтение файла...';
    try {
      const { raw } = await Reader.read(file);
      const { rows, removed } = Cleaner.clean(raw);
      
      this.state.rows = Guesser.guess(rows);
      this.state.removed = removed;
      this.state.filename = file.name;
      
      document.getElementById('screen-upload').hidden = true;
      document.getElementById('screen-work').hidden = false;
      document.getElementById('file-name').textContent = file.name;
      document.getElementById('file-meta').textContent = `Строк: ${rows.length} · Удалено мусора: ${removed.length}`;
      
      this.renderTable();
      this.check();
      
      if (removed.length > 0) this.showRemoved();
    } catch (err) {
      alert('Ошибка: ' + err.message);
      document.querySelector('.upload-title').textContent = 'Нажми, чтобы выбрать файл';
    }
  },

  renderTable() {
    const tbody = document.getElementById('table-body');
    tbody.innerHTML = this.state.rows.map((r, i) => {
      const isUnset = r.level === null;
      const levelOpts = [0, 1, 2, 3, 4].map(l => 
        `<option value="${l}" ${r.level === l ? 'selected' : ''}>${l === 0 ? 'ИТОГ' : l}</option>`
      ).join('');
      
      return `
        <tr data-idx="${i}" id="row-${r.origIdx}">
          <td class="td-num">${r.origIdx}</td>
          <td>
            <select class="level-select ${isUnset ? 'unset' : (r.level === 0 ? 'l0' : '')}" onchange="App.updateLevel(${i}, this.value)">
              <option value="" disabled ${isUnset ? 'selected' : ''}>—</option>
              ${levelOpts}
            </select>
          </td>
          <td class="td-name">
            <input class="name-input" value="${r.name.replace(/"/g, '&quot;')}" onchange="App.updateName(${i}, this.value)">
          </td>
          <td>
            <input type="number" class="qty-input" value="${r.qty ?? ''}" onchange="App.updateQty(${i}, this.value)">
          </td>
          <td>
            <input type="number" class="sum-input" value="${r.sum ?? ''}" onchange="App.updateSum(${i}, this.value)">
          </td>
          <td>
            <button class="btn-mini" onclick="App.deleteRow(${i})" title="Удалить">🗑</button>
          </td>
        </tr>
      `;
    }).join('');
  },

  updateLevel(i, val) {
    this.state.rows[i].level = val === '' ? null : parseInt(val);
    this.renderTable(); 
    this.check();
  },
  updateName(i, val) { 
    this.state.rows[i].name = val.trim(); 
    this.check(); 
  },
  updateQty(i, val) { 
    this.state.rows[i].qty = val === '' ? null : parseFloat(val); 
    this.check(); 
  },
  updateSum(i, val) { 
    this.state.rows[i].sum = val === '' ? null : parseFloat(val); 
    this.check(); 
  },
  deleteRow(i) {
    if (confirm('Удалить эту строку?')) {
      this.state.rows.splice(i, 1);
      this.renderTable();
      this.check();
    }
  },

  check() {
    const { errors, warnings, infos } = Checks.all(this.state.rows);
    
    document.getElementById('stat-err').textContent = `🔴 ${errors.length}`;
    document.getElementById('stat-warn').textContent = `🟡 ${warnings.length}`;
    document.getElementById('stat-info').textContent = `🔵 ${infos.length}`;
    
    const panel = document.getElementById('issues-panel');
    panel.innerHTML = [
      ...errors.map(e => `<div class="issue error" onclick="App.scrollToRow(${e.row})"><span class="issue-icon">🔴</span><span class="issue-text">${e.msg}</span></div>`),
      ...warnings.map(w => `<div class="issue warn" onclick="App.scrollToRow(${w.row})"><span class="issue-icon">🟡</span><span class="issue-text">${w.msg}</span></div>`),
      ...infos.map(i => `<div class="issue info" onclick="App.scrollToRow(${i.row})"><span class="issue-icon">🔵</span><span class="issue-text">${i.msg}</span></div>`)
    ].join('');
    
    const btnExport = document.getElementById('btn-export');
    btnExport.disabled = errors.length > 0;
    
    document.querySelectorAll('.edit-table tr').forEach(tr => tr.classList.remove('row-error', 'row-warn'));
    errors.forEach(e => { 
      const tr = document.getElementById('row-' + e.row); 
      if (tr) tr.classList.add('row-error'); 
    });
    warnings.forEach(w => { 
      const tr = document.getElementById('row-' + w.row); 
      if (tr) tr.classList.add('row-warn'); 
    });
  },

  scrollToRow(origIdx) {
    if (!origIdx) return;
    const tr = document.getElementById('row-' + origIdx);
    if (tr) tr.scrollIntoView({ behavior: 'smooth', block: 'center' });
  },

  showRemoved() {
    const root = document.getElementById('modal-root');
    const content = document.getElementById('modal-content');
    content.innerHTML = `
      <h2>Удалённые строки (${this.state.removed.length})</h2>
      <p>Эти строки не попали в таблицу, так как не содержат данных о продажах или являются служебными.</p>
      <ul style="max-height: 40vh; overflow-y: auto; padding-left: 20px; margin-bottom: 20px;">
        ${this.state.removed.map(r => `<li style="margin-bottom:8px;">Стр. ${r.idx}: ${r.name} <br><small style="color:#888">${r.reason}</small></li>`).join('')}
      </ul>
      <button class="btn btn-primary" onclick="document.getElementById('modal-root').classList.remove('open')">Понятно</button>
    `;
    root.classList.add('open');
  },

  export() {
    // Формируем массив для XLSX: [уровень, имя, кол-во, сумма]
    const data = this.state.rows.map(r => [
      r.level,
      r.name,
      r.qty,
      r.sum
    ]);

    // Создаем лист и книгу
    const ws = XLSX.utils.aoa_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Очищенные данные");

    // Скачиваем файл
    XLSX.writeFile(wb, `clean_${this.state.filename.replace('.xlsx', '')}.xlsx`);
  }
};

// Запуск приложения при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
