// ============================================
// POPULATE CONFIRMATION FROM COOKIES
// ============================================
function populateConfirmation() {
    const service    = getCookie('iristel_selected_plan_name') || 'Cloud Basic License';
    const hardware   = getCookie('iristel_hardware') || 'Yealink Premium Smartphone';
    const number     = getCookie('iristel_number') || '+1 234 567 8901';
    const activation = getCookie('iristel_activation_date') || 'As soon as possible';
    const email      = getCookie('iristel_user_email') || 'your email';
    const monthly    = parseFloat(getCookie('iristel_monthly_charge') || '45');

    const tax   = +(monthly * 0.13).toFixed(2);
    const total = +(monthly + tax).toFixed(2);

    // Generate a simple order ID
    const orderId = 'IRS-' + Date.now().toString(36).toUpperCase().slice(-8);

    document.getElementById('orderId').textContent        = `Order #${orderId}`;
    document.getElementById('confService').textContent    = service;
    document.getElementById('confHardware').textContent   = hardware;
    document.getElementById('confNumber').textContent     = number;
    document.getElementById('confActivation').textContent = activation;
    document.getElementById('confMonthly').textContent    = `$${monthly.toFixed(2)}/mo`;
    document.getElementById('confTotal').textContent      = `$${total.toFixed(2)}`;
    document.getElementById('confEmail').textContent      = email;
}

populateConfirmation();
