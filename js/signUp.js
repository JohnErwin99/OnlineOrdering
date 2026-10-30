// ============================================
// API CONFIGURATION
// ============================================
const API_BASE_URL = 'https://api.iristelx.com';
const API_ENDPOINT = '/accounts';
const API_KEY = 'HRT88y2qywc6fwX779zG2D8fJtJQJbvz';

// ============================================
// PASSWORD TOGGLE & STRENGTH
// ============================================
function togglePassword() {
    const passwordInput = document.getElementById('password');
    const toggleBtn = document.querySelector('.toggle-password svg');

    if (passwordInput.type === 'password') {
        passwordInput.type = 'text';
        toggleBtn.innerHTML = `
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
            <line x1="1" y1="1" x2="23" y2="23"/>
        `;
    } else {
        passwordInput.type = 'password';
        toggleBtn.innerHTML = `
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
            <circle cx="12" cy="12" r="3"/>
        `;
    }
}

// Password strength indicator
document.getElementById('password').addEventListener('input', function(e) {
    const password = e.target.value;
    const bars = ['strength1', 'strength2', 'strength3', 'strength4'].map(id => document.getElementById(id));

    // Reset all bars
    bars.forEach(bar => bar.className = 'strength-bar');

    if (password.length === 0) return;

    let score = 0;
    if (password.length >= 8) score++;
    if (password.length >= 12) score++;
    if (/[a-z]/.test(password)) score++;
    if (/[A-Z]/.test(password)) score++;
    if (/[0-9]/.test(password)) score++;
    if (/[^a-zA-Z0-9]/.test(password)) score++;

    // Apply colors based on score
    const getClass = (s) => s <= 2 ? 'weak' : s <= 4 ? 'medium' : 'strong';
    if (score >= 1) bars[0].classList.add(getClass(score));
    if (score >= 3) bars[1].classList.add(getClass(score));
    if (score >= 5) bars[2].classList.add('strong');
    if (score >= 6) bars[3].classList.add('strong');
});

// ============================================
// VALIDATION FUNCTIONS
// ============================================
function validateEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validatePhone(phone) {
    // Must be exactly 10 digits
    const cleaned = phone.replace(/\D/g, '');
    if (/^\d{10}$/.test(cleaned)) {
        return '1' + cleaned;
    }
    return false;
}

function validatePostalCode(postalCode) {
    // Canadian postal code: A1A1A1 (6 characters, no space)
    return /^[A-Za-z]\d[A-Za-z]\d[A-Za-z]\d$/.test(postalCode);
}

function validateCountry(country) {
    // Must be exactly 2 characters
    return /^[A-Za-z]{2}$/.test(country);
}

function validatePassword(password) {
    // Minimum 8 characters, at least one uppercase, one lowercase, one number
    return /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/.test(password);
}

// ============================================
// INPUT FORMATTING
// ============================================

// Format postal code as user types (uppercase, no spaces)
document.getElementById('postalCode').addEventListener('input', function(e) {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
});

// Phone: digits only
document.getElementById('phone').addEventListener('input', function(e) {
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, 10);
});

// Clear error on input
document.querySelectorAll('.form-input').forEach(input => {
    input.addEventListener('input', function() {
        this.classList.remove('error');
        const errorEl = document.getElementById(this.id + 'Error');
        if (errorEl) errorEl.classList.remove('show');
    });
});

// ============================================
// ERROR HANDLING
// ============================================
function showFieldError(fieldId, message) {
    const field = document.getElementById(fieldId);
    const errorEl = document.getElementById(fieldId + 'Error');

    if (field) field.classList.add('error');
    if (errorEl) {
        if (message) errorEl.textContent = message;
        errorEl.classList.add('show');
    }
}

function clearAllErrors() {
    document.querySelectorAll('.form-input').forEach(input => input.classList.remove('error'));
    document.querySelectorAll('.form-error').forEach(error => error.classList.remove('show'));
}

