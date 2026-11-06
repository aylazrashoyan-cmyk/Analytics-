/* ==========================================
   AUTH GATE
   Монтируется первым. Пока PIN не введён —
   DB не инициализируется, данные не читаются.
   ========================================== */

const AUTH_STORE = 'af_auth'; // { salt, verifier } в plain IndexedDB

const AuthDB = {
  async getMeta() {
    return new Promise((resolve) => {
      const req = indexedDB.open('af_meta', 1);
      req.onupgradeneeded = (e) => {
        if (!e.target.result.objectStoreNames.contains('meta')) {
          e.target.result.createObjectStore('meta');
        }
      };
      req.onsuccess = (e) => {
        const tx = e.target.result.transaction('meta', 'readonly');
        const getReq = tx.objectStore('meta').get('auth');
        getReq.onsuccess = () => resolve(getReq.result || null);
        getReq.onerror = () => resolve(null);
      };
      req.onerror = () => resolve(null);
    });
  },

  async setMeta(data) {
    return new Promise((resolve) => {
      const req = indexedDB.open('af_meta', 1);
      req.onupgradeneeded = (e) => {
        if (!e.target.result.objectStoreNames.contains('meta')) {
          e.target.result.createObjectStore('meta');
        }
      };
      req.onsuccess = (e) => {
        const tx = e.target.result.transaction('meta', 'readwrite');
        tx.objectStore('meta').put(data, 'auth');
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      };
      req.onerror = () => resolve();
    });
  },

  async clearMeta() {
    return new Promise((resolve) => {
      const req = indexedDB.open('af_meta', 1);
      req.onsuccess = (e) => {
        const tx = e.target.result.transaction('meta', 'readwrite');
        tx.objectStore('meta').delete('auth');
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      };
      req.onerror = () => resolve();
    });
  },
};

