// ============================================
// LOAD SUMMARY FROM COOKIES
// ============================================
function populateSummary() {
    const service  = getCookie('iristel_selected_plan_name') || 'Cloud Basic License';
    const hardware = getCookie('iristel_hardware') || 'Yealink Premium Smartphone';
    const numbers  = getCookie('iristel_number') || '+1 234 567 8901';
    const activation = getCookie('iristel_activation_date') || 'As soon as possible';
    const email    = getCookie('iristel_user_email') || '';
    const monthly  = parseFloat(getCookie('iristel_monthly_charge') || '45');

    document.getElementById('summaryService').textContent    = service;
    document.getElementById('summaryHardware').textContent   = hardware;
    document.getElementById('summaryNumbers').textContent    = numbers;
    document.getElementById('summaryActivation').textContent = activation;
    document.getElementById('payEmail').value = email;

    // Calculate
    const tax   = +(monthly * 0.13).toFixed(2);
    const total = +(monthly + tax).toFixed(2);

    document.getElementById('beforeTax').textContent    = `$${monthly.toFixed(2)}`;
    document.getElementById('taxAmount').textContent    = `$${tax.toFixed(2)}`;
    document.getElementById('totalDue').textContent     = `$${total.toFixed(2)}`;
    document.getElementById('monthlyTotal').textContent = `$${monthly.toFixed(2)}/mo`;
    document.getElementById('payButtonAmount').textContent = `$${total.toFixed(2)}`;
}

// ============================================
// PROCESS PAYMENT
// ============================================
function validateForm() {
    const email  = document.getElementById('payEmail').value.trim();
    const card   = document.getElementById('cardNumber').value.replace(/\s/g,'');
    const expiry = document.getElementById('cardExpiry').value.trim();
    const cvc    = document.getElementById('cardCvc').value.trim();
    const name   = document.getElementById('cardName').value.trim();

    if (!email || !email.includes('@')) { showMessage('error', 'Please enter a valid email address.'); return false; }
    if (card.length < 15) { showMessage('error', 'Please enter a valid card number.'); return false; }
    if (expiry.length < 7) { showMessage('error', 'Please enter a valid expiry date.'); return false; }
    if (cvc.length < 3)   { showMessage('error', 'Please enter a valid CVC.'); return false; }
    if (!name)            { showMessage('error', 'Please enter the name on card.'); return false; }
    return true;
}

async function processPayment() {
    hideMessage();
    if (!validateForm()) return;

    document.getElementById('loadingOverlay').classList.add('active');

    // Simulate payment processing
    await new Promise(r => setTimeout(r, 2000));

    document.getElementById('loadingOverlay').classList.remove('active');
    window.location.href = 'paymentConfirmation.html';
}

// Init
populateSummary();