// ============================================
// FORM VALIDATION
// ============================================
function validateForm() {
    clearAllErrors();
    let isValid = true;

    // First Name
    if (!document.getElementById('firstName').value.trim()) {
        showFieldError('firstName', 'First name is required');
        isValid = false;
    }

    // Last Name
    if (!document.getElementById('lastName').value.trim()) {
        showFieldError('lastName', 'Last name is required');
        isValid = false;
    }

    // Email
    const email = document.getElementById('email').value.trim();
    if (!email || !validateEmail(email)) {
        showFieldError('email', 'Please enter a valid email address');
        isValid = false;
    }

    // Phone (must be 10 digits)
    const phone = document.getElementById('phone').value.trim();
    if (!phone || !validatePhone(phone)) {
        showFieldError('phone', 'Phone must be exactly 10 digits');
        isValid = false;
    }

    // Address
    if (!document.getElementById('address1').value.trim()) {
        showFieldError('address1', 'Street address is required');
        isValid = false;
    }

    // City
    if (!document.getElementById('city').value.trim()) {
        showFieldError('city', 'City is required');
        isValid = false;
    }

    // Province
    if (!document.getElementById('province').value) {
        showFieldError('province', 'Please select a province');
        isValid = false;
    }

    // Postal Code (format: A1A1A1, no spaces)
    const postalCode = document.getElementById('postalCode').value.trim();
    if (!postalCode || !validatePostalCode(postalCode)) {
        showFieldError('postalCode', 'Invalid format. Use A1A1A1 (6 characters)');
        isValid = false;
    }

    // Country (must be 2 chars)
    const country = document.getElementById('country').value;
    if (!country || !validateCountry(country)) {
        showFieldError('country', 'Country must be 2 characters');
        isValid = false;
    }

    // Password
    const password = document.getElementById('password').value;
    if (!password || !validatePassword(password)) {
        showFieldError('password', 'Min 8 chars with uppercase, lowercase, and number');
        isValid = false;
    }

    return isValid;
}

// ============================================
// RESPONSE MESSAGE DISPLAY
// ============================================
function showResponse(type, title, text, errors = []) {
    const responseEl = document.getElementById('responseMessage');
    const responseTitle = document.getElementById('responseTitle');
    const responseText = document.getElementById('responseText');
    const responseErrors = document.getElementById('responseErrors');

    responseEl.className = 'response-message show ' + type;
    responseTitle.textContent = title;
    responseText.textContent = text;

    // Clear and populate errors list
    responseErrors.innerHTML = '';
    if (errors.length > 0) {
        errors.forEach(error => {
            const li = document.createElement('li');
            li.textContent = `${error.param}: ${error.message}`;
            responseErrors.appendChild(li);
        });
    }

    responseEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function hideResponse() {
    document.getElementById('responseMessage').classList.remove('show');
}

// ============================================
// LOADING STATE
// ============================================
function setLoading(loading) {
    const btn = document.getElementById('proceedBtn');
    const btnText = document.getElementById('btnText');
    const btnSpinner = document.getElementById('btnSpinner');

    btn.disabled = loading;
    btnText.textContent = loading
        ? (activeTab === 'signin' ? 'Signing in...' : 'Creating Account...')
        : proceedLabel();
    btnSpinner.style.display = loading ? 'block' : 'none';
}

function proceedLabel() {
    return activeTab === 'signin' ? 'Sign in' : 'Proceed';
}

// ============================================
// MYIRISTEL TABS
// ============================================
// Sign in with an existing MyIristel account, or create one. Both store the
// same contact details and go on to the same next step.
const TAB_COPY = {
    signin: { title: 'Sign in to MyIristel', subtitle: "Already an Iristel customer? Sign in and we'll use the details on your account." },
    create: { title: "Let's start setting up your account ...", subtitle: 'Creating your service account takes less than 5 minutes.' }
};
let activeTab = 'signin';

function setTab(tab, focus) {
    activeTab = tab;
    ['signin', 'create'].forEach(k => {
        const tabBtn = document.getElementById('tab-' + k);
        tabBtn.setAttribute('aria-selected', String(k === tab));
        tabBtn.tabIndex = k === tab ? 0 : -1;
    });
    document.getElementById('signinForm').hidden = tab !== 'signin';
    document.getElementById('signupForm').hidden = tab !== 'create';
    document.getElementById('pageTitle').textContent = TAB_COPY[tab].title;
    document.getElementById('pageSubtitle').textContent = TAB_COPY[tab].subtitle;

    // An email typed on one tab carries over to the other
    const from = document.getElementById(tab === 'create' ? 'signinEmail' : 'email');
    const to = document.getElementById(tab === 'create' ? 'email' : 'signinEmail');
    if (from.value.trim() && !to.value.trim()) to.value = from.value.trim();

    hideResponse();
    clearAllErrors();
    if (!document.getElementById('proceedBtn').disabled) {
        document.getElementById('btnText').textContent = proceedLabel();
    }
    if (focus) document.getElementById('tab-' + tab).focus();
}

document.getElementById('tab-signin').addEventListener('click', () => setTab('signin'));
document.getElementById('tab-create').addEventListener('click', () => setTab('create'));
document.getElementById('createInstead').addEventListener('click', () => setTab('create', true));
document.querySelector('.account-tabs').addEventListener('keydown', e => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    setTab(activeTab === 'signin' ? 'create' : 'signin', true);
});

