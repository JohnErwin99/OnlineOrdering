// ============================================
// PAYMENT API CONFIGURATION
// ============================================
const BILLING_API_URL = 'https://api.iristelx.com';
const BILLING_API_KEY = 'HRT88y2qywc6fwX779zG2D8fJtJQJbvz';
const PAYMENT_API_KEY = 'b1582d78d369685683e090ad37489937';

// ============================================
// HELPERS
// ============================================
function detectCardType(number) {
    const first = number.charAt(0);
    if (first === '4') return 'visa';
    if (first === '5') return 'mastercard';
    if (first === '3') return 'amex';
    if (first === '6') return 'discover';
    return 'visa';
}

function maskCardNumber(number) {
    const digits = number.replace(/\s/g, '');
    if (digits.length < 10) return digits;
    return digits.substring(0, 6) + '******' + digits.substring(digits.length - 4);
}

function generateReference() {
    return 'IRS-' + Date.now().toString(36).toUpperCase();
}

// ============================================
// UI HELPERS
// ============================================
function validateForm() {
    const name   = document.getElementById('cardName').value.trim();
    const card   = document.getElementById('cardNumber').value.replace(/\s/g, '');
    const expiry = document.getElementById('cardExpiry').value.trim();
    const cvc    = document.getElementById('cardCvc').value.trim();

    if (!name)            { showMessage('error', 'Please enter the name on card.'); return false; }
    if (card.length < 15) { showMessage('error', 'Please enter a valid card number.'); return false; }
    if (expiry.length < 7){ showMessage('error', 'Please enter a valid expiry date.'); return false; }
    if (cvc.length < 3)   { showMessage('error', 'Please enter a valid CVV.'); return false; }
    return true;
}

// ============================================
// STEP 1: Add card and get token
// API: PATCH /billing/{masterAccountCode}/credit-card
// ============================================
async function addCard(accountCode, cardData) {
    const requestBody = {
        CVV: cardData.cvc,
        cardType: detectCardType(cardData.number),
        expMonth: cardData.expMonth,
        expYear: cardData.expYear,
        holder: cardData.holder,
        number: cardData.number
    };

    console.log('[PAYMENT STEP 1] Add Card — PATCH', `${BILLING_API_URL}/billing/${accountCode}/credit-card`);
    console.log('Request Body:', JSON.stringify(requestBody, null, 2));

    const response = await fetch(`${BILLING_API_URL}/billing/${accountCode}/credit-card`, {
        method: 'PATCH',
        headers: {
            'Content-Type': 'application/json',
            'iristelx-api-key': BILLING_API_KEY
        },
        body: JSON.stringify(requestBody)
    });

    const data = await response.json();
    console.log('Add Card Response:', data);

    if (!response.ok) {
        throw new Error(data.message || `Card addition failed (HTTP ${response.status})`);
    }

    return data;
}

// ============================================
// STEP 2: Process payment with token
// ============================================
async function makePayment(accountCode, cardData, token, amount, reference) {
    const requestBody = {
        amount: amount,
        creditCard: {
            code: detectCardType(cardData.number).toUpperCase(),
            number: maskCardNumber(cardData.number),
            token: token,
            expDate: {
                expMonth: cardData.expMonth,
                expYear: cardData.expYear
            },
            holder: cardData.holder
        },
        reference: reference
    };

    console.log('[PAYMENT STEP 2] Make Payment — POST', `${BILLING_API_URL}/bot/${accountCode}/payment`);
    console.log('Request Body:', JSON.stringify(requestBody, null, 2));

    const response = await fetch(`${BILLING_API_URL}/bot/${accountCode}/payment`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': PAYMENT_API_KEY
        },
        body: JSON.stringify(requestBody)
    });

    const data = await response.json();
    console.log('Payment Response:', data);

    if (!response.ok) {
        throw new Error(data.message || `Payment failed (HTTP ${response.status})`);
    }

    return data;
}

// ============================================
// PROCESS PAYMENT — Full flow
// ============================================
async function processPayment() {
    hideMessage();
    if (!validateForm()) return;

    const payBtn = document.getElementById('payBtn');
    payBtn.disabled = true;
    document.getElementById('loadingOverlay').classList.add('active');

    try {
        const accountCode = '75738171';

        // Extract card data from form
        const cardNumber = document.getElementById('cardNumber').value.replace(/\s/g, '');
        const expiryRaw = document.getElementById('cardExpiry').value.replace(/\s/g, '');
        const parts = expiryRaw.split('/');

        const cardData = {
            number: cardNumber,
            cvc: document.getElementById('cardCvc').value.trim(),
            expMonth: parts[0],
            expYear: '20' + parts[1],
            holder: document.getElementById('cardName').value.trim()
        };

        const monthly = parseFloat(getCookie('iristel_monthly_charge') || '25');
        const tax = +(monthly * 0.13).toFixed(2);
        const total = (monthly + tax).toFixed(2);

        // Step 1: Add card and get token
        document.getElementById('loadingText').textContent = 'Adding card...';
        const addCardResult = await addCard(accountCode, cardData);
        const token = addCardResult.token;

        if (!token) {
            throw new Error('Failed to receive card token. Please try again.');
        }
        console.log('Card added, token received');

        // Step 2: Process payment with token
        document.getElementById('loadingText').textContent = 'Processing payment...';
        const reference = generateReference();
        await makePayment(accountCode, cardData, token, total, reference);

        // Store payment info in cookies
        setCookie('iristel_payment_reference', reference);
        setCookie('iristel_payment_token', token);
        setCookie('iristel_payment_amount', total);
        console.log('Payment processed, reference:', reference);

        document.getElementById('loadingOverlay').classList.remove('active');
        showMessage('success', 'Payment successful! Redirecting...');

        // Redirect to business setup
        setTimeout(() => {
            window.location.href = 'businessSetup.html';
        }, 1500);

    } catch (err) {
        console.error('Payment failed:', err);
        document.getElementById('loadingOverlay').classList.remove('active');
        payBtn.disabled = false;
        showMessage('error', 'Payment failed: ' + err.message);
    }
}

// ============================================
// INITIALIZE
// ============================================
function initializePage() {
    const monthly = parseFloat(getCookie('iristel_monthly_charge') || '25');
    const tax = +(monthly * 0.13).toFixed(2);
    const total = +(monthly + tax).toFixed(2);

    document.getElementById('billMonthly').textContent = `$${monthly.toFixed(2)}`;
    document.getElementById('billTax').textContent = `$${tax.toFixed(2)}`;
    document.getElementById('billTotal').textContent = `$${total.toFixed(2)}`;
    document.getElementById('payButtonAmount').textContent = `$${total.toFixed(2)}`;

    // Pre-fill name from cookies if available
    const fname = getCookie('iristel_user_fname') || '';
    const lname = getCookie('iristel_user_lname') || '';
    if (fname || lname) {
        document.getElementById('cardName').value = `${fname} ${lname}`.trim();
    }

    // Prefill test card data for faster testing
    prefillTestCard();
}

function prefillTestCard() {
    const fields = {
        cardName: 'test',
        cardNumber: '5186 0017 0000 8785',
        cardExpiry: '08 / 32',
        cardCvc: '395'
    };
    for (const [id, val] of Object.entries(fields)) {
        const el = document.getElementById(id);
        if (el && !el.value) el.value = val;
    }
}

document.addEventListener('DOMContentLoaded', initializePage);
