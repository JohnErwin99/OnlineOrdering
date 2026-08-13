// ============================================
// COMMON UTILITIES — Shared across all pages
// ============================================

// ============================================
// STORAGE
// ============================================
// Order state used to live in sessionStorage, which dies with the tab — a
// customer who closed it after paying lost everything and, on restarting,
// would order and be billed for a second set of numbers.
//
// localStorage survives the tab, but can be blocked in a cross-origin iframe
// (this app embeds in Webflow), which is why sessionStorage was chosen
// originally. So: prefer localStorage, fall back to sessionStorage, then to
// memory. Whatever is available, the app behaves the same.
//
// This is only half the protection. Storage can always be cleared or the
// customer can switch devices, so the guarantee that an order is never placed
// twice lives on the server (idempotency in server.js), not here.
const STORAGE_TTL_MS = 24 * 60 * 60 * 1000; // a stale half-order helps nobody
const STORAGE_TS_KEY = '__iris_state_ts';

const irisStore = (function () {
    function usable(store) {
        try {
            const probe = '__iris_probe';
            store.setItem(probe, '1');
            store.removeItem(probe);
            return true;
        } catch (e) {
            return false;
        }
    }
    try {
        if (typeof localStorage !== 'undefined' && usable(localStorage)) return localStorage;
    } catch (e) {}
    try {
        if (typeof sessionStorage !== 'undefined' && usable(sessionStorage)) return sessionStorage;
    } catch (e) {}
    // Last resort: in-memory, same API surface. Lasts only for this page.
    const mem = {};
    return {
        getItem: k => (k in mem ? mem[k] : null),
        setItem: (k, v) => { mem[k] = String(v); },
        removeItem: k => { delete mem[k]; },
        clear: () => { Object.keys(mem).forEach(k => delete mem[k]); }
    };
})();

// Persisting across tab close means a half-finished order from last week can
// resurface and confuse the flow, so state expires.
(function expireStaleState() {
    try {
        const ts = parseInt(irisStore.getItem(STORAGE_TS_KEY), 10);
        if (ts && Date.now() - ts > STORAGE_TTL_MS) {
            console.log('[storage] state older than 24h — clearing');
            irisStore.clear();
        }
    } catch (e) {}
})();

function getCookie(name) {
    return irisStore.getItem(name);
}

function setCookie(name, value) {
    irisStore.setItem(name, value);
    try { irisStore.setItem(STORAGE_TS_KEY, String(Date.now())); } catch (e) {}
}

function deleteCookie(name) {
    irisStore.removeItem(name);
}

function clearAllCookies() {
    irisStore.clear();
}

// ============================================
// SESSION RESUME
// ============================================
// Local storage is not the source of truth for anything that costs money. The
// server records each spend-or-provision step against the customer's email, so
// a browser that has forgotten everything — or a different device entirely —
// can pick the order back up instead of paying for it twice.
//
// Only IN-FLIGHT orders resume. A finished order is deliberately not resumable:
// a customer returning next week is buying a second trunk, not revisiting the
// first, and must be allowed to order and be charged normally.
function currentCustomerEmail() {
    return getCookie('sip_billingEmail') || getCookie('iristel_user_email') || '';
}

async function fetchServerSession(email) {
    const addr = (email || currentCustomerEmail() || '').trim();
    if (!addr) return null;
    try {
        const r = await fetch('/api/session?email=' + encodeURIComponent(addr));
        if (!r.ok) return null;
        return await r.json();
    } catch (e) {
        console.warn('Session lookup failed (continuing without it):', e.message);
        return null;
    }
}

// Copies whatever the server knows into local storage. Never overwrites a
// value the browser already has — local edits in progress win.
function applyServerSession(session) {
    if (!session) return false;
    let restored = false;
    const put = (k, v) => { if (v && !getCookie(k)) { setCookie(k, String(v)); restored = true; } };

    if (session.account && session.account.accountId) {
        put('iristel_account_id', session.account.accountId);
    }
    if (session.order) {
        put('sip_didOrderNumber', session.order.orderNumber);
        if (session.order.businessName) put('sip_businessName', session.order.businessName);
        if (Array.isArray(session.order.trunks) && session.order.trunks.length && !getCookie('sip_trunks')) {
            setCookie('sip_trunks', JSON.stringify(session.order.trunks));
            restored = true;
        }
    }
    if (session.pon && session.pon.pon) put('sip_ponNumber', session.pon.pon);
    if (session.provisions && session.provisions.length) {
        put('sip_provisionJobId', session.provisions[0].jobId);
        if (!getCookie('sip_provisionJobs')) {
            setCookie('sip_provisionJobs', JSON.stringify(
                session.provisions.map(p => ({ trunkName: p.trunkName || 'Trunk', jobId: p.jobId }))));
            restored = true;
        }
    }
    if (restored) console.log('Restored in-progress order from the server for', session.email);
    return restored;
}

