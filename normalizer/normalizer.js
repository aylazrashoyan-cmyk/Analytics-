// ==========================================
// НОРМАЛИЗАТОР 1С — v7.0 (Строгая математика)
// ==========================================

const CONFIG = {
  LEVENSHTEIN_SHORT: 1, 
  LEVENSHTEIN_LONG: 2, 
  SUM_TOLERANCE: 1, 
  GARBAGE_NAMES: ['номенклатура', 'отбор', 'итого', 'продажи', 'магазин', 'склад', 'торговый зал'],
  ROOT_FOLDERS: ['одежда', 'обувь', 'аксессуары', 'распродажа', 'будут удалены'],
  SECOND_LEVEL: ['женская', 'мужская', 'детская', 'мальчики', 'девочки']
};

const Utils = {
  toNum(v) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return v;
    const cleaned = String(v).replace(/[\s\u00A0]/g, '').replace(',', '.');
    const n = parseFloat(cleaned);
    return Number.isFinite(n) ? n : null;
  },
  normalize(s) { return String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim(); },
  hasLatin(s) { return /[a-zA-Z]/.test(String(s || '')); },
  hasCyrillic(s) { return /[а-яА-ЯёЁ]/.test(String(s || '')); },
  hasInvisible(s) { return /[\u00A0\u200B\uFEFF\u2007\u202F]/.test(String(s || '')); },
  hasTrailingSpace(s) { return /^\s|\s$/.test(String(s || '')); },
  hasDoubleSpace(s) { return /\s{2,}/.test(String(s || '')); },
  
  isGarbageName(name) {
    const n = Utils.normalize(name);
    return CONFIG.GARBAGE_NAMES.some(g => n === g || n.startsWith(g + ' ') || n.startsWith(g + ':'));
  },

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
  }
};

const Reader = {
  read(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const wb = XLSX.read(e.target.result, { type: 'array', cellStyles: true });
          const sheet = wb.Sheets[wb.SheetNames[0]];
          const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });
          resolve({ raw });
        } catch (err) { reject(err); }
      };
      reader.onerror = () => reject(new Error('Ошибка чтения файла'));
      reader.readAsArrayBuffer(file);
    });
  },
};

const Cleaner = {
  clean(raw) {
    const removed = []; const rows = [];
    for (let i = 0; i < raw.length; i++) {
      const r = raw[i] || [];
      const name = r[0] == null ? '' : String(r[0]).trim();
      if (!name) continue;
      
      if (Utils.isGarbageName(name)) { 
        removed.push({ idx: i + 1, name, reason: 'служебная строка' }); 
        continue; 
      }

      let qty = null, sum = null;
      const nums = [];
      for (let c = 1; c < r.length; c++) {
        const v = Utils.toNum(r[c]);
        if (v !== null) nums.push({ col: c, val: v });
      }
      if (nums.length >= 2) { qty = nums[nums.length - 2].val; sum = nums[nums.length - 1].val; } 
      else if (nums.length === 1) { sum = nums[0].val; }

      rows.push({ id: 'row_' + i, origIdx: i + 1, name, qty, sum, level: null });
    }
    return { rows, removed };
  }
};

const Guesser = {
  guess(rows) {
    let stack = []; 

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const n = Utils.normalize(row.name);

      if (i === 0 || (i === 1 && rows[0].level === 0)) {
        if (n === 'мода' || n === 'итого' || n === 'всего') {
          row.level = 0;
          stack = [];
          continue;
        }
      }

      while (stack.length > 0) {
        const parent = stack[stack.length - 1];
        if (row.sum > parent.sum + CONFIG.SUM_TOLERANCE) {
          stack.pop(); 
        } else {
          break;
        }
      }

      const currentLevel = stack.length + 1;

      if (CONFIG.ROOT_FOLDERS.includes(n)) {
        row.level = 1;
        stack = [row];
        continue;
      }

      if (CONFIG.SECOND_LEVEL.includes(n)) {
        row.level = 2;
        stack = stack.slice(0, 1); 
        stack.push(row);
        continue;
      }

      const nextRow = rows[i + 1];
      if (nextRow && row.sum === nextRow.sum && Utils.normalize(nextRow.name) !== n) {
        row.level = currentLevel;
        stack.push(row);
        continue;
      }

      if (nextRow && Utils.normalize(nextRow.name) === n && row.sum === nextRow.sum) {
        row.level = currentLevel;
        stack.push(row);
        continue;
      }

      row.level = currentLevel;
    }

    let prevLevel = 0;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].level === 0) { prevLevel = 0; continue; }
      if (rows[i].level > prevLevel + 1) {
        rows[i].level = prevLevel + 1;
      }
      prevLevel = rows[i].level;
    }

    return rows;
  }
};

