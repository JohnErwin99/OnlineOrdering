// ============================================
// POPULATE CONFIRMATION FROM COOKIES
// ============================================
function populateConfirmation() {
    const service = getCookie('iristel_selected_plan_name');
    if (service) {
        document.getElementById('confService3').textContent = service;
    }

    const hardware = getCookie('iristel_hardware');
    if (hardware) {
        document.getElementById('confService2').textContent = hardware;
    }

    const number = getCookie('iristel_number');
    if (number) {
        document.getElementById('confService1').textContent = 'Phone Number: ' + number;
    }
}

populateConfirmation();
