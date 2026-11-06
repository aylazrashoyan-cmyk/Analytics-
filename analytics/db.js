/* ==========================================
   DB v2
   Все данные шифруются через dataKey (AES-GCM).
   В IndexedDB хранится только шифротекст.
   Схема: stores, rows, rails, segments, tiers, shelves, imports, plans
   ========================================== */

const DB = {
  dataKey: null,
  data: null,
  dbName: 'af_data',
  storeName: 'encrypted',

  async init(dataKey) {
    this.dataKey = dataKey;
    const enc = await this._loadEncrypted();
    if (enc) {
      try {
        const json = await Crypto.decrypt(dataKey, enc.iv, enc.ct);
        this.data = JSON.parse(json);
        this._migrate();
      } catch (err) {
        console.error('Decrypt failed', err);
        this.data = this._empty();
      }
    } else {
      this.data = this._empty();
    }
  },

  _empty() {
    return {
      version: 2,
      stores: [],
      currentStoreId: null,
      rows: [],
      rails: [],
      segments: [],
      tiers: [],
      shelves: [],
      shelfSegments: [],
      imports: [],
      plans: {},
      minEfficiency: 15000,
      checklist: { plan: false, import: false, top5: false },
      schemaVersion: 2,
    };
  },

  _migrate() {
    // v1 → v2 миграция: если есть старое поле imports с деревом — оставляем, но структуру stores создаём
    if (!this.data.stores) this.data.stores = [];
    if (this.data.currentStoreId === undefined) this.data.currentStoreId = null;
    if (!this.data.rows) this.data.rows = [];
    if (!this.data.rails) this.data.rails = [];
    if (!this.data.segments) this.data.segments = [];
    if (!this.data.tiers) this.data.tiers = [];
    if (!this.data.shelves) this.data.shelves = [];
    if (!this.data.shelfSegments) this.data.shelfSegments = [];
    if (!this.data.plans) this.data.plans = {};
    if (this.data.minEfficiency === undefined) this.data.minEfficiency = 15000;
    if (!this.data.checklist) this.data.checklist = { plan: false, import: false, top5: false };
    this.data.schemaVersion = 2;
  },

  async _openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, 1);
      req.onupgradeneeded = (e) => {
        if (!e.target.result.objectStoreNames.contains(this.storeName)) {
          e.target.result.createObjectStore(this.storeName);
        }
      };
      req.onsuccess = () => resolve(e => e);
      req.onerror = () => reject(req.error);
    }).then((e) => {
      // Полифилл: возвращаем сам IDBDatabase
      return new Promise((resolve) => {
        const req = indexedDB.open(this.dbName, 1);
        req.onsuccess = (ev) => resolve(ev.target.result);
      });
    });
  },

  async _loadEncrypted() {
    return new Promise((resolve) => {
      const req = indexedDB.open(this.dbName, 1);
      req.onupgradeneeded = (e) => {
        if (!e.target.result.objectStoreNames.contains(this.storeName)) {
          e.target.result.createObjectStore(this.storeName);
        }
      };
      req.onsuccess = (e) => {
        const tx = e.target.result.transaction(this.storeName, 'readonly');
        const getReq = tx.objectStore(this.storeName).get('data');
        getReq.onsuccess = () => resolve(getReq.result || null);
        getReq.onerror = () => resolve(null);
      };
      req.onerror = () => resolve(null);
    });
  },

  async save() {
    if (!this.dataKey) throw new Error('DB not initialized');
    const json = JSON.stringify(this.data);
    const enc = await Crypto.encrypt(this.dataKey, json);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, 1);
      req.onupgradeneeded = (e) => {
        if (!e.target.result.objectStoreNames.contains(this.storeName)) {
          e.target.result.createObjectStore(this.storeName);
        }
      };
      req.onsuccess = (e) => {
        const tx = e.target.result.transaction(this.storeName, 'readwrite');
        tx.objectStore(this.storeName).put(enc, 'data');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
  },

  // ---------- STORES ----------
  getStores() {
    return this.data.stores;
  },

  getCurrentStore() {
    return this.data.stores.find(s => s.id === this.data.currentStoreId) || null;
  },

  async addStore(name) {
    const id = 's_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    const store = { id, name: name.trim(), createdAt: new Date().toISOString() };
    this.data.stores.push(store);
    if (!this.data.currentStoreId) this.data.currentStoreId = id;
    await this.save();
    return store;
  },

  async setCurrentStore(id) {
    this.data.currentStoreId = id;
    await this.save();
  },

  async deleteStore(id) {
    this.data.stores = this.data.stores.filter(s => s.id !== id);
    // Удаляем всё, что связано с магазином
    this.data.rows = this.data.rows.filter(r => r.storeId !== id);
    this.data.rails = this.data.rails.filter(r => r.storeId !== id);
    this.data.segments = this.data.segments.filter(s => s.storeId !== id);
    this.data.tiers = this.data.tiers.filter(t => t.storeId !== id);
    this.data.shelves = this.data.shelves.filter(s => s.storeId !== id);
    this.data.shelfSegments = this.data.shelfSegments.filter(s => s.storeId !== id);
    this.data.imports = this.data.imports.filter(i => i.storeId !== id);
    delete this.data.plans[id];
    if (this.data.currentStoreId === id) {
      this.data.currentStoreId = this.data.stores[0]?.id || null;
    }
    await this.save();
  },

  // ---------- IMPORTS ----------
  getImports(storeId) {
    return this.data.imports
      .filter(i => i.storeId === storeId)
      .sort((a, b) => (b.periodStart || b.date).localeCompare(a.periodStart || a.date));
  },

  getCurrentImport(storeId) {
    const imports = this.getImports(storeId);
    if (!imports.length) return null;
    const rank = { month: 4, week: 3, day: 2, multi_month: 1, unknown: 0 };
    const sorted = [...imports];
    const samePeriod = sorted.filter(i =>
      i.periodStart && sorted[0].periodStart &&
      i.periodStart.slice(0, 7) === sorted[0].periodStart.slice(0, 7)
    );
    return (samePeriod.length ? samePeriod : sorted)
      .sort((a, b) => (rank[b.granularity] || 0) - (rank[a.granularity] || 0))[0];
  },

  async addImport(imp) {
    this.data.imports.unshift(imp);
    // Ограничение: 12 на магазин
    const storeImports = this.data.imports.filter(i => i.storeId === imp.storeId);
    if (storeImports.length > 12) {
      const toRemove = storeImports.slice(12).map(i => i.id);
      this.data.imports = this.data.imports.filter(i => !toRemove.includes(i.id));
    }
    await this.save();
  },

  async clearImports(storeId) {
    this.data.imports = this.data.imports.filter(i => i.storeId !== storeId);
    await this.save();
  },

  // ---------- ROWS ----------
  getRows(storeId) {
    return this.data.rows.filter(r => r.storeId === storeId);
  },

  async addRow(row) {
    this.data.rows.push(row);
    await this.save();
    return row;
  },

  async updateRow(id, patch) {
    const row = this.data.rows.find(r => r.id === id);
    if (!row) return null;
    Object.assign(row, patch);
    await this.save();
    return row;
  },

  async deleteRow(id) {
    // Удаляем рейлы ряда и их сегменты
    const rails = this.data.rails.filter(r => r.rowId === id);
    const railIds = rails.map(r => r.id);
    this.data.segments = this.data.segments.filter(s => !railIds.includes(s.railId));
    this.data.tiers = this.data.tiers.filter(t => !railIds.includes(t.railId));
    const tiers = this.data.tiers;
    const tierIds = tiers.map(t => t.id);
    this.data.shelves = this.data.shelves.filter(s => !tierIds.includes(s.tierId));
    this.data.rails = this.data.rails.filter(r => r.rowId !== id);
    this.data.rows = this.data.rows.filter(r => r.id !== id);
    await this.save();
  },

  // ---------- RAILS ----------
  getRails(storeId, rowId) {
    return this.data.rails.filter(r => r.storeId === storeId && (!rowId || r.rowId === rowId));
  },

  async addRail(rail) {
    this.data.rails.push(rail);
    await this.save();
    return rail;
  },

  async updateRail(id, patch) {
    const rail = this.data.rails.find(r => r.id === id);
    if (!rail) return null;
    Object.assign(rail, patch);
    await this.save();
    return rail;
  },

  async deleteRail(id) {
    this.data.segments = this.data.segments.filter(s => s.railId !== id);
    this.data.tiers = this.data.tiers.filter(t => t.railId !== id);
    const tierIds = this.data.tiers.map(t => t.id);
    this.data.shelves = this.data.shelves.filter(s => !tierIds.includes(s.tierId));
    this.data.rails = this.data.rails.filter(r => r.id !== id);
    await this.save();
  },

  // ---------- SEGMENTS ----------
  getSegments(storeId, railId) {
    return this.data.segments.filter(s => s.storeId === storeId && (!railId || s.railId === railId));
  },

  async addSegment(segment) {
    this.data.segments.push(segment);
    await this.save();
    return segment;
  },

  async updateSegment(id, patch) {
    const seg = this.data.segments.find(s => s.id === id);
    if (!seg) return null;
    Object.assign(seg, patch);
    await this.save();
    return seg;
  },

  async deleteSegment(id) {
    this.data.segments = this.data.segments.filter(s => s.id !== id);
    await this.save();
  },

  // ---------- TIERS ----------
  getTiers(storeId, railId) {
    return this.data.tiers.filter(t => t.storeId === storeId && (!railId || t.railId === railId));
  },

  async addTier(tier) {
    this.data.tiers.push(tier);
    await this.save();
    return tier;
  },

  async updateTier(id, patch) {
    const t = this.data.tiers.find(t => t.id === id);
    if (!t) return null;
    Object.assign(t, patch);
    await this.save();
    return t;
  },

  async deleteTier(id) {
    this.data.shelves = this.data.shelves.filter(s => s.tierId !== id);
    const shelfIds = this.data.shelves.filter(s => s.tierId === id).map(s => s.id);
    this.data.shelfSegments = this.data.shelfSegments.filter(s => !shelfIds.includes(s.shelfId));
    this.data.tiers = this.data.tiers.filter(t => t.id !== id);
    await this.save();
  },

  // ---------- SHELVES ----------
  getShelves(storeId, tierId) {
    return this.data.shelves.filter(s => s.storeId === storeId && (!tierId || s.tierId === tierId));
  },

  async addShelf(shelf) {
    this.data.shelves.push(shelf);
    await this.save();
    return shelf;
  },

  async updateShelf(id, patch) {
    const s = this.data.shelves.find(s => s.id === id);
    if (!s) return null;
    Object.assign(s, patch);
    await this.save();
    return s;
  },

  async deleteShelf(id) {
    this.data.shelfSegments = this.data.shelfSegments.filter(s => s.shelfId !== id);
    this.data.shelves = this.data.shelves.filter(s => s.id !== id);
    await this.save();
  },

  // ---------- SHELF SEGMENTS ----------
  getShelfSegments(storeId, shelfId) {
    return this.data.shelfSegments.filter(s => s.storeId === storeId && (!shelfId || s.shelfId === shelfId));
  },

  async addShelfSegment(seg) {
    this.data.shelfSegments.push(seg);
    await this.save();
    return seg;
  },

  async deleteShelfSegment(id) {
    this.data.shelfSegments = this.data.shelfSegments.filter(s => s.id !== id);
    await this.save();
  },

  // ---------- PLANS ----------
  getPlan(storeId, month) {
    return this.data.plans[storeId]?.[month] || 0;
  },

  async setPlan(storeId, month, amount) {
    if (!this.data.plans[storeId]) this.data.plans[storeId] = {};
    this.data.plans[storeId][month] = amount;
    await this.save();
  },

  // ---------- FULL CLEAR ----------
  async clearAll() {
    this.data = this._empty();
    await this.save();
  },
};

window.DB = DB;
