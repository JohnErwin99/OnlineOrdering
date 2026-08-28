// ============================================
// PAYMENT API CONFIGURATION
// ============================================
// This page only tokenizes the card, so it needs the billing credentials alone.
// The payment key lives with the charge, on the Review page.
const BILLING_API_URL = 'https://api.iristelx.com';
const BILLING_API_KEY = 'HRT88y2qywc6fwX779zG2D8fJtJQJbvz';

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

// Note: this page only tokenizes the card. The charge itself lives on the Review
// page (chargeRemainingBalance in sip-sipReview.js), which owns the one call to
// POST /bot/{account}/payment.

// ============================================
// DIGITAL WALLETS — Placeholder only.
// Moneris is being enhanced to support Apple Pay / Google Pay;
// wire up the real wallet flow here once it's available.
// ============================================
function payWithWallet(walletName) {
    hideMessage();
    showMessage('error', walletName + ' is coming soon. Please pay with a card for now.');
}

// ============================================
// SAVE CARD — Tokenize only, charge happens on Review page
// ============================================
async function processPayment() {
    hideMessage();
    if (!validateForm()) return;

    const payBtn = document.getElementById('payBtn');
    payBtn.disabled = true;
    document.getElementById('loadingOverlay').classList.add('active');

    try {
        const accountCode = getCookie('iristel_account_id') || '7142292';

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

        // Add card and get token (no charge — payment happens on the Review page)
        document.getElementById('loadingText').textContent = 'Saving card...';
        const addCardResult = await addCard(accountCode, cardData);
        const token = addCardResult.token;

        if (!token) {
            throw new Error('Failed to receive card token. Please try again.');
        }
        console.log('Card saved, token received');

        // Store token and card info for charging later on the Review page.
        // The payment API needs the full creditCard object — code, masked number,
        // expDate and holder alongside the token — so every field it wants is
        // persisted here. Only the masked number is kept; the full PAN is not.
        setCookie('iristel_payment_token', token);
        setCookie('iristel_payment_card_type', detectCardType(cardNumber));
        setCookie('iristel_payment_card_last4', cardNumber.slice(-4));
        setCookie('iristel_payment_card_code', detectCardType(cardNumber).toUpperCase());
        setCookie('iristel_payment_card_masked', maskCardNumber(cardNumber));
        setCookie('iristel_payment_card_expmonth', cardData.expMonth);
        setCookie('iristel_payment_card_expyear', cardData.expYear);
        setCookie('iristel_payment_card_holder', cardData.holder);
        // The charge request fills creditCard.securityCode, so the CVV has to
        // survive until the Review page. NOTE: persisting a CVV is against
        // PCI DSS — revisit before launch (charge on this page instead, or
        // confirm MIND accepts the charge without it).
        setCookie('iristel_payment_card_cvv', cardData.cvc);

        if (window.IrisBridge) window.IrisBridge.cardSaved(cardNumber.slice(-4));

        document.getElementById('loadingOverlay').classList.remove('active');
        showMessage('success', 'Card saved! Redirecting...');

        // Redirect to business setup
        setTimeout(() => {
            window.location.href = 'businessSetup.html';
        }, 1500);

    } catch (err) {
        console.error('Card save failed:', err);
        document.getElementById('loadingOverlay').classList.remove('active');
        payBtn.disabled = false;
        showMessage('error', 'Failed to save card: ' + err.message);
    }
}

// ============================================
// INITIALIZE
// Note: the promo code is entered on the Review page, where the card is actually
// charged. The total shown here is the pre-promo estimate.
// ============================================
function initializePage() {
    const monthly = parseFloat(getCookie('iristel_monthly_charge') || '25');
    const tax = +(monthly * 0.13).toFixed(2);
    const total = +(monthly + tax).toFixed(2);

    document.getElementById('billMonthly').textContent = `$${monthly.toFixed(2)}`;
    document.getElementById('billTax').textContent = `$${tax.toFixed(2)}`;
    document.getElementById('billTotal').textContent = `$${total.toFixed(2)}`;

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