// Convenience for page load: look up, restore, and say whether the customer has
// an order already under way.
async function resumeSession(email) {
    const session = await fetchServerSession(email);
    if (!session) return null;
    applyServerSession(session);
    return session;
}

// Pushes the trunk layout (now carrying assigned numbers) back to the order
// record, so a customer resuming elsewhere sees their number immediately.
async function saveTrunksToServer(trunks, email) {
    const addr = (email || currentCustomerEmail() || '').trim();
    if (!addr || !Array.isArray(trunks) || !trunks.length) return;
    try {
        await fetch('/api/session/trunks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: addr, trunks: trunks })
        });
    } catch (e) {
        console.warn('Could not save trunks to the server:', e.message);
    }
}

// Tells the server the order finished, which releases the duplicate guards so
// the customer's next purchase is treated as new rather than as a repeat.
async function markOrderComplete(email) {
    const addr = (email || currentCustomerEmail() || '').trim();
    if (!addr) return;
    try {
        await fetch('/api/session/complete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: addr })
        });
        console.log('Order closed out server-side — a future purchase will be treated as new');
    } catch (e) {
        console.warn('Could not close the order out:', e.message);
    }
}

// ============================================
// ACCOUNT DATA FROM COOKIES
// ============================================
function getContactDataFromCookies() {
    return {
        fname: getCookie('iristel_user_fname') || '',
        lname: getCookie('iristel_user_lname') || '',
        emailAddress: getCookie('iristel_user_email') || '',
        phone: getCookie('iristel_user_phone') || '',
        address1: getCookie('iristel_user_address1') || '',
        city: getCookie('iristel_user_city') || '',
        province: getCookie('iristel_user_province') || '',
        country: getCookie('iristel_user_country') || '',
        postalCode: getCookie('iristel_user_postalCode') || ''
    };
}

function getAccountIdFromCookie() {
    return getCookie('iristel_account_id') || null;
}

// ============================================
// PORTING
// One definition shared by every SIP trunk page — the number source page, the
// number selection page and the review/provisioning step must always agree.
// ============================================
function isPortingOrder() {
    return getCookie('sip_isPorting') === 'true'
        || getCookie('sip_numberSource') === 'port'
        // Transitional: the LOA page used to write this misspelling. Safe to drop
        // once no session started before the fix can still be in flight.
        || getCookie('sip_isPoriting') === 'true';
}

// ============================================
// ORDER STEP RESULTS
// The provisioning status page renders the pre-provisioning steps from these,
// so every step must record what actually happened — never assume success.
// state: 'done' | 'error'
// ============================================
const ORDER_STEP_KEYS = ['account', 'service'];

function setOrderStepResult(step, state, detail) {
    setCookie('sip_step_' + step, JSON.stringify({ state: state, detail: detail || '' }));
}

function getOrderStepResult(step) {
    const raw = getCookie('sip_step_' + step);
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch (e) {
        return null;
    }
}

function clearOrderStepResults() {
    ORDER_STEP_KEYS.forEach(step => deleteCookie('sip_step_' + step));
}

// ============================================
// UI: MESSAGE BOX
// ============================================
function showMessage(type, message) {
    const box = document.getElementById('messageBox');
    if (!box) return;
    box.className = 'message-box ' + type;
    box.textContent = message;
    // Let the parent page (Iris) know what error the customer is looking at
    if (type === 'error' && window.IrisBridge) window.IrisBridge.error(message);
}

function hideMessage() {
    const box = document.getElementById('messageBox');
    if (!box) return;
    box.className = 'message-box';
    box.textContent = '';
}

