// ============================================
// COMMON UTILITIES — Shared across all pages
// ============================================

// ============================================
// STORAGE FUNCTIONS (sessionStorage – works inside cross-origin iframes)
// ============================================
function getCookie(name) {
    return sessionStorage.getItem(name);
}

function setCookie(name, value) {
    sessionStorage.setItem(name, value);
}

function deleteCookie(name) {
    sessionStorage.removeItem(name);
}

function clearAllCookies() {
    sessionStorage.clear();
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
