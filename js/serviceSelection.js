// ============================================
// API CONFIGURATION
// ============================================
const API_BASE_URL = 'https://api.iristelx.com';
const PLANS_API_KEY = 'HRT88y2qywc6fwX779zG2D8fJtJQJbvz';
const ACCOUNTS_API_KEY = 'HRT88y2qywc6fwX779zG2D8fJtJQJbvz'; // used for /accounts

// ============================================
// PLAN CODE MAPPING
// Update these with actual plan codes from Iristel
// ============================================
const PLAN_CODES = {
    'ESSENTIALS': 'EXLNP_ESSENTIALS',
    'PRO': 'EXLNP_PRO',
    'PREMIUM': 'EXLNP_PREMIUM',
    'CLOUD_BASIC': 'EXLNP_SBCLDBASIC',
    'SIP_TRUNK': 'EXLNP_SBSIPTRNK'
};

// ============================================
// HARDCODED ACCOUNT ID
// ============================================
const HARDCODED_ACCOUNT_ID = '2945136';

// ============================================
// GLOBAL STATE
// ============================================
let currentAccount = null;

// ============================================
// UI FUNCTIONS
// ============================================
function disableAllPlans() {
    document.querySelectorAll('.plan-card, .service-card').forEach(card => {
        card.classList.add('disabled');
        const btn = card.querySelector('.btn-configure');
        if (btn) btn.disabled = true;
    });
}

function enableAllPlans() {
    document.querySelectorAll('.plan-card, .service-card').forEach(card => {
        card.classList.remove('disabled');
        const btn = card.querySelector('.btn-configure');
        if (btn) btn.disabled = false;
    });
}

// ============================================
// API: ADD SERVICE TO ACCOUNT
// Creates a new add service using the plan code and the
// account/contact information previously saved in cookies.
// The accountId in the URL and the body MUST match the
// account ID saved in the cookie at signup.
// ============================================
async function addServiceToAccount(accountId, planCode, planName, contactData) {
    console.log('Adding service to account:', accountId);
    console.log('Plan Code:', planCode);
    console.log('Plan Name:', planName);

    // Get the actual plan code from mapping
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

    // Use accountId from cookie (passed in) in the URL so it matches the body
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
// Runs for ALL plans (Essentials, Pro, Premium, Cloud Basic, Sip Trunk).
// Pulls account ID + contact info from cookies saved during signup,
// then creates a new add service with the mapped plan code. The
// account ID used in the URL and body must match the cookie.
// ============================================
async function selectPlan(planCode, planName) {
    console.log('=== SELECT PLAN ===');
    console.log('Plan:', planName, '| Code:', planCode);

    // Account ID must come from the cookie saved at signup so the
    // service is added to the correct account.
    const accountId = getAccountIdFromCookie() || HARDCODED_ACCOUNT_ID;
    if (!accountId) {
        showMessage('error', 'No account ID found. Please complete signup first.');
        return;
    }
    console.log('Using account ID from cookie:', accountId);

    const contactData = getContactDataFromCookies();
    if (!contactData.fname || !contactData.emailAddress) {
        showMessage('error', 'Missing contact information. Please complete signup first.');
        return;
    }

    // Confirm selection
    const confirmed = confirm(`You are about to configure the "${planName}" plan. Continue?`);
    if (!confirmed) return;

    try {
        showLoading(`Adding ${planName} to your account...`);
        hideMessage();

        // Create a new add service using the plan code and
        // the account info from cookies. Runs for every plan.
        const result = await addServiceToAccount(accountId, planCode, planName, contactData);

        hideLoading();
        showMessage('success', `${planName} has been added to your account successfully!`);

        // Store selected plan in cookie
        setCookie('iristel_selected_plan', planCode, 7);
        setCookie('iristel_selected_plan_name', planName, 7);

        // Redirect to next step after delay
        setTimeout(() => {
            if (planCode === 'SIP_TRUNK') {
                window.location.href = 'Sip Trunk/businessSetup.html';
            } else {
                window.location.href = 'addOns.html';
            }
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
    // Or: window.location.href = '/signup.html';
}

// ============================================
// INITIALIZE PAGE
// ============================================
async function initializePage() {
    console.log('=== INITIALIZING SERVICE SELECTION PAGE ===');

    try {
        showLoading('Loading your account...');
        disableAllPlans();

        const contactData = getContactDataFromCookies();

        console.log('Contact data from cookies:', contactData);
        console.log('Using hardcoded account ID:', HARDCODED_ACCOUNT_ID);

        // Validate required data
        if (!contactData.emailAddress) {
            hideLoading();
            showMessage('error', 'No email found. Please complete the signup process first.');
            return;
        }

        // Store hardcoded account ID in cookie
        setCookie('iristel_account_id', HARDCODED_ACCOUNT_ID, 7);

        // Display user info with hardcoded account ID
        document.getElementById('userEmail').textContent = contactData.emailAddress;
        document.getElementById('accountIdDisplay').textContent = HARDCODED_ACCOUNT_ID;
        document.getElementById('userInfo').style.display = 'block';

        hideLoading();
        enableAllPlans();
        showMessage('info', 'Select a service plan to continue with your account setup.');

    } catch (error) {
        console.error('Initialization error:', error);
        hideLoading();
        showMessage('error', `Failed to load account: ${error.message}`);
    }
}

// ============================================
// START
// ============================================
document.addEventListener('DOMContentLoaded', initializePage);
