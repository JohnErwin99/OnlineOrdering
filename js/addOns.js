// ============================================
// API CONFIGURATION
// ============================================
const API_BASE_URL = 'https://api.iristelx.com';
const API_KEY = 'HRT88y2qywc6fwX779zG2D8fJtJQJbvz';

// ============================================
// ADD-ON PLAN CODE MAPPING
// Mirrors the PLAN_CODES pattern in serviceSelection.html.
// These are the actual plan codes expected by the Iristel API
// when creating a new "add service" for an add-on.
// ============================================
const ADDON_CODES = {
    'INTERNATIONAL':           'EXLNP_SBINTADD',
    'TOLL_FREE':               'EXLNP_SBTOLLADD',
    'VIRTUAL_NUMBER':          'EXLNP_SBVRTNADD',
    'PRIORITY':                'EXLNP_SBPRIOADD',
    'VOICEMAIL_TRANSCRIPTION': 'EXLNP_SBVMMAIL'
};

// Track which services have been added to avoid duplicates
const addedServices = new Set();

// ============================================
// API: ADD SERVICE TO ACCOUNT
// Creates a new add service using the add-on plan code and the
// account/contact information previously saved in cookies.
// The accountId in the URL and the body MUST match the
// account ID saved in the cookie at signup.
// ============================================
async function addServiceToAccount(accountId, serviceCode, serviceName, contactData) {
    console.log('Adding add-on service:', serviceName, '| Code:', serviceCode);

    const actualCode = ADDON_CODES[serviceCode] || serviceCode;

    const requestBody = {
        accountId: accountId,
        planCode: actualCode,
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

    console.log('Add-on Request Body:', JSON.stringify(requestBody, null, 2));

    const response = await fetch(`${API_BASE_URL}/accounts/${accountId}/services`, {
        method: 'POST',
        headers: {
            'iristelx-api-key': API_KEY,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
    });

    const responseData = await response.json();
    console.log('Add-on API Response:', responseData);

    if (!response.ok) {
        throw new Error(responseData.message || `Failed to add service: ${response.status}`);
    }

    return responseData;
}

// ============================================
// TOGGLE HANDLER
// ============================================
async function handleToggle(toggle) {
    const serviceCode = toggle.dataset.service;
    const serviceName = toggle.dataset.serviceName;
    const container = toggle.closest('.toggle-container');
    const isEnabled = toggle.checked;

    // Update visual state
    if (isEnabled) {
        container.classList.add('active');
    } else {
        container.classList.remove('active');
        addedServices.delete(serviceCode);
        updateAddonsCookie();
        console.log(`${serviceName} removed from selection.`);
        return;
    }

    // Validate account
    const accountId = getAccountIdFromCookie();
    if (!accountId) {
        showMessage('error', 'No account ID found. Please complete signup first.');
        toggle.checked = false;
        container.classList.remove('active');
        return;
    }

    const contactData = getContactDataFromCookies();
    if (!contactData.fname || !contactData.emailAddress) {
        showMessage('error', 'Missing contact information. Please complete signup first.');
        toggle.checked = false;
        container.classList.remove('active');
        return;
    }

    // Call API to add the service
    try {
        showLoading(`Adding ${serviceName} to your account...`);
        hideMessage();

        // Create a new add service using the plan code and
        // the account info from cookies.
        const result = await addServiceToAccount(accountId, serviceCode, serviceName, contactData);

        hideLoading();
        addedServices.add(serviceCode);
        updateAddonsCookie();
        showMessage('success', `${serviceName} has been added to your account!`);

        console.log(`${serviceName} added successfully:`, result);

    } catch (error) {
        console.error(`Error adding ${serviceName}:`, error);
        hideLoading();
        showMessage('error', `Failed to add ${serviceName}: ${error.message}`);

        // Revert the toggle on failure
        toggle.checked = false;
        container.classList.remove('active');
    }
}

// ============================================
// COOKIE: SAVE SELECTED ADD-ONS
// ============================================
function updateAddonsCookie() {
    const selectedAddons = [];
    document.querySelectorAll('.toggle input:checked').forEach(toggle => {
        if (toggle.dataset.service) {
            selectedAddons.push({
                code: toggle.dataset.service,
                name: toggle.dataset.serviceName
            });
        }
    });
    setCookie('iristel_selected_addons', JSON.stringify(selectedAddons), 7);
}

// ============================================
// SAVE & CONTINUE
// ============================================
function saveAndContinue() {
    updateAddonsCookie();
    window.location.href = 'hardwareOrders.html';
}

// ============================================
// INITIALIZATION
// ============================================
document.addEventListener('DOMContentLoaded', function() {
    // Display account info from cookies
    const accountId = getAccountIdFromCookie();
    const contactData = getContactDataFromCookies();
    const selectedPlan = getCookie('iristel_selected_plan_name');
    console.log('=== ADD-ONS PAGE ===');
    console.log('Account ID:', accountId);
    console.log('Selected Plan:', selectedPlan);

    if (!accountId) {
        showMessage('error', 'No account found. Please complete signup and service selection first.');
    }

    // Populate "Logged in as" banner from cookies
    if (contactData.emailAddress) {
        document.getElementById('userEmail').textContent = contactData.emailAddress;
    }
    if (accountId) {
        document.getElementById('accountIdDisplay').textContent = accountId;
    }
    if (contactData.emailAddress || accountId) {
        document.getElementById('userInfo').style.display = 'block';
    }

    // Restore previously selected add-ons from cookie
    const savedAddons = getCookie('iristel_selected_addons');
    if (savedAddons) {
        try {
            const addons = JSON.parse(savedAddons);
            addons.forEach(addon => {
                const toggle = document.querySelector(`input[data-service="${addon.code}"]`);
                if (toggle) {
                    toggle.checked = true;
                    addedServices.add(addon.code);
                }
            });
        } catch (e) {
            console.error('Error parsing saved add-ons:', e);
        }
    }

    // Set initial visual state for all toggles
    const toggles = document.querySelectorAll('.toggle input');
    toggles.forEach(toggle => {
        const container = toggle.closest('.toggle-container');
        if (toggle.checked) {
            container.classList.add('active');
        }
    });

    // Attach change handlers
    toggles.forEach(toggle => {
        toggle.addEventListener('change', function() {
            handleToggle(this);
        });
    });
});
