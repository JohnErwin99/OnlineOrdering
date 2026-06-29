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
    btnText.textContent = loading ? 'Creating Account...' : 'Proceed';
    btnSpinner.style.display = loading ? 'block' : 'none';
}

// ============================================
// FORM SUBMISSION
// ============================================
async function submitForm() {
    hideResponse();

    // Validate form first
    if (!validateForm()) {
        showResponse('error', 'Validation Error', 'Please correct the errors above and try again.');
        return;
    }

    setLoading(true);

    // ============================================
    // API CALL COMMENTED OUT - Using hardcoded account ID for now
    // ============================================

    /*
    // Remove spaces from postal code for API
    const postalCodeValue = document.getElementById('postalCode').value.trim().replace(/\s/g, '');

    const requestBody = {
        contact: {
            fname: document.getElementById('firstName').value.trim(),
            lname: document.getElementById('lastName').value.trim(),
            address1: document.getElementById('address1').value.trim(),
            city: document.getElementById('city').value.trim(),
            province: document.getElementById('province').value,
            country: document.getElementById('country').value,
            postalCode: postalCodeValue,
            emailAddress: document.getElementById('email').value.trim(),
            phone: {
                mobile: document.getElementById('phone').value.trim()
            }
        },
        language: document.getElementById('language').value,
        businessUnit: "1"
    };

    // Log request for debugging (remove in production)
    console.log('=== API REQUEST ===');
    console.log('Endpoint:', API_BASE_URL + API_ENDPOINT);
    console.log('Request Body:', JSON.stringify(requestBody, null, 2));

    try {
        const response = await fetch(API_BASE_URL + API_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'iristelx-api-key': API_KEY
            },
            body: JSON.stringify(requestBody)
        });

        // Parse response
        const responseText = await response.text();
        let data;

        try {
            data = responseText ? JSON.parse(responseText) : null;
        } catch (parseError) {
            data = { message: responseText };
        }

        console.log('=== API RESPONSE ===');
        console.log('Status:', response.status);
        console.log('Data:', JSON.stringify(data, null, 2));

        setLoading(false);

        if (response.ok) {
            // SUCCESS

            // Store all contact data in cookies for use across signup flow
            setCookie('iristel_user_email', document.getElementById('email').value.trim(), 7);
            setCookie('iristel_user_fname', document.getElementById('firstName').value.trim(), 7);
            setCookie('iristel_user_lname', document.getElementById('lastName').value.trim(), 7);
            setCookie('iristel_user_phone', document.getElementById('phone').value.trim(), 7);
            setCookie('iristel_user_address1', document.getElementById('address1').value.trim(), 7);
            setCookie('iristel_user_city', document.getElementById('city').value.trim(), 7);
            setCookie('iristel_user_province', document.getElementById('province').value, 7);
            setCookie('iristel_user_country', document.getElementById('country').value, 7);
            setCookie('iristel_user_postalCode', document.getElementById('postalCode').value.trim(), 7);
            setCookie('iristel_user_language', document.getElementById('language').value, 7);

            // Store account ID from response if available
            if (data && (data.accountId || data.id || data.accountcode)) {
                const accountId = data.accountId || data.id || data.accountcode;
                setCookie('iristel_account_id', accountId, 7);
                console.log('Account ID stored:', accountId);
            }

            console.log('All contact data stored in cookies');

            showResponse('success', 'Account Created!', 'Your account has been created successfully. You will be redirected shortly.');

            // Clear form
            document.getElementById('signupForm').reset();

            // Reset password strength bars
            ['strength1', 'strength2', 'strength3', 'strength4'].forEach(id => {
                document.getElementById(id).className = 'strength-bar';
            });

            // Redirect after delay
            setTimeout(() => {
                window.location.href = 'Sip Trunk/sipTrunkSelection.html';
                console.log('Redirect to next step');
            }, 2000);

        } else {
            // ERROR - Handle validation errors from API
            if (data && data.errors && Array.isArray(data.errors)) {
                showResponse('error', data.message || 'Validation Error', 'Please fix the following issues:', data.errors);

                // Map API field names to form field IDs
                const fieldMap = {
                    'contact.fname': 'firstName',
                    'contact.lname': 'lastName',
                    'contact.emailAddress': 'email',
                    'contact.phone': 'phone',
                    'contact.phone.mobile': 'phone',
                    'contact.address1': 'address1',
                    'contact.city': 'city',
                    'contact.province': 'province',
                    'contact.country': 'country',
                    'contact.postalCode': 'postalCode',
                    'language': 'language',
                    'businessUnit': 'businessUnit'
                };

                // Highlight specific fields with errors
                data.errors.forEach(error => {
                    const fieldId = fieldMap[error.param];
                    if (fieldId) {
                        showFieldError(fieldId, error.message);
                    }
                });
            } else {
                showResponse('error', 'Error', data?.message || `Request failed with status ${response.status}`);
            }
        }

    } catch (error) {
        setLoading(false);
        console.error('API Error:', error);

        showResponse('error', 'Connection Error',
            'Unable to connect to the server. This could be due to:\n' +
            '• Network connectivity issues\n' +
            '• CORS blocking the request\n' +
            '• Server is temporarily unavailable\n\n' +
            'Please try again later or contact support at 1-833-IRISTEL.'
        );
    }
    */

    // Store all contact data in cookies for use across signup flow
    setCookie('iristel_user_email', document.getElementById('email').value.trim(), 7);
    setCookie('iristel_user_fname', document.getElementById('firstName').value.trim(), 7);
    setCookie('iristel_user_lname', document.getElementById('lastName').value.trim(), 7);
    setCookie('iristel_user_phone', document.getElementById('phone').value.trim(), 7);
    setCookie('iristel_user_address1', document.getElementById('address1').value.trim(), 7);
    setCookie('iristel_user_city', document.getElementById('city').value.trim(), 7);
    setCookie('iristel_user_province', document.getElementById('province').value, 7);
    setCookie('iristel_user_country', document.getElementById('country').value, 7);
    setCookie('iristel_user_postalCode', document.getElementById('postalCode').value.trim(), 7);
    setCookie('iristel_user_language', document.getElementById('language').value, 7);

    // Hardcoded account ID
    setCookie('iristel_account_id', '75738171', 7);

    console.log('All contact data stored in cookies (account ID: 75738171)');

    setLoading(false);
    showResponse('success', 'Account Created!', 'Your account has been created successfully. You will be redirected shortly.');

    // Redirect after delay
    setTimeout(() => {
        window.location.href = 'Sip Trunk/sipTrunkSelection.html';
        console.log('Redirect to next step');
    }, 2000);
}

