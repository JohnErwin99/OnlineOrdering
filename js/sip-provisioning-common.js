// ============================================
// Shared provisioning helpers — loaded by sipReview.html AND
// provisioningStatus.html. The status page owns the waiting (DID order,
// UBoss job, PON status), so everything both pages need lives here.
// ============================================

// ============================================
// Pricing — single source of truth for the whole ordering flow.
// Channels and DIDs are both billed — no DID comes with the trunk:
//   channels * CHANNEL_MONTHLY + dids * DID_MONTHLY.
// server.js bills MIND the same way (EXLNP_SBDID = every DID).
// ============================================
const SIP_PRICING = {
    CHANNEL_MONTHLY: 25.00,
    DID_MONTHLY: 2.00,       // per DID
    TAX_RATE: 0.13
};
window.SIP_PRICING = SIP_PRICING;

// One trunk's monthly cost, before tax. DIDs are the requested quantity,
// else the numbers already on the trunk. The review page prices with this,
// UBoss gets it as monthlyRecurringPrice, and the server applies the same
// rule to MIND's channel/DID quantities.
function getTrunkBilling(trunk) {
    const channels = Math.max(1, parseInt(trunk.channels, 10) || 1);
    const dids = (trunk.requests || []).reduce((s, r) => s + (parseInt(r.quantity, 10) || 0), 0)
        || (trunk.numbers || []).length || 0;
    const monthly = channels * SIP_PRICING.CHANNEL_MONTHLY + dids * SIP_PRICING.DID_MONTHLY;
    return { channels, dids, monthly: Math.round(monthly * 100) / 100 };
}

// ============================================
// UbossRobot API Configuration
// ============================================
const UBOSS_API_URL = 'https://api.iristelx.com/uboss-robot';
const UBOSS_API_KEY = 'b1582d78d369685683e090ad37489937';

// The reseller is decided by the SERVER (Demo Reseller in test, IRISTEL in
// production) — the browser doesn't send one. Keeping it server-side means a
// cached page can never file a job under the wrong reseller.

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

// UbossRobot gets the number WITHOUT the +1 — bare 10 subscriber digits
// (5818802894), whatever shape espresso returned it in (+15818802894,
// 15818802894, +1-581..., 581-880-2894).
function formatUbossPhone(number) {
    let digits = String(number || '').replace(/\D/g, '');
    if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
    return digits;
}