const Checks = {
  all(rows) {
    const errors = []; const warnings = []; const infos = [];
    this.structure(rows, errors, warnings, infos);
    this.typos(rows, errors, warnings, infos);
    return { errors, warnings, infos };
  },

  structure(rows, errors, warnings, infos) {
    const marked = rows.filter(r => r.level !== null);
    
    let prev = null;
    for (const r of marked) {
      if (r.level === 0) continue;
      if (prev && prev.level !== 0 && r.level > prev.level + 1) {
        errors.push({ row: r.origIdx, msg: `Строка ${r.origIdx}: уровень ${r.level}, предыдущий ${prev.level} — пропуск уровня` });
      }
      prev = r;
    }

    // СТРОГАЯ ПРОВЕРКА СУММ (возвращена в ошибки!)
    const tree = this.buildTree(rows);
    this.checkSums(tree, errors);

    const control = rows.find(r => r.level === 0);
    const roots = rows.filter(r => r.level === 1);
    if (control && roots.length) {
      const sumRoots = roots.reduce((s, r) => s + (r.sum || 0), 0);
      const diff = Math.abs(sumRoots - (control.sum || 0));
      if (diff > CONFIG.SUM_TOLERANCE) {
        errors.push({ row: control.origIdx, msg: `ИТОГО ${control.sum}, а сумма корней ${sumRoots} (расхождение ${Math.round(diff)} ₽)` });
      }
    }
    
    const pathMap = new Map();
    for (const r of rows) {
      if (r.level === null || r.level === 0) continue;
      const pathKey = this.getPath(rows, r).join(' > ');
      if (pathMap.has(pathKey)) {
        const existingRow = pathMap.get(pathKey);
        if (existingRow.sum === r.sum && existingRow.qty === r.qty) {
          errors.push({ row: r.origIdx, msg: `Строка ${r.origIdx}: «${r.name}» полный дубль (строка ${existingRow.origIdx})` });
        }
      } else {
        pathMap.set(pathKey, r);
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
          
          const textA = na.replace(/\d+/g, '').replace(/р\b|руб/g, '').trim();
          const textB = nb.replace(/\d+/g, '').replace(/р\b|руб/g, '').trim();

          if (!textA || !textB) continue;

          const dist = Utils.levenshtein(textA, textB);
          const threshold = Math.max(1, Math.floor(Math.max(textA.length, textB.length) * 0.2));
          
          if (dist > 0 && dist <= threshold) {
            warnings.push({ row: b.origIdx, msg: `Строка ${b.origIdx}: «${b.name}» похоже на «${a.name}» (опечатка?)` });
          }
        }
      }
    }
    
    for (const r of rows) {
      if (Utils.hasTrailingSpace(r.name)) warnings.push({ row: r.origIdx, msg: `Строка ${r.origIdx}: «${r.name}» — пробел в начале/конце` });
      if (Utils.hasDoubleSpace(r.name)) warnings.push({ row: r.origIdx, msg: `Строка ${r.origIdx}: «${r.name}» — двойной пробел` });
      if (Utils.hasInvisible(r.name)) warnings.push({ row: r.origIdx, msg: `Строка ${r.origIdx}: «${r.name}» — невидимый символ` });
      if (Utils.hasLatin(r.name) && Utils.hasCyrillic(r.name)) warnings.push({ row: r.origIdx, msg: `Строка ${r.origIdx}: «${r.name}» — латинские буквы в русском` });
    }
  },

  buildTree(rows) {
    const roots = []; const stack = [];
    for (const r of rows) {
      if (r.level === null || r.level === 0) continue;
      while (stack.length && stack[stack.length - 1].level >= r.level) stack.pop();
      const node = { ...r, children: [] };
      if (stack.length) stack[stack.length - 1].children.push(node); else roots.push(node);
      stack.push(node);
    }
    return roots;
  },

  checkSums(nodes, errors) {
    for (const n of nodes) {
      if (n.children.length > 0) {
        this.checkSums(n.children, errors);
        const sumChildren = n.children.reduce((s, c) => s + (c.sum || 0), 0);
        
        // Игнорируем дубли папок (со словом "до")
        const isDummyFolder = /\(до|\( до|до \d/.test(n.name);

        if (Math.abs(sumChildren - (n.sum || 0)) > CONFIG.SUM_TOLERANCE && !isDummyFolder) {
           errors.push({ row: n.origIdx, msg: `«${n.name}»: сумма ${n.sum}, а сумма детей ${sumChildren}` });
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
    } catch (err) { alert('Ошибка: ' + err.message); }
  },
  renderTable() {
    const tbody = document.getElementById('table-body');
    tbody.innerHTML = this.state.rows.map((r, i) => {
      const isUnset = r.level === null;
      const levelOpts = [0, 1, 2, 3, 4, 5].map(l => `<option value="${l}" ${r.level === l ? 'selected' : ''}>${l === 0 ? 'ИТОГ' : l}</option>`).join('');
      return `<tr data-idx="${i}" id="row-${r.origIdx}">
          <td class="td-num">${r.origIdx}</td>
          <td><select class="level-select ${isUnset ? 'unset' : (r.level === 0 ? 'l0' : '')}" onchange="App.updateLevel(${i}, this.value)"><option value="" disabled ${isUnset ? 'selected' : ''}>—</option>${levelOpts}</select></td>
          <td class="td-name"><input class="name-input" value="${r.name.replace(/"/g, '&quot;')}" onchange="App.updateName(${i}, this.value)"></td>
          <td><input type="number" class="qty-input" value="${r.qty ?? ''}" onchange="App.updateQty(${i}, this.value)"></td>
          <td><input type="number" class="sum-input" value="${r.sum ?? ''}" onchange="App.updateSum(${i}, this.value)"></td>
          <td><button class="btn-mini" onclick="App.deleteRow(${i})">🗑</button></td>
        </tr>`;
    }).join('');
  },
  updateLevel(i, val) { this.state.rows[i].level = val === '' ? null : parseInt(val); this.renderTable(); this.check(); },
  updateName(i, val) { this.state.rows[i].name = val.trim(); this.check(); },
  updateQty(i, val) { this.state.rows[i].qty = val === '' ? null : parseFloat(val); this.check(); },
  updateSum(i, val) { this.state.rows[i].sum = val === '' ? null : parseFloat(val); this.check(); },
  deleteRow(i) { if (confirm('Удалить эту строку?')) { this.state.rows.splice(i, 1); this.renderTable(); this.check(); } },
  
  check() {
    const { errors, warnings, infos } = Checks.all(this.state.rows);
    
    document.getElementById('stat-err').textContent = `🔴 ${errors.length}`;
    document.getElementById('stat-warn').textContent = `🟡 ${warnings.length}`;
    document.getElementById('stat-info').textContent = `🔵 ${infos.length}`;
    
    const panel = document.getElementById('issues-panel');
    panel.innerHTML = [
      ...errors.map(e => `<div class="issue error" onclick="App.scrollToRow(${e.row})"><span class="issue-icon">🔴</span><span class="issue-text"><b>Ошибка:</b> ${e.msg}</span></div>`),
      ...warnings.map(w => `<div class="issue warn" onclick="App.scrollToRow(${w.row})"><span class="issue-icon">🟡</span><span class="issue-text">${w.msg}</span></div>`),
      ...infos.map(i => `<div class="issue info" onclick="App.scrollToRow(${i.row})"><span class="issue-icon">🔵</span><span class="issue-text">${i.msg}</span></div>`)
    ].join('');
    
    // Кнопка Скачать блокируется, если есть ЛЮБЫЕ красные ошибки (математика не бьется)
    document.getElementById('btn-export').disabled = errors.length > 0;
    
    document.querySelectorAll('.edit-table tr').forEach(tr => tr.classList.remove('row-error', 'row-warn'));
    errors.forEach(e => { const tr = document.getElementById('row-' + e.row); if (tr) tr.classList.add('row-error'); });
    warnings.forEach(w => { const tr = document.getElementById('row-' + w.row); if (tr) tr.classList.add('row-warn'); });
  },
  
  scrollToRow(origIdx) { if (!origIdx) return; const tr = document.getElementById('row-' + origIdx); if (tr) tr.scrollIntoView({ behavior: 'smooth', block: 'center' }); },
  
  showRemoved() {
    document.getElementById('modal-content').innerHTML = `
      <h2>Удалённые строки (${this.state.removed.length})</h2>
      <p>Эти строки не попали в таблицу, так как являются мусором или служебными заголовками 1С.</p>
      <ul style="max-height: 40vh; overflow-y: auto; padding-left: 20px; margin-bottom: 20px;">
        ${this.state.removed.map(r => `<li>Стр. ${r.idx}: ${r.name} <br><small>${r.reason}</small></li>`).join('')}
      </ul>
      <button class="btn btn-primary" onclick="document.getElementById('modal-root').classList.remove('open')">Понятно</button>
    `;
    document.getElementById('modal-root').classList.add('open');
  },
  
  export() {
    const data = this.state.rows.map(r => [r.level, r.name, r.qty, r.sum]);
    const ws = XLSX.utils.aoa_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Очищенные данные");
    XLSX.writeFile(wb, `clean_${this.state.filename.replace('.xlsx', '')}.xlsx`);
  }
};

document.addEventListener('DOMContentLoaded', () => { App.init(); });