// Allow form submission with Enter key
document.getElementById('signupForm').addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
        e.preventDefault();
        submitForm();
    }
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

// TEST MODE — Fetch account 75738171 from API and prefill form fields
async function prefillTestData() {
    try {
        console.log('Fetching account 75738171 to prefill form...');
        const response = await fetch(`${API_BASE_URL}/accounts/75738171`, {
            method: 'GET',
            headers: {
                'accept': 'application/json',
                'iristelx-api-key': API_KEY
            }
        });

        const data = await response.json();
        console.log('GET Account Response:', JSON.stringify(data, null, 2));

        if (!response.ok) {
            throw new Error(data.message || `HTTP ${response.status}`);
        }

        const contact = data.contact || data;
        const phone = contact.phone || {};

        const fieldMap = {
            firstName:  contact.fname || '',
            lastName:   contact.lname || '',
            email:      contact.emailAddress || contact.email || '',
            phone:      phone.mobile || phone.home || phone.work || '',
            address1:   contact.address1 || '',
            city:       contact.city || '',
            province:   contact.province || '',
            postalCode: contact.postalCode || '',
            country:    contact.country || '',
            language:   data.language || 'EN'
        };

        for (const [fieldId, value] of Object.entries(fieldMap)) {
            const el = document.getElementById(fieldId);
            if (el && value) el.value = value;
        }

        console.log('Form prefilled from account 75738171');
    } catch (error) {
        console.error('Failed to prefill from API, using fallback:', error);
        // Fallback if API fails
        document.getElementById('firstName').value = 'Test';
        document.getElementById('lastName').value = 'User';
        document.getElementById('email').value = 'test@example.com';
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

    // Check if user email exists from previous session
    const savedEmail = getCookie('iristel_user_email');
    if (savedEmail) {
        console.log('Found saved email:', savedEmail);
    }
});