const Auth = {
  mode: null,       // 'setup' | 'unlock'
  pin: '',
  dataKey: null,    // устанавливается после успеха
  onSuccess: null,

  async init(onSuccess) {
    this.onSuccess = onSuccess;
    const meta = await AuthDB.getMeta();

    if (!meta) {
      this.mode = 'setup';
      this.renderSetup();
    } else {
      this.mode = 'unlock';
      this.renderUnlock(meta);
    }
  },

  // ---------- SETUP ----------
  renderSetup() {
    const gate = document.getElementById('auth-gate');
    gate.innerHTML = `
      <div class="auth-title">Придумай PIN</div>
      <div class="auth-subtitle">
        4 цифры. Запомни его — восстановить нельзя. Если забудешь — данные будут потеряны.
      </div>
      <div class="auth-dots" id="auth-dots">
        ${[0,1,2,3].map(() => `<div class="auth-dot"></div>`).join('')}
      </div>
      <div class="auth-keypad" id="auth-keypad"></div>
      <div class="auth-error" id="auth-error"></div>
      <div class="auth-warning">
        ⚠ Нет восстановления. Нет сброса. Только ты и PIN.
      </div>
    `;
    this.renderKeypad();
  },

  // ---------- UNLOCK ----------
  renderUnlock(meta) {
    const gate = document.getElementById('auth-gate');
    gate.innerHTML = `
      <div class="auth-title">Введи PIN</div>
      <div class="auth-subtitle">4 цифры для доступа</div>
      <div class="auth-dots" id="auth-dots">
        ${[0,1,2,3].map(() => `<div class="auth-dot"></div>`).join('')}
      </div>
      <div class="auth-keypad" id="auth-keypad"></div>
      <div class="auth-error" id="auth-error"></div>
    `;
    this.renderKeypad();
    this.meta = meta;
  },

  // ---------- KEYPAD ----------
  renderKeypad() {
    const keypad = document.getElementById('auth-keypad');
    const keys = [
      '1','2','3',
      '4','5','6',
      '7','8','9',
      '', '0', 'del'
    ];
    keypad.innerHTML = keys.map(k => {
      if (k === '') return `<button class="auth-key empty"></button>`;
      if (k === 'del') return `<button class="auth-key del" data-key="del">⌫</button>`;
      return `<button class="auth-key" data-key="${k}">${k}</button>`;
    }).join('');

    keypad.querySelectorAll('.auth-key[data-key]').forEach(btn => {
      btn.addEventListener('click', () => this.onKey(btn.dataset.key));
    });
  },

  onKey(k) {
    // Проверка lockout
    Crypto.getRateLimit().then(st => {
      if (st.lockedUntil > Date.now()) {
        const sec = Math.ceil((st.lockedUntil - Date.now()) / 1000);
        this.showError(`Слишком много попыток. Подожди ${sec} сек.`);
        return;
      }
      if (k === 'del') {
        this.pin = this.pin.slice(0, -1);
        this.updateDots();
        return;
      }
      if (!/^\d$/.test(k)) return;
      if (this.pin.length >= 4) return;
      this.pin += k;
      this.updateDots();
      if (this.pin.length === 4) {
        setTimeout(() => this.submit(), 100);
      }
    });
  },

  updateDots(error = false) {
    const dots = document.querySelectorAll('#auth-dots .auth-dot');
    dots.forEach((d, i) => {
      d.classList.toggle('filled', i < this.pin.length);
      d.classList.toggle('error', error);
    });
  },

  showError(msg) {
    const el = document.getElementById('auth-error');
    if (el) el.textContent = msg;
  },

  shake() {
    this.updateDots(true);
    const dots = document.getElementById('auth-dots');
    if (dots) {
      dots.style.animation = 'shake 0.3s';
      setTimeout(() => { dots.style.animation = ''; }, 300);
    }
  },

  async submit() {
    if (this.mode === 'setup') return this.submitSetup();
    if (this.mode === 'unlock') return this.submitUnlock();
  },

  async submitSetup() {
    const pin = this.pin;
    if (pin.length !== 4) return;
    this.showError('');
    try {
      const { salt, verifier, dataKey } = await Crypto.createPin(pin);
      await AuthDB.setMeta({ salt, verifier });
      await Crypto.resetAttempts();
      this.dataKey = dataKey;
      this.unlock();
    } catch (err) {
      console.error(err);
      this.showError('Ошибка создания PIN');
      this.pin = '';
      this.updateDots();
    }
  },

  async submitUnlock() {
    const pin = this.pin;
    if (pin.length !== 4) return;
    this.showError('');
    try {
      const { ok, dataKey } = await Crypto.verifyPin(pin, this.meta.salt, this.meta.verifier);
      if (!ok) {
        const st = await Crypto.recordFailedAttempt();
        this.pin = '';
        this.updateDots();
        this.shake();
        const sec = Math.ceil((st.lockedUntil - Date.now()) / 1000);
        if (st.lockedUntil > Date.now()) {
          this.showError(`Неверный PIN. Блокировка ${sec} сек.`);
        } else {
          this.showError('Неверный PIN');
        }
        return;
      }
      await Crypto.resetAttempts();
      this.dataKey = dataKey;
      this.unlock();
    } catch (err) {
      console.error(err);
      this.showError('Ошибка проверки');
      this.pin = '';
      this.updateDots();
    }
  },

  unlock() {
    const gate = document.getElementById('auth-gate');
    gate.classList.add('unlocked');
    const app = document.getElementById('app');
    app.classList.remove('hidden');
    // Передаём dataKey в приложение
    if (typeof this.onSuccess === 'function') {
      this.onSuccess(this.dataKey);
    }
  },
};

window.Auth = Auth;

// ---------- BOOTSTRAP ----------
document.addEventListener('DOMContentLoaded', () => {
  // Показываем AuthGate сразу. DB.init() будет вызван только после unlock.
  Auth.init(async (dataKey) => {
    // Здесь — старт приложения. DB.init() и App.init() — в следующей части.
    // Пока что просто сигнал, что PIN ок.
    if (window.App && typeof window.App.start === 'function') {
      window.App.start(dataKey);
    } else {
      // Временная заглушка: если App ещё не подключён, покажем сообщение
      document.getElementById('screen').innerHTML = `
        <div class="empty-state">
          <h2>PIN принят</h2>
          <p>Приложение загружается… (следующая часть кода)</p>
        </div>
      `;
    }
  });
});