// ============================================
// UI: BRANDED DIALOG
// ============================================
// Replaces the browser's native alert/confirm, which ignore the page styling and
// name the host ("onlineordering.onrender.com says") in the middle of a checkout.
// The markup and styles are injected here so every page gets them from common.js
// alone. Colours fall back to literals because not every page defines the vars.
const IRIS_DIALOG_STYLES = `
    .iris-dialog-overlay {
        position: fixed; inset: 0; z-index: 10000;
        background: rgba(1, 17, 30, 0.55);
        display: flex; align-items: center; justify-content: center;
        padding: 20px; opacity: 0; pointer-events: none;
        transition: opacity 0.18s ease;
    }
    .iris-dialog-overlay.active { opacity: 1; pointer-events: auto; }
    .iris-dialog {
        background: #FFFFFF; border-radius: 12px;
        box-shadow: 0 18px 50px rgba(1, 17, 30, 0.28);
        width: 100%; max-width: 440px; overflow: hidden;
        font-family: 'Ubuntu', 'Heebo', sans-serif;
        transform: translateY(8px) scale(0.98);
        transition: transform 0.18s ease;
    }
    .iris-dialog-overlay.active .iris-dialog { transform: translateY(0) scale(1); }
    .iris-dialog-accent { height: 4px; background: var(--tufts-blue, #004a9f); }
    .iris-dialog-accent.error { background: var(--magenta-glow, #d1155a); }
    .iris-dialog-accent.success { background: var(--success-green, #10B981); }
    .iris-dialog-body { padding: 26px 28px 22px; display: flex; gap: 16px; }
    .iris-dialog-icon {
        flex-shrink: 0; width: 40px; height: 40px; border-radius: 50%;
        display: flex; align-items: center; justify-content: center;
        background: rgba(0, 74, 159, 0.1); color: var(--tufts-blue, #004a9f);
    }
    .iris-dialog-icon.error { background: rgba(209, 21, 90, 0.1); color: var(--magenta-glow, #d1155a); }
    .iris-dialog-icon.success { background: rgba(16, 185, 129, 0.1); color: var(--success-green, #10B981); }
    .iris-dialog-icon svg { width: 22px; height: 22px; }
    .iris-dialog-text { flex: 1; min-width: 0; }
    .iris-dialog-title {
        font-size: 16px; font-weight: 600; margin-bottom: 6px;
        color: var(--rich-black, #01111E);
    }
    .iris-dialog-message {
        font-size: 14px; line-height: 1.55; color: var(--text-gray, #5A6A7A);
        white-space: pre-wrap; overflow-wrap: anywhere;
    }
    .iris-dialog-actions {
        display: flex; justify-content: flex-end; gap: 10px;
        padding: 0 28px 24px;
    }
    .iris-dialog-btn {
        padding: 10px 22px; border-radius: 999px; border: none; cursor: pointer;
        font-family: 'Ubuntu', 'Heebo', sans-serif; font-size: 14px; font-weight: 500;
        transition: background 0.2s, opacity 0.2s;
    }
    .iris-dialog-btn.primary { background: var(--tufts-blue, #004a9f); color: #FFFFFF; }
    .iris-dialog-btn.primary:hover { opacity: 0.88; }
    .iris-dialog-btn.primary.error { background: var(--magenta-glow, #d1155a); }
    .iris-dialog-btn.secondary {
        background: transparent; color: var(--text-gray, #5A6A7A);
        border: 1px solid var(--medium-gray, #E8ECF1);
    }
    .iris-dialog-btn.secondary:hover { background: var(--light-gray, #F5F7FA); }
`;

const IRIS_DIALOG_ICONS = {
    info: '<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M18 10A8 8 0 112 10a8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd"/></svg>',
    error: '<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>',
    success: '<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg>'
};

function ensureIrisDialog() {
    let overlay = document.getElementById('irisDialogOverlay');
    if (overlay) return overlay;

    const style = document.createElement('style');
    style.textContent = IRIS_DIALOG_STYLES;
    document.head.appendChild(style);

    overlay = document.createElement('div');
    overlay.id = 'irisDialogOverlay';
    overlay.className = 'iris-dialog-overlay';
    overlay.innerHTML = `
        <div class="iris-dialog" role="dialog" aria-modal="true" aria-labelledby="irisDialogTitle">
            <div class="iris-dialog-accent" id="irisDialogAccent"></div>
            <div class="iris-dialog-body">
                <div class="iris-dialog-icon" id="irisDialogIcon"></div>
                <div class="iris-dialog-text">
                    <div class="iris-dialog-title" id="irisDialogTitle"></div>
                    <div class="iris-dialog-message" id="irisDialogMessage"></div>
                </div>
            </div>
            <div class="iris-dialog-actions" id="irisDialogActions"></div>
        </div>`;
    document.body.appendChild(overlay);
    return overlay;
}