// ============================================
// CONTACT DETAILS
// ============================================
// Every later step reads the customer from these
function storeContact(email, c, accountId) {
    setCookie('iristel_user_email', email);
    setCookie('iristel_user_fname', c.fname);
    setCookie('iristel_user_lname', c.lname);
    setCookie('iristel_user_phone', c.phone);
    setCookie('iristel_user_address1', c.address1);
    setCookie('iristel_user_city', c.city);
    setCookie('iristel_user_province', c.province);
    setCookie('iristel_user_country', c.country);
    setCookie('iristel_user_postalCode', c.postalCode);
    setCookie('iristel_user_language', c.language);
    // No id means the account call failed. Drop any id left by someone else
    // on this browser, so review resolves the account by email instead.
    if (accountId) setCookie('iristel_account_id', accountId);
    else deleteCookie('iristel_account_id');
}

// A MIND account's contact in the shape the signup form and cookies use.
// MIND keeps phones by type, sometimes with the country code.
function contactFromAccount(data) {
    const contact = (data && data.contact) || {};
    const phone = contact.phone || {};
    const digits = String(typeof phone === 'string' ? phone : (phone.mobile || phone.home || phone.work || '')).replace(/\D/g, '');
    return {
        fname: contact.fname || '',
        lname: contact.lname || '',
        phone: digits.length === 11 && digits[0] === '1' ? digits.slice(1) : digits,
        address1: contact.address1 || '',
        city: contact.city || '',
        province: contact.province || '',
        postalCode: (contact.postalCode || '').toUpperCase().replace(/\s/g, ''),
        country: contact.country || '',
        language: (data && data.language) || 'EN'
    };
}

// This is where a customer returning on a new device lands, so it is the
// right place to notice they already have an order under way and put them
// back on it — otherwise they would walk the whole flow again and be
// stopped only by the server-side duplicate guards.
async function continueToOrder(email, title, text) {
    const resumed = await resumeSession(email);
    if (resumed && resumed.resumable) {
        showResponse('success', 'Welcome back!',
            'You already have an order in progress. Taking you to it...');
        setTimeout(() => {
            window.location.href = 'Sip Trunk/provisioningStatus.html';
        }, 2000);
        return;
    }

    showResponse('success', title, text);
    setTimeout(() => {
        window.location.href = 'Sip Trunk/sipTrunkSelection.html';
    }, 2000);
}