// UbossRobot gets the postal code capitalized with the space: "H3X 2S9".
function formatUbossPostcode(postalCode) {
    const compact = String(postalCode || '').toUpperCase().replace(/\s+/g, '');
    return compact.length === 6 ? compact.slice(0, 3) + ' ' + compact.slice(3) : compact;
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

// The business name as entered on the order — mandatory. (The old " - PI"
// porting suffix is gone; ports are no longer flagged through the name.)
function getProvisioningBusinessName() {
    // Strip the legacy suffix in case an in-flight order's cookie still has it
    return (getCookie('sip_businessName') || '').trim().replace(/ - PI$/, '');
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

// Started through our server, which refuses to spawn a second job for the same
// customer + numbers. That matters more here than anywhere else: UbossRobot
// does not resume — a retry restarts from step one, and once an earlier run
// added the number to the pool, every later attempt fails forever with
// "Number(s) already exist in the number pool". So an accidental repeat
// (refresh, new device, re-submit) must reuse the existing job. Only a
// deliberate "Try Again" passes force, and only that may start a new one.
async function startUbossProvisioning(contactData, phoneNumbers, accountId, channelCount, options) {
    const opts = options || {};
    const requestBody = {
        email: (contactData && contactData.emailAddress)
            || getCookie('sip_billingEmail') || getCookie('iristel_user_email') || '',
        phoneNumbers: phoneNumbers.map(formatUbossPhone),
        address: contactData.address1,
        city: contactData.city,
        postcode: formatUbossPostcode(contactData.postalCode),
        notificationEmail: getCookie('sip_techEmail') || contactData.emailAddress,
        // Invoices always go to Iristel provisioning, never the customer
        invoiceEmail: 'provisioning@iristel.com',
        accountRef: accountId,
        businessName: getProvisioningBusinessName(),
        channelCount: channelCount,
        // UbossRobot emails the welcome letter to notificationEmail as soon as
        // the job completes — no separate POST /email/{jobId} call is needed.
        sendWelcomeLetterToNotificationEmail: true,
        // Shown on the my.iristel dashboard
        location: (getCookie('sip_siteName') || '').trim(),
        serviceReference: getCookie('sip_serviceId') || '',
        planName: getCookie('iristel_selected_plan_name') || getCookie('iristel_selected_plan') || 'SIP Trunk',
        monthlyRecurringPrice: opts.monthlyRecurringPrice,
        force: !!opts.force
    };

    console.log('[UBoss] Start Provisioning — POST /api/provision', opts.force ? '(forced retry)' : '');

    const response = await fetch('/api/provision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
    });

    const data = await response.json().catch(() => null);
    console.log('Provisioning Response:', data);

    if (!response.ok || !data || !data.jobId) {
        const err = new Error((data && data.error)
            || `UbossRobot provisioning failed to start (HTTP ${response.status})`);
        err.httpStatus = response.status;
        throw err;
    }
    if (data.reused) console.log('Existing provisioning job reused — no duplicate started');

    // Callers expect the UbossRobot shape
    return { id: data.jobId, reused: data.reused, sipAuthenticationPassword: data.sipAuthenticationPassword };
}

// Start one UBoss job per trunk. Returns [{trunkName, jobId}]; throws with a
// reconciliation message when a later trunk fails after earlier ones started.
async function startAllUbossProvisioning(contactData, trunksList, accountId, onProgress, options) {
    const provisionJobs = [];
    for (let i = 0; i < trunksList.length; i++) {
        const trunk = trunksList[i];
        const primary = trunk.primaryNumber || '';
        const trunkNumbers = (trunk.numbers || []).filter(n => n && n !== primary);
        if (primary) trunkNumbers.unshift(primary);
        if (trunkNumbers.length === 0) continue;

        if (onProgress) onProgress(trunk.name || ('Trunk ' + (i + 1)), i + 1, trunksList.length);
        try {
            // Channel count = the user-chosen capacity, independent of how
            // many numbers ride on the trunk.
            const billing = getTrunkBilling(trunk);
            const ubossResult = await startUbossProvisioning(contactData, trunkNumbers, accountId,
                billing.channels, Object.assign({}, options, { monthlyRecurringPrice: billing.monthly }));
            console.log('UbossRobot job started for', trunk.name, ':', ubossResult.id);
            provisionJobs.push({ trunkName: trunk.name || ('Trunk ' + (i + 1)), jobId: ubossResult.id });
        } catch (err) {
            // Report which trunks already went through so support can reconcile
            const started = provisionJobs.map(j => j.trunkName + ' (job ' + j.jobId + ')').join(', ');
            const failure = new Error('Provisioning failed for "' + (trunk.name || ('Trunk ' + (i + 1))) + '": ' + err.message
                + (started ? '\n\nAlready started: ' + started : ''));
            failure.snagStage = 'uboss-start';
            // The server reports its own 5xx answers; only a partial start
            // (which trunks went through) adds anything for ops
            failure.snagReported = err.httpStatus >= 500 && !provisionJobs.length;
            throw failure;
        }
    }
    return provisionJobs;
}

// How many numbers a trunk asked for (a trunk with no requests holds one)
function trunkWantedCount(trunk) {
    return (trunk.requests || []).reduce((s, r) => s + (parseInt(r.quantity, 10) || 0), 0) || 1;
}

// Last 10 digits — trunks and espresso don't agree on the +1
function tenDigits(n) {
    return String(n || '').replace(/\D/g, '').slice(-10);
}

// Distribute numbers across the trunks in request order, topping each trunk
// up to its requested count. placeOrderedNumbers uses it for whatever it
// can't match to a request; it is also the whole placement for numbers that
// come with no request mapping (a resumed order's provisioned numbers).
// Numbers already on a trunk are skipped. Mutates trunksList and persists
// the cookies the rest of the flow reads.
function distributeOrderedNumbers(trunksList, numbers) {
    const placed = new Set(trunksList.flatMap(t => (t.numbers || []).map(tenDigits)));
    const fresh = numbers.filter(n => !placed.has(tenDigits(n)));
    let cursor = 0;
    trunksList.forEach(trunk => {
        const have = trunk.numbers || [];
        const short = trunkWantedCount(trunk) - have.length;
        if (short <= 0) return;
        trunk.numbers = have.concat(fresh.slice(cursor, cursor + short));
        if (!trunk.primaryNumber) trunk.primaryNumber = trunk.numbers[0] || '';
        cursor += short;
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

// Any trunk with requests still holding fewer numbers than it asked for —
// numbers stay off the trunks until the DID order delivers them
function trunksShortOfNumbers(trunksList) {
    return trunksList.some(t => (t.requests || []).length && (t.numbers || []).length < trunkWantedCount(t));
}

// ============================================
// Picked numbers. The customer picks specific DIDs; they live ONLY in
// trunk.requests[].dids until the order delivers them. A request is in
// picked mode when it has a dids array, and complete when it holds as many
// numbers as its quantity. A request without dids is picked by the server.
// ============================================
function requestPickComplete(r) {
    const quantity = parseInt(r && r.quantity, 10) || 0;
    return !!r && Array.isArray(r.dids) && quantity > 0 && r.dids.length === quantity;
}

// Every request in order — trunks in order, then each trunk's requests. A
// request's position here is the index the server reports back (byRequest,
// problems, NO_MIND_CITY), so sending and mapping back both walk this one
// list.
function orderRequestSlots(trunksList) {
    const slots = [];
    (trunksList || []).forEach((trunk, t) => {
        (trunk.requests || []).forEach((r, i) => slots.push({ trunk: t, request: i, source: r }));
    });
    return slots;
}

// Picked requests still short of their quantity — numbers came off them
// (gone, picked twice) and the customer hasn't picked the rest. They can't
// be ordered: the customer must finish picking first. Same rule as the
// picker's isRequestIncomplete. [{index, trunk, trunkName, ratecenter, npa,
// quantity, picked}], index = position in orderRequestSlots.
function findIncompletePicks(trunksList) {
    return orderRequestSlots(trunksList).map((s, index) => ({ s, index })).filter(({ s }) =>
        Array.isArray(s.source.dids) && s.source.dids.length < (parseInt(s.source.quantity, 10) || 0)
    ).map(({ s, index }) => ({
        index, trunk: s.trunk, trunkName: (trunksList[s.trunk] && trunksList[s.trunk].name) || ('Trunk ' + (s.trunk + 1)),
        ratecenter: s.source.ratecenter, npa: s.source.npa,
        quantity: parseInt(s.source.quantity, 10) || 0, picked: s.source.dids.length
    }));
}

// The requests for /api/did/check-picks and /api/did/order. A picked
// request always goes with its picks; only a request without a dids array
// (porting temp numbers, a page from before the picker) goes as a bare
// quantity for the server to pick. A picked request is never downgraded to
// a quantity — the server would pick random numbers and drop the
// customer's own — so an incomplete one throws (err.incompletePicks):
// callers check findIncompletePicks first and send the customer back.
function flattenOrderRequests(trunksList) {
    const incomplete = findIncompletePicks(trunksList);
    if (incomplete.length) {
        const err = new Error('Some numbers are still to be picked: ' + incomplete.map(x =>
            x.ratecenter + ' (' + x.npa + ') ' + x.picked + ' of ' + x.quantity).join(', '));
        err.incompletePicks = incomplete;
        throw err;
    }
    return orderRequestSlots(trunksList).map(({ trunk, source: r }) => {
        const out = { ratecenter: r.ratecenter, npa: r.npa, quantity: parseInt(r.quantity, 10) || 0, trunk: trunk };
        if (Array.isArray(r.dids)) out.dids = r.dids.map(tenDigits);
        return out;
    });
}

// A trunk's main number: its first pick, in requests order then dids order
function trunkFirstPick(trunk) {
    for (const r of (trunk && trunk.requests) || []) {
        if (Array.isArray(r.dids) && r.dids.length) return tenDigits(r.dids[0]);
    }
    return '';
}

// Put an order's delivered numbers on the trunks. A picked number goes to
// the trunk whose request picked it; a server-picked one to the trunk of
// the request espresso filed it under (details.byRequest index = position
// in flattenOrderRequests). Anything left tops up a short trunk. Numbers
// land in pick order; a trunk's main number is its first pick when that
// arrived, else its first number. Persists like distributeOrderedNumbers.
function placeOrderedNumbers(trunksList, details) {
    const d = details || {};
    const groups = (d.byRequest || []).filter(g => g && Array.isArray(g.dids));
    const delivered = [...new Set((d.numbers || []).concat(groups.flatMap(g => g.dids))
        .map(tenDigits).filter(n => n.length === 10))];
    const isDelivered = new Set(delivered);
    const slots = orderRequestSlots(trunksList);

    // An exact pick wins over the request espresso filed the number under
    const pickedBy = new Map();
    slots.forEach((s, i) => (Array.isArray(s.source.dids) ? s.source.dids : []).forEach(n => {
        if (!pickedBy.has(tenDigits(n))) pickedBy.set(tenDigits(n), i);
    }));
    const filedUnder = new Map();
    groups.forEach(g => {
        if (g.index == null) return;
        const list = filedUnder.get(Number(g.index)) || [];
        filedUnder.set(Number(g.index), list.concat(g.dids.map(tenDigits)));
    });

    const placed = new Set(trunksList.flatMap(t => (t.numbers || []).map(tenDigits)));
    slots.forEach((s, i) => {
        const own = (Array.isArray(s.source.dids) ? s.source.dids.map(tenDigits) : [])
            .filter(n => pickedBy.get(n) === i)
            .concat((filedUnder.get(i) || []).filter(n => !pickedBy.has(n)));
        const trunk = trunksList[s.trunk];
        own.forEach(n => {
            if (!isDelivered.has(n) || placed.has(n)) return;
            trunk.numbers = (trunk.numbers || []).concat(n);
            placed.add(n);
        });
    });

    // The main number is the trunk's first pick when it was delivered. A
    // pick that never arrived — or a main number that isn't on the trunk —
    // gives way to the trunk's first delivered number. A trunk with no
    // picks keeps a main number it already holds.
    trunksList.forEach(t => {
        const nums = t.numbers || [];
        if (!nums.length) return;
        const on = n => nums.find(x => tenDigits(x) === tenDigits(n));
        const firstPick = trunkFirstPick(t);
        if (firstPick && on(firstPick)) t.primaryNumber = on(firstPick);
        else if (firstPick || !t.primaryNumber || !on(t.primaryNumber)) t.primaryNumber = nums[0];
    });
    distributeOrderedNumbers(trunksList, delivered.filter(n => !placed.has(n)));
}

// Take picked numbers that are no longer available off the requests that
// picked them — only the request at flattened position `index` when one is
// given. The quantity stays, so the request is left incomplete and the
// picker makes the customer choose the rest. A trunk whose main number went
// falls back to its first remaining pick. Returns what came off, per
// request: [{ratecenter, npa, numbers}]. Persists sip_trunks.
function removePicksFromTrunks(trunksList, numbers, index) {
    const drop = new Set((numbers || []).map(tenDigits));
    const removed = [];
    orderRequestSlots(trunksList).forEach((s, i) => {
        if (index != null && i !== index) return;
        const r = s.source;
        if (!Array.isArray(r.dids)) return;
        const gone = [...new Set(r.dids.map(tenDigits).filter(n => drop.has(n)))];
        if (!gone.length) return;
        r.dids = r.dids.filter(n => !drop.has(tenDigits(n)));
        removed.push({ ratecenter: r.ratecenter, npa: r.npa, numbers: gone });
    });
    const off = new Set(removed.flatMap(x => x.numbers));
    trunksList.forEach(t => {
        if (t.primaryNumber && off.has(tenDigits(t.primaryNumber))) t.primaryNumber = trunkFirstPick(t);
    });
    setCookie('sip_trunks', JSON.stringify(trunksList));
    if (off.has(tenDigits(getCookie('sip_primaryNumber')))) {
        const main = trunksList[0] && (trunksList[0].primaryNumber || trunkFirstPick(trunksList[0]));
        if (main) setCookie('sip_primaryNumber', main);
        else deleteCookie('sip_primaryNumber');
    }
    return removed;
}
