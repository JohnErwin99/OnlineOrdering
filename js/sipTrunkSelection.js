// ============================================
// API CONFIGURATION
// ============================================
const API_BASE_URL = 'https://api.iristelx.com';
const ACCOUNTS_API_KEY = 'HRT88y2qywc6fwX779zG2D8fJtJQJbvz';

const PLAN_CODES = {
    'SIP_TRUNK': 'EXLNP_SBSIPTRNK'
};

// Account ID comes from cookie (set during signup)

// ============================================
// UI FUNCTIONS
// ============================================
function disableCard() {
    const card = document.querySelector('.service-card');
    card.classList.add('disabled');
    const btn = card.querySelector('.btn-configure');
    if (btn) btn.disabled = true;
}

function enableCard() {
    const card = document.querySelector('.service-card');
    card.classList.remove('disabled');
    const btn = card.querySelector('.btn-configure');
    if (btn) btn.disabled = false;
}

// ============================================
// API: ADD SERVICE TO ACCOUNT
// ============================================
async function addServiceToAccount(accountId, planCode, planName, contactData) {
    console.log('Adding service to account:', accountId);
    console.log('Plan Code:', planCode);

    const actualPlanCode = PLAN_CODES[planCode] || planCode;

    const requestBody = {
        accountId: accountId,
        planCode: actualPlanCode,
        contact: {
            fname: contactData.fname,
            lname: contactData.lname,
            address1: contactData.address1,
            city: contactData.city,
            province: contactData.province,
            country: contactData.country,
            postalCode: contactData.postalCode,
            emailAddress: contactData.emailAddress,
            phone: contactData.phone || ''
        }
    };

    console.log('Service Request Body:', JSON.stringify(requestBody, null, 2));

    const response = await fetch(`${API_BASE_URL}/accounts/${accountId}/services`, {
        method: 'POST',
        headers: {
            'iristelx-api-key': ACCOUNTS_API_KEY,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
    });

    const responseData = await response.json();
    console.log('Service API Response:', responseData);

    if (!response.ok) {
        throw new Error(responseData.message || `Failed to add service: ${response.status}`);
    }

    return responseData;
}

// ============================================
// SELECT PLAN HANDLER
// ============================================
async function selectPlan(planCode, planName) {
    console.log('=== SELECT PLAN ===');
    console.log('Plan:', planName, '| Code:', planCode);

    const accountId = getAccountIdFromCookie();
    if (!accountId) {
        showMessage('error', 'No account ID found. Please complete signup first.');
        return;
    }

    const contactData = getContactDataFromCookies();
    if (!contactData.fname || !contactData.emailAddress) {
        showMessage('error', 'Missing contact information. Please complete signup first.');
        return;
    }

    const confirmed = confirm(`You are about to configure the "${planName}" plan. Continue?`);
    if (!confirmed) return;

    try {
        showLoading(`Adding ${planName} to your account...`);
        hideMessage();

        const result = await addServiceToAccount(accountId, planCode, planName, contactData);

        hideLoading();
        showMessage('success', `${planName} has been added to your account successfully!`);

        // Store selected plan in cookie
        setCookie('iristel_selected_plan', planCode, 7);
        setCookie('iristel_selected_plan_name', planName, 7);
        setCookie('iristel_monthly_charge', '25', 7);

        // Redirect to SIP Trunk business setup
        setTimeout(() => {
            window.location.href = 'sipTrunkPayment.html';
        }, 1500);

    } catch (error) {
        console.error('Error adding service:', error);
        hideLoading();
        showMessage('error', `Failed to add service: ${error.message}`);
    }
}

// ============================================
// NAVIGATION
// ============================================
function goBack() {
    window.history.back();
}

// ============================================
// INITIALIZE PAGE
// ============================================
async function initializePage() {
    console.log('=== INITIALIZING SIP TRUNK SELECTION PAGE ===');

    try {
        showLoading('Loading your account...');
        disableCard();

        const contactData = getContactDataFromCookies();

        if (!contactData.emailAddress) {
            hideLoading();
            showMessage('error', 'No email found. Please complete the signup process first.');
            return;
        }

        const accountId = getAccountIdFromCookie();

        document.getElementById('userEmail').textContent = contactData.emailAddress;
        document.getElementById('accountIdDisplay').textContent = accountId || '--';
        document.getElementById('userInfo').style.display = 'block';

        hideLoading();
        enableCard();
        showMessage('info', 'Click "Configure Plan" to set up your SIP Trunk service.');

    } catch (error) {
        console.error('Initialization error:', error);
        hideLoading();
        showMessage('error', `Failed to load account: ${error.message}`);
    }
}

document.addEventListener('DOMContentLoaded', initializePage);
