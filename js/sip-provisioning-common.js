// ============================================
// Shared provisioning helpers — loaded by sipReview.html AND
// provisioningStatus.html. The status page owns the waiting (DID order,
// UBoss job, PON status), so everything both pages need lives here.
// ============================================

// ============================================
// UbossRobot API Configuration
// ============================================
const UBOSS_API_URL = 'https://api.iristelx.com/uboss-robot';
const UBOSS_API_KEY = 'b1582d78d369685683e090ad37489937';

// ============================================
// TEMPORARY — TESTING ONLY. REVERT BEFORE LAUNCH.
// ============================================
// The correct value is 'Iristel'. UbossRobot looks the reseller up with
// GetByRole(Link, Name=resellerName) using non-exact matching, so 'Iristel'
// matches 6 links (IRISTEL, IRISTEL Home Phone, Iristel Kenya/Moldova/
// Norway/Romania) and the job dies on a Playwright strict-mode violation.
// Because 'IRISTEL' is a prefix of the other five, NO value can disambiguate
// by substring — the robot needs Exact=true or a reseller id. All 5 jobs
// ever sent with 'Iristel' failed this way; 0 of 34 'Demo Reseller' jobs did.
//
// 'Demo Reseller' is a sandbox reseller: it gets past the lookup so the rest
// of the provisioning chain can be exercised, but it attaches the enterprise,
// trunk and billing to the wrong parent. It CANNOT validate that a DID on
// Profile 718524 routes to a customer's Broadsoft platform.
//
// Restore RESELLER_PRODUCTION below once UbossRobot fixes the lookup.
const RESELLER_PRODUCTION = 'Iristel';
const UBOSS_RESELLER_NAME = 'Demo Reseller';

// Ported orders are flagged to the provisioning team by suffixing the business name
// (isPortingOrder() lives in common.js so every page agrees on what a port is)
const PORTING_SUFFIX = ' - PI';

// Vanity letter-to-digit mapping (standard phone keypad)
const VANITY_MAP = {
    'A': '2', 'B': '2', 'C': '2',
    'D': '3', 'E': '3', 'F': '3',
    'G': '4', 'H': '4', 'I': '4',
    'J': '5', 'K': '5', 'L': '5',
    'M': '6', 'N': '6', 'O': '6',
    'P': '7', 'Q': '7', 'R': '7', 'S': '7',
    'T': '8', 'U': '8', 'V': '8',
    'W': '9', 'X': '9', 'Y': '9', 'Z': '9'
};

function formatToE164(number) {
    // Convert vanity letters to digits first, then strip non-digits
    let converted = number.toUpperCase().split('').map(ch => VANITY_MAP[ch] || ch).join('');
    let digits = converted.replace(/\D/g, '');
    // If it starts with 1 and has 11 digits, it's already correct
    if (digits.length === 11 && digits.startsWith('1')) {
        return '+' + digits;
    }
    // If 10 digits, prepend +1
    if (digits.length === 10) {
        return '+1' + digits;
    }
    // Fallback: return with + prefix
    return '+' + digits;
}

// UbossRobot expects the number as +1-XXXXXXXXXX (country code, dash, subscriber digits)
function formatUbossPhone(number) {
    const e164 = formatToE164(number || '');
    const digits = e164.replace(/\D/g, '');
    if (digits.length === 11) {
        return `+${digits.charAt(0)}-${digits.slice(1)}`;
    }
    return e164;
}

// MIND wraps the real reason in errors[] and puts a generic sentence in
// message — the detail is what tells you which field to fix.
function describeApiError(data, fallback) {
    if (!data) return fallback;
    const details = Array.isArray(data.errors)
        ? data.errors.map(e => e && e.message).filter(Boolean)
        : [];
    if (!details.length) return data.message || fallback;
    if (!data.message) return details.join(' ');
    return data.message + ' — ' + details.join(' ');
}

// Porting orders go to UbossRobot as "<Business Name> - PI"
function getProvisioningBusinessName() {
    const name = (getCookie('sip_businessName') || '').trim();
    if (!isPortingOrder() || !name || name.endsWith(PORTING_SUFFIX)) {
        return name;
    }
    return name + PORTING_SUFFIX;
}

// Contact data as both pages need it — SIP cookies first, signup fallback
function getProvisioningContactData() {
    return {
        fname: getCookie('sip_billingFirstName') || getCookie('iristel_user_fname') || '',
        lname: getCookie('sip_billingLastName') || getCookie('iristel_user_lname') || '',
        emailAddress: getCookie('sip_billingEmail') || getCookie('iristel_user_email') || '',
        phone: getCookie('sip_billingPhone') || getCookie('iristel_user_phone') || '',
        address1: getCookie('sip_address1') || getCookie('iristel_user_address1') || '',
        city: getCookie('sip_city') || getCookie('iristel_user_city') || '',
        province: getCookie('sip_province') || getCookie('iristel_user_province') || '',
        country: getCookie('sip_country') || getCookie('iristel_user_country') || '',
        postalCode: (getCookie('sip_postalCode') || getCookie('iristel_user_postalCode') || '').replace(/\s/g, '')
    };
}

