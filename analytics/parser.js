/* ==========================================
   PARSER (упрощённый, только формат A)
   Вход: .xlsx с колонками: уровень | имя | кол-во | сумма
   Выход: { rows: [{level, name, qty, sum}], periodInfo, control }
   ========================================== */

const Parser = {
  async parse(file, storeId) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const wb = XLSX.read(e.target.result, { type: 'array' });
          const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null, raw: true });
          const parsed = this.build(rows, file.name, storeId);
          resolve(parsed);
        } catch (err) { reject(err); }
      };
      reader.onerror = () => reject(new Error('FileReader error'));
      reader.readAsArrayBuffer(file);
    });
  },

  build(rawRows, filename, storeId) {
    const period = this.parsePeriod(filename);
    const rows = [];
    let control = null;

    for (let i = 0; i < rawRows.length; i++) {
      const r = rawRows[i] || [];
      const level = r[0];
      const name = r[1] != null ? String(r[1]).trim() : '';
      const qty = this.toNum(r[2]);
      const sum = this.toNum(r[3]);

      if (level === null && !name) continue;
      if (!name) continue;

      const lvl = Number(level);

      if (lvl === 0) {
        control = { name, qty, sum };
        continue;
      }

      rows.push({ level: lvl, name, qty, sum });
    }

    // Валидация: сумма корней vs control
    const rootsSum = rows.filter(r => r.level === 1).reduce((acc, r) => acc + (r.sum || 0), 0);
    const valid = control ? Math.abs(rootsSum - (control.sum || 0)) < 1 : false;
    const errorMsg = valid || !control ? null : {
      roots: Math.round(rootsSum),
      control: Math.round(control.sum),
    };

    // Дерево для удобства
    const roots = this.buildTree(rows);

    const totalQty = rows.filter(r => r.level === 3).reduce((acc, r) => acc + (r.qty || 0), 0);
    const totalSum = control ? (control.sum || 0) : rootsSum;

    return {
      id: 'imp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      storeId,
      roots,
      periodStart: period.startISO,
      periodEnd: period.endISO,
      periodDays: period.daysInPeriod,
      daysInMonth: period.daysInMonth,
      granularity: period.granularity,
      periodLabel: period.label,
      periodKnown: period.known,
      totalSum,
      totalQty,
      avgCheck: totalQty > 0 ? totalSum / totalQty : 0,
      valid,
      errorMsg,
      filename,
      date: new Date().toISOString(),
    };
  },

  buildTree(rows) {
    const roots = [];
    const stack = [];
    for (const row of rows) {
      const node = { ...row, children: [] };
      while (stack.length && stack[stack.length - 1].level >= row.level) stack.pop();
      if (stack.length) stack[stack.length - 1].children.push(node);
      else roots.push(node);
      stack.push(node);
    }
    // Проставить path
    const walk = (nodes, parentPath) => {
      for (const n of nodes) {
        n.path = parentPath ? `${parentPath} > ${n.name}` : n.name;
        walk(n.children, n.path);
      }
    };
    walk(roots, '');
    return roots;
  },

  parsePeriod(filename) {
    const m = filename.match(/(\d{1,2})[.\-_](\d{1,2})[.\-_](\d{2,4})\s*[-–—]\s*(\d{1,2})[.\-_](\d{1,2})[.\-_](\d{2,4})/);
    if (!m) {
      return {
        startISO: null, endISO: null,
        daysInPeriod: 30, daysInMonth: 30,
        granularity: 'unknown', label: 'период не определён', known: false,
      };
    }
    const y = (s) => (s.length === 2 ? 2000 + Number(s) : Number(s));
    const start = new Date(y(m[3]), Number(m[2]) - 1, Number(m[1]));
    const end = new Date(y(m[6]), Number(m[5]) - 1, Number(m[4]));
    const days = Math.round((end - start) / 86400000) + 1;

    let granularity;
    if (days === 1) granularity = 'day';
    else if (days <= 7) granularity = 'week';
    else if (days >= 28 && days <= 31) granularity = 'month';
    else if (days > 31) granularity = 'multi_month';
    else granularity = 'unknown';

    const iso = (d) => d.toISOString().slice(0, 10);
    const label = `${m[1].padStart(2,'0')}.${m[2].padStart(2,'0')}–${m[4].padStart(2,'0')}.${m[5].padStart(2,'0')}`;

    return {
      startISO: iso(start), endISO: iso(end),
      daysInPeriod: days,
      daysInMonth: new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate(),
      granularity, label, known: true,
    };
  },

  toNum(v) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    const n = parseFloat(String(v).replace(/[\s\u00A0]/g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  },
};

window.Parser = Parser;