// ============================================
// MYIRISTEL SIGN-IN
// ============================================
// There is no MyIristel sign-in API yet: an email with an Iristel account is a
// MyIristel account. The server finds it (its own records, then MIND by
// email) and never creates one. The password has to be filled in but is not
// checked or sent anywhere.
async function signIn() {
    clearAllErrors();
    const email = document.getElementById('signinEmail').value.trim();
    const passwordInput = document.getElementById('signinPassword');
    let isValid = true;
    if (!validateEmail(email)) {
        showFieldError('signinEmail', 'Please enter a valid email address');
        isValid = false;
    }
    if (!passwordInput.value) {
        showFieldError('signinPassword', 'Please enter your password');
        isValid = false;
    }
    if (!isValid) return;

    setLoading(true);
    let resp = null, data = null;
    try {
        resp = await fetch('/api/myiristel/sign-in', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });
        data = await resp.json().catch(() => null);
    } catch (err) {
        console.error('MyIristel sign-in error:', err);
    }
    setLoading(false);

    if (data && data.code === 'NO_ACCOUNT') {
        showFieldError('signinEmail', 'No MyIristel account uses this email');
        showResponse('error', 'No MyIristel account found',
            'Check the email, or create your account in the other tab.');
        return;
    }
    if (!resp || !resp.ok || !data || !data.accountId) {
        showResponse('error', 'Sign-in failed',
            "We couldn't open your MyIristel account right now. Please try again in a moment.");
        return;
    }

    passwordInput.value = '';
    const contact = contactFromAccount(data);
    storeContact(email, contact, data.accountId);
    console.log('Signed in to MyIristel account', data.accountId);

    const name = [contact.fname, contact.lname].filter(Boolean).join(' ') || data.name || email;
    await continueToOrder(email, 'Signed in', `Signed in as ${name}. Taking you to your order...`);
}

// ============================================
// FORM SUBMISSION
// ============================================
async function submitForm() {
    hideResponse();
    if (activeTab === 'signin') return signIn();

    // Validate form first
    if (!validateForm()) {
        showResponse('error', 'Validation Error', 'Please correct the errors above and try again.');
        return;
    }

    setLoading(true);

    // ============================================
    // MIND ACCOUNT
    // ============================================
    // Resolved through our server, never by POSTing /accounts from here.
    // The server reuses an account that already exists for this email —
    // checking its own records first, then asking MIND directly — so a
    // customer whose first order failed and who starts again from signup
    // gets their original account instead of a second one. (No account id
    // is pinned any more: the email decides — an existing MIND account for
    // it is reused, otherwise a new one is created.)
    const signupEmail = document.getElementById('email').value.trim();
    const postalCodeValue = document.getElementById('postalCode').value.trim().replace(/\s/g, '');

    const contact = {
        fname: document.getElementById('firstName').value.trim(),
        lname: document.getElementById('lastName').value.trim(),
        address1: document.getElementById('address1').value.trim(),
        city: document.getElementById('city').value.trim(),
        province: document.getElementById('province').value,
        country: document.getElementById('country').value,
        postalCode: postalCodeValue,
        emailAddress: signupEmail,
        phone: document.getElementById('phone').value.trim(),
        language: document.getElementById('language').value
    };

    let resolvedAccountId = null;
    try {
        const acctResp = await fetch('/api/account', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: signupEmail, contact })
        });
        const acctData = await acctResp.json().catch(() => null);
        if (acctResp.ok && acctData && acctData.accountId) {
            resolvedAccountId = acctData.accountId;
            console.log('Account resolved:', resolvedAccountId,
                acctData.foundInMind ? '(existing MIND account reused)'
                : acctData.reused ? '(reused)' : '(created)');
        } else {
            console.error('Account resolve failed:', acctData);
        }
    } catch (err) {
        // Signup should not dead-end on this; the review step resolves the
        // account again before anything is ordered or charged.
        console.error('Account resolve error:', err);
    }

    // Store all contact data in cookies for use across signup flow
    storeContact(signupEmail, contact, resolvedAccountId);
    console.log(resolvedAccountId
        ? 'All contact data stored in cookies (account ID: ' + resolvedAccountId + ')'
        : 'All contact data stored in cookies (account unresolved — review step will retry)');

    setLoading(false);

    await continueToOrder(signupEmail, 'Account Created!',
        'Your account has been created successfully. You will be redirected shortly.');
}