async function startUbossProvisioning(contactData, phoneNumbers, accountId, channelCount) {
    // Field order/names must match the UbossRobot trunk-provisioning contract.
    // phoneNumbers: the first entry is the trunk number; any further entries
    // are provisioned as channel numbers on the same trunk (bulk).
    const requestBody = {
        phoneNumbers: phoneNumbers.map(formatUbossPhone),
        resellerName: UBOSS_RESELLER_NAME,
        address: contactData.address1,
        city: contactData.city,
        postcode: contactData.postalCode,
        notificationEmail: getCookie('sip_techEmail') || contactData.emailAddress,
        invoiceEmail: contactData.emailAddress,
        accountRef: accountId,
        businessName: getProvisioningBusinessName(),
        channelCount: channelCount
    };

    console.log('[UBoss] Start Provisioning — POST', `${UBOSS_API_URL}/trunk-provisioning`);
    console.log('Request Body:', JSON.stringify(requestBody, null, 2));

    const response = await fetch(`${UBOSS_API_URL}/trunk-provisioning`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': UBOSS_API_KEY
        },
        body: JSON.stringify(requestBody)
    });

    const data = await response.json().catch(() => null);
    console.log('UbossRobot Start Response:', data);

    if (!response.ok) {
        throw new Error(describeApiError(data,
            `UbossRobot provisioning failed to start (HTTP ${response.status})`));
    }

    return data;
}

// Start one UBoss job per trunk. Returns [{trunkName, jobId}]; throws with a
// reconciliation message when a later trunk fails after earlier ones started.
async function startAllUbossProvisioning(contactData, trunksList, accountId, onProgress) {
    const provisionJobs = [];
    for (let i = 0; i < trunksList.length; i++) {
        const trunk = trunksList[i];
        const primary = trunk.primaryNumber || '';
        const trunkNumbers = (trunk.numbers || []).filter(n => n && n !== primary);
        if (primary) trunkNumbers.unshift(primary);
        if (trunkNumbers.length === 0) continue;

        if (onProgress) onProgress(trunk.name || ('Trunk ' + (i + 1)), i + 1, trunksList.length);
        try {
            const ubossResult = await startUbossProvisioning(contactData, trunkNumbers, accountId, trunk.channels || 1);
            console.log('UbossRobot job started for', trunk.name, ':', ubossResult.id);
            provisionJobs.push({ trunkName: trunk.name || ('Trunk ' + (i + 1)), jobId: ubossResult.id });
        } catch (err) {
            // Report which trunks already went through so support can reconcile
            const started = provisionJobs.map(j => j.trunkName + ' (job ' + j.jobId + ')').join(', ');
            throw new Error('Provisioning failed for "' + (trunk.name || ('Trunk ' + (i + 1))) + '": ' + err.message
                + (started ? '\n\nAlready started: ' + started : ''));
        }
    }
    return provisionJobs;
}

// Distribute an espresso DID order's numbers across the trunks in request
// order. Mutates trunksList and persists the cookies the rest of the flow reads.
function distributeOrderedNumbers(trunksList, numbers) {
    let cursor = 0;
    trunksList.forEach(trunk => {
        if (trunk.numbers && trunk.numbers.length) return;
        const wanted = (trunk.requests || []).reduce((s, r) => s + (parseInt(r.quantity, 10) || 0), 0) || 1;
        trunk.numbers = numbers.slice(cursor, cursor + wanted);
        trunk.primaryNumber = trunk.numbers[0] || '';
        cursor += wanted;
    });
    setCookie('sip_trunks', JSON.stringify(trunksList));
    if (trunksList[0] && trunksList[0].primaryNumber) {
        setCookie('sip_primaryNumber', trunksList[0].primaryNumber);
    }
}

function loadTrunksFromCookie() {
    let trunksList = [];
    const trunksData = getCookie('sip_trunks');
    if (trunksData) {
        try {
            const parsed = JSON.parse(trunksData);
            if (Array.isArray(parsed)) trunksList = parsed;
        } catch (e) {}
    }
    return trunksList;
}

function trunksNeedNumbers(trunksList) {
    return trunksList.some(t => (!t.numbers || !t.numbers.length) && (t.requests || []).length);
}