// type: 'info' | 'error' | 'success'. onConfirm omitted means a single OK button.
function showDialog(options) {
    const opts = options || {};
    const type = opts.type || 'info';
    const overlay = ensureIrisDialog();

    document.getElementById('irisDialogAccent').className = 'iris-dialog-accent ' + type;
    const icon = document.getElementById('irisDialogIcon');
    icon.className = 'iris-dialog-icon ' + type;
    icon.innerHTML = IRIS_DIALOG_ICONS[type] || IRIS_DIALOG_ICONS.info;
    document.getElementById('irisDialogTitle').textContent = opts.title
        || (type === 'error' ? 'Something went wrong' : type === 'success' ? 'Success' : 'Please confirm');
    document.getElementById('irisDialogMessage').textContent = opts.message || '';

    const actions = document.getElementById('irisDialogActions');
    actions.innerHTML = '';

    function close() {
        overlay.classList.remove('active');
        document.removeEventListener('keydown', onKey);
    }
    function onKey(e) {
        if (e.key === 'Escape') { close(); if (opts.onCancel) opts.onCancel(); }
    }

    if (opts.onConfirm) {
        const cancel = document.createElement('button');
        cancel.className = 'iris-dialog-btn secondary';
        cancel.textContent = opts.cancelText || 'Cancel';
        cancel.onclick = () => { close(); if (opts.onCancel) opts.onCancel(); };
        actions.appendChild(cancel);
    }

    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'iris-dialog-btn primary' + (type === 'error' ? ' error' : '');
    confirmBtn.textContent = opts.confirmText || 'OK';
    confirmBtn.onclick = () => { close(); if (opts.onConfirm) opts.onConfirm(); };
    actions.appendChild(confirmBtn);

    document.addEventListener('keydown', onKey);
    overlay.classList.add('active');
    confirmBtn.focus();
}

// Drop-in for the native calls. alert() returns nothing, so routing it through the
// branded dialog is transparent to callers. confirm() cannot be — it answers
// synchronously — so showConfirm takes a callback and callers were converted.
function showAlert(message, type, title) {
    showDialog({ message: message, type: type || 'info', title: title });
}

function showConfirm(message, onConfirm, options) {
    const opts = options || {};
    showDialog({
        message: message,
        type: opts.type || 'info',
        title: opts.title || 'Please confirm',
        confirmText: opts.confirmText || 'Continue',
        cancelText: opts.cancelText || 'Cancel',
        onConfirm: onConfirm,
        onCancel: opts.onCancel
    });
}

// Safety net for any alert() left in the codebase: neutral styling, since a bare
// string says nothing about whether it is a failure or a validation nudge. Call
// sites that know better call showAlert directly with a type and title.
window.alert = function (message) {
    showAlert(String(message == null ? '' : message), 'info', 'Notice');
};

// ============================================
// UI: LOADING OVERLAY
// ============================================
function showLoading(message = 'Loading...') {
    const text = document.getElementById('loadingText');
    const overlay = document.getElementById('loadingOverlay');
    if (text) text.textContent = message;
    if (overlay) overlay.classList.add('active');
}

function hideLoading() {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) overlay.classList.remove('active');
}

// ============================================
// UI: USER INFO BAR
// ============================================
function loadUserInfoBar() {
    const email = getCookie('iristel_user_email');
    const accountId = getCookie('iristel_account_id');
    const userEmailEl = document.getElementById('userEmail');
    const accountIdEl = document.getElementById('accountIdDisplay');
    const userInfoEl = document.getElementById('userInfo');
    if (userEmailEl) userEmailEl.textContent = email || '--';
    if (accountIdEl) accountIdEl.textContent = accountId || '--';
    if (userInfoEl && (email || accountId)) userInfoEl.style.display = 'block';
}

// ============================================
// INPUT FORMATTERS
// ============================================
function formatCardNumber(input) {
    let val = input.value.replace(/\D/g, '').substring(0, 16);
    input.value = val.replace(/(.{4})/g, '$1 ').trim();
}

function formatExpiry(input) {
    let val = input.value.replace(/\D/g, '').substring(0, 4);
    if (val.length >= 3) val = val.substring(0, 2) + ' / ' + val.substring(2);
    input.value = val;
}
