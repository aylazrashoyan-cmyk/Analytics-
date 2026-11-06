/* ==========================================
   CRYPTO
   PBKDF2 (300k) + AES-GCM
   PIN 4 цифры, no recovery, no fallback
   ========================================== */

const Crypto = (() => {
  const PBKDF2_ITERATIONS = 300_000;
  const SALT_BYTES = 16;
  const IV_BYTES = 12;
  const VERIFIER_MSG = 'analytics-flow-verify';

  // ---------- BASE64 ----------
  function bufToB64(buf) {
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  function b64ToBuf(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }

  function randomBytes(n) {
    return crypto.getRandomValues(new Uint8Array(n));
  }

  // ---------- CONSTANT-TIME COMPARE ----------
  function timingSafeEqual(a, b) {
    if (a.byteLength !== b.byteLength) return false;
    const ua = new Uint8Array(a), ub = new Uint8Array(b);
    let diff = 0;
    for (let i = 0; i < ua.length; i++) diff |= ua[i] ^ ub[i];
    return diff === 0;
  }

  // ---------- KEY DERIVATION ----------
  async function deriveKeys(pin, saltB64) {
    const enc = new TextEncoder();
    const salt = b64ToBuf(saltB64);

    // Импорт PIN как «сырого» ключа для PBKDF2
    const pinKey = await crypto.subtle.importKey(
      'raw',
      enc.encode(pin),
      { name: 'PBKDF2' },
      false,
      ['deriveBits', 'deriveKey']
    );

    // 1) Мастер-ключ (для верификатора)
    const masterBits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
      pinKey,
      256
    );
    const masterKey = await crypto.subtle.importKey(
      'raw', masterBits,
      { name: 'HMAC', hash: 'SHA-256' },
      false, ['sign']
    );

    // 2) Верификатор = HMAC(master, VERIFIER_MSG)
    const verifier = await crypto.subtle.sign(
      'HMAC', masterKey, enc.encode(VERIFIER_MSG)
    );

    // 3) Ключ данных = HKDF(master)
    const hkdfKey = await crypto.subtle.importKey(
      'raw', masterBits,
      { name: 'HKDF' },
      false, ['deriveKey']
    );
    const dataKey = await crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: salt, info: enc.encode('data') },
      hkdfKey,
      { name: 'AES-GCM', length: 256 },
      false, ['encrypt', 'decrypt']
    );

    return { verifier: bufToB64(verifier), dataKey };
  }

  // ---------- AES-GCM ----------
  async function encrypt(dataKey, plaintext) {
    const enc = new TextEncoder();
    const iv = randomBytes(IV_BYTES);
    const ct = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      dataKey,
      enc.encode(plaintext)
    );
    return {
      iv: bufToB64(iv),
      ct: bufToB64(ct),
    };
  }

  async function decrypt(dataKey, ivB64, ctB64) {
    const dec = new TextDecoder();
    const iv = b64ToBuf(ivB64);
    const ct = b64ToBuf(ctB64);
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      dataKey,
      ct
    );
    return dec.decode(pt);
  }

  // ---------- PIN SETUP / VERIFY ----------
  async function createPin(pin) {
    const salt = bufToB64(randomBytes(SALT_BYTES));
    const { verifier, dataKey } = await deriveKeys(pin, salt);
    return { salt, verifier, dataKey };
  }

  async function verifyPin(pin, saltB64, expectedVerifierB64) {
    const { verifier, dataKey } = await deriveKeys(pin, saltB64);
    const ok = timingSafeEqual(b64ToBuf(verifier), b64ToBuf(expectedVerifierB64));
    return { ok, dataKey: ok ? dataKey : null };
  }

  // ---------- RATE LIMITING ----------
  // Храним в plain IndexedDB (не секрет)
  const RATE_KEY = 'af_rate_limit';

  async function getRateLimit() {
    return new Promise((resolve) => {
      const req = indexedDB.open('af_meta', 1);
      req.onupgradeneeded = (e) => {
        if (!e.target.result.objectStoreNames.contains('meta')) {
          e.target.result.createObjectStore('meta');
        }
      };
      req.onsuccess = (e) => {
        const tx = e.target.result.transaction('meta', 'readonly');
        const getReq = tx.objectStore('meta').get(RATE_KEY);
        getReq.onsuccess = () => resolve(getReq.result || { attempts: 0, lockedUntil: 0 });
        getReq.onerror = () => resolve({ attempts: 0, lockedUntil: 0 });
      };
      req.onerror = () => resolve({ attempts: 0, lockedUntil: 0 });
    });
  }

  async function setRateLimit(state) {
    return new Promise((resolve) => {
      const req = indexedDB.open('af_meta', 1);
      req.onupgradeneeded = (e) => {
        if (!e.target.result.objectStoreNames.contains('meta')) {
          e.target.result.createObjectStore('meta');
        }
      };
      req.onsuccess = (e) => {
        const tx = e.target.result.transaction('meta', 'readwrite');
        tx.objectStore('meta').put(state, RATE_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      };
      req.onerror = () => resolve();
    });
  }

  function delayForAttempts(attempts) {
    if (attempts < 5) return 0;
    if (attempts < 10) return 30 * 1000;
    if (attempts < 20) return 5 * 60 * 1000;
    return 60 * 60 * 1000;
  }

  async function recordFailedAttempt() {
    const st = await getRateLimit();
    st.attempts += 1;
    st.lockedUntil = Date.now() + delayForAttempts(st.attempts);
    await setRateLimit(st);
    return st;
  }

  async function resetAttempts() {
    await setRateLimit({ attempts: 0, lockedUntil: 0 });
  }

  // ---------- PUBLIC ----------
  return {
    bufToB64,
    b64ToBuf,
    randomBytes,
    createPin,
    verifyPin,
    encrypt,
    decrypt,
    getRateLimit,
    setRateLimit,
    recordFailedAttempt,
    resetAttempts,
  };
})();

window.Crypto = Crypto;