// Allow form submission with Enter key
['signinForm', 'signupForm'].forEach(id => {
    document.getElementById(id).addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            submitForm();
        }
    });
});

// ============================================
// PREFILL TEST DATA
// ============================================
/*
// COMMENTED OUT — was using hardcoded test data
function prefillTestData() {
    const testData = {
        firstName: 'John',
        lastName: 'Erwin',
        email: 'john.erwin.h@gmail.com',
        phone: '4388663425',
        address1: 'ADDRESS',
        city: 'Montreal',
        province: 'ON',
        postalCode: 'h3x2s9',
        country: 'CA',
        language: 'EN'
    };
    Object.keys(testData).forEach(field => {
        const el = document.getElementById(field);
        if (el && !el.value) el.value = testData[field];
    });
}
*/

// TEST MODE — Fetch account 1204506 from API and prefill form fields
async function prefillTestData() {
    try {
        console.log('Fetching account 1204506 to prefill form...');
        // Via our server: api.iristelx.com has no CORS headers, so a direct
        // browser fetch fails the preflight and the prefill fell back to
        // the hardcoded "Test User" data.
        const response = await fetch('/api/mind/account/1204506', {
            method: 'GET',
            headers: { 'accept': 'application/json' }
        });

        const data = await response.json();
        console.log('GET Account Response:', JSON.stringify(data, null, 2));

        if (!response.ok) {
            throw new Error(data.message || `HTTP ${response.status}`);
        }

        const contact = contactFromAccount(data);

        // Everything but the email: the tester types the email, and the
        // server checks it for an existing MIND account before creating one.
        // The password is never sent anywhere; it only has to pass the rules.
        const fieldMap = {
            firstName:  contact.fname,
            lastName:   contact.lname,
            password:   'TestPass123',
            // The test account has no phone on file; the form requires one
            phone:      contact.phone || '5145550100',
            address1:   contact.address1,
            city:       contact.city,
            province:   contact.province,
            postalCode: contact.postalCode,
            country:    contact.country,
            language:   contact.language
        };

        for (const [fieldId, value] of Object.entries(fieldMap)) {
            const el = document.getElementById(fieldId);
            if (el && value) el.value = value;
        }

        console.log('Form prefilled from account 1204506');
    } catch (error) {
        console.error('Failed to prefill from API, using fallback:', error);
        // Fallback if API fails
        document.getElementById('firstName').value = 'Test';
        document.getElementById('lastName').value = 'User';
        document.getElementById('password').value = 'TestPass123';
        document.getElementById('country').value = 'CA';
        document.getElementById('language').value = 'EN';
    }
}

// ============================================
// INITIALIZE
// ============================================
document.addEventListener('DOMContentLoaded', function() {
    clearAllCookies();
    console.log('Iristel Signup Form Initialized');
    console.log('API Endpoint:', API_BASE_URL + API_ENDPOINT);

    // Prefill test data for faster testing
    prefillTestData();

    // The demo note on the sign-in tab shows while the site orders from the
    // espresso test environment
    fetch('/api/config')
        .then(r => r.ok ? r.json() : null)
        .then(cfg => { if (cfg && cfg.didMode === 'test') document.getElementById('signinNote').hidden = false; })
        .catch(() => {});

    // Check if user email exists from previous session
    const savedEmail = getCookie('iristel_user_email');
    if (savedEmail) {
        console.log('Found saved email:', savedEmail);
    }
});
