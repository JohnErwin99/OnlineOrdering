// ============================================
// OnlineOrdering server
// ============================================
// Serves the static ordering pages AND proxies the Iristel espresso SOAP
// APIs as JSON: DID Ordering v3 under /api/did/*, LNP (number porting) v4
// under /api/lnp/*.
//
// The browser cannot talk to espresso directly: the endpoint sends no CORS
// headers, speaks rpc/encoded SOAP, and the credentials must not ship in
// client JS. This proxy is the one place that knows all three.
//
// Run:  ESPRESSO_USER=... ESPRESSO_PASS=... node server.js
// Env:  ESPRESSO_MODE=test|production  (default test)
//       PORT                           (default 3000)
//
// No npm dependencies — `npm start` works with no install step.

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ESPRESSO_MODE = process.env.ESPRESSO_MODE === 'production' ? 'production' : 'test';
const ESPRESSO_URL = `https://connect.espressodid.com/cloud/public/v3/${ESPRESSO_MODE}`;
// rpc/encoded: the body namespace is the WSDL targetNamespace, which embeds the mode URL
const ESPRESSO_NS = `urn:${ESPRESSO_URL}`;
const ESPRESSO_USER = process.env.ESPRESSO_USER || '';
const ESPRESSO_PASS = process.env.ESPRESSO_PASS || '';

// The routing profile decides where an ordered DID actually routes. Getting it
// wrong fails silently — the number provisions fine but calls never land — so
// it is pinned here rather than inferred from whatever the account lists first.
// Note the environments differ: production carries "Profile 718524 DID E164",
// the test environment only has "Test Profile".
const ESPRESSO_DID_PROFILE = process.env.ESPRESSO_DID_PROFILE || '';
const ESPRESSO_LNP_PROFILE = process.env.ESPRESSO_LNP_PROFILE || '';

// LNP (Local Number Portability) lives on the v4 endpoint — same host and
// credentials, different WSDL/namespace than the v3 DID ordering API.
const ESPRESSO_LNP_URL = `https://connect.espressodid.com/cloud/public/v4/${ESPRESSO_MODE}`;
const ESPRESSO_LNP_NS = `urn:${ESPRESSO_LNP_URL}`;

const ROOT = __dirname;

// ============================================
// ORDER STORE — idempotency + support visibility
// ============================================
// Browser state can always be lost: the tab closes, storage is cleared, the
// customer switches device, or Submit is double-clicked. Any of those would
// otherwise place a SECOND billable DID order or a second card charge. The
// browser cannot be the thing that guarantees "only once", so the guarantee
// lives here, in front of the calls that spend money.
//
// Records are also the only trace of an order outside the customer's tab —
// without them, "I paid and got nothing" is unanswerable by support.
//
// Persisted to disk so a restart doesn't reopen the double-charge window.
// Render's disk is ephemeral, so this survives restarts but not redeploys;
// placeOrder additionally asks espresso for recent matching orders as a
// backstop. A real datastore is the pre-launch answer — tracked separately.
const ORDER_STORE_PATH = process.env.ORDER_STORE_PATH || path.join(ROOT, '.order-store.json');
const ORDER_TTL_MS = 7 * 24 * 60 * 60 * 1000;

let orderStore = {};
try {
    orderStore = JSON.parse(fs.readFileSync(ORDER_STORE_PATH, 'utf8'));
} catch (e) {
    orderStore = {};
}

// A store that cannot be written is a silently reopened double-charge window,
// so the directory is created up front and failures are shouted about.
function ensureStoreDir(p) {
    try {
        fs.mkdirSync(path.dirname(p), { recursive: true });
        return true;
    } catch (e) {
        console.error('[store] cannot create directory for', p, '-', e.message);
        return false;
    }
}

function saveOrderStore() {
    try {
        ensureStoreDir(ORDER_STORE_PATH);
        fs.writeFileSync(ORDER_STORE_PATH, JSON.stringify(orderStore), 'utf8');
    } catch (e) {
        console.error('[store] ORDER RECORD NOT PERSISTED —', e.message,
            '\n  Duplicate protection is degraded until this is fixed.',
            '\n  On Render, add a disk and set ORDER_STORE_PATH inside its mount path.');
    }
}

function pruneOrderStore() {
    const cutoff = Date.now() - ORDER_TTL_MS;
    let dropped = 0;
    for (const [k, v] of Object.entries(orderStore)) {
        if (!v || !v.createdAt || v.createdAt < cutoff) { delete orderStore[k]; dropped++; }
    }
    if (dropped) saveOrderStore();
}
pruneOrderStore();

// Everything is keyed on the customer's EMAIL, because it is the only thing
// that survives a new device, a cleared browser or an incognito window. An
// account id does not: signing up again mints a new one, which would make a
// repeat look like a different customer and get them billed twice.
function normEmail(email) {
    return String(email || '').trim().toLowerCase();
}

function stateGet(key) {
    return orderStore[key] || null;
}

function stateSet(key, record) {
    orderStore[key] = { ...record, createdAt: (orderStore[key] && orderStore[key].createdAt) || Date.now(), updatedAt: Date.now() };
    saveOrderStore();
    return orderStore[key];
}

function requestShape(requests) {
    return (requests || [])
        .map(r => `${String(r.ratecenter).toUpperCase()}|${r.npa}|${parseInt(r.quantity, 10) || 1}`)
        .sort().join(';');
}

// One namespace per step, so each is guarded independently
const K = {
    account:   email => `account:${normEmail(email)}`,
    order:     (email, requests) => `order:${normEmail(email)}::${requestShape(requests)}`,
    pon:       email => `pon:${normEmail(email)}`,
    provision: (email, numbers) => `provision:${normEmail(email)}::${(numbers || []).slice().sort().join(',')}`
};

// ============================================
// SOAP client (rpc/encoded, Credentials header)
// ============================================
function xmlEscape(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function soapEnvelope(bodyXml, ns = ESPRESSO_NS) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:ns1="${ns}"
  xmlns:xsd="http://www.w3.org/2001/XMLSchema"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:SOAP-ENC="http://schemas.xmlsoap.org/soap/encoding/"
  SOAP-ENV:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
<SOAP-ENV:Header>
<Credentials><username>${xmlEscape(ESPRESSO_USER)}</username><password>${xmlEscape(ESPRESSO_PASS)}</password></Credentials>
</SOAP-ENV:Header>
<SOAP-ENV:Body>
${bodyXml}
</SOAP-ENV:Body>
</SOAP-ENV:Envelope>`;
}

function soapPost(bodyXml, url = ESPRESSO_URL, ns = ESPRESSO_NS) {
    return new Promise((resolve, reject) => {
        const payload = soapEnvelope(bodyXml, ns);
        const req = https.request(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'text/xml; charset=utf-8',
                'SOAPAction': '""',
                'Content-Length': Buffer.byteLength(payload)
            },
            timeout: 30000
        }, res => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => resolve(data));
        });
        req.on('timeout', () => { req.destroy(new Error('espresso API timeout')); });
        req.on('error', reject);
        req.end(payload);
    });
}

// ============================================
// Minimal XML → JS parser
// ============================================
// Good enough for espresso's rpc/encoded responses: elements, text, xsi:nil.
// Attributes are dropped; repeated child names (the <item> siblings SOAP
// arrays use) become arrays.
function parseXml(xml) {
    // Strip declaration and comments
    xml = xml.replace(/<\?xml[^?]*\?>/g, '').replace(/<!--[\s\S]*?-->/g, '');
    let pos = 0;

    function parseElement() {
        const open = xml.indexOf('<', pos);
        if (open === -1) return null;
        const close = xml.indexOf('>', open);
        let tag = xml.slice(open + 1, close);
        const selfClosing = tag.endsWith('/');
        if (selfClosing) tag = tag.slice(0, -1);
        const isNil = /xsi:nil="true"/.test(tag);
        const name = tag.split(/\s/)[0].replace(/^.*:/, '');
        pos = close + 1;

        if (selfClosing) return { name, value: isNil ? null : '' };

        const children = [];
        let text = '';
        for (;;) {
            const next = xml.indexOf('<', pos);
            if (next === -1) break;
            text += xml.slice(pos, next);
            if (xml[next + 1] === '/') {
                pos = xml.indexOf('>', next) + 1;
                break;
            }
            pos = next;
            const child = parseElement();
            if (child) children.push(child);
        }

        if (!children.length) {
            const decoded = text.trim()
                .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
            return { name, value: isNil ? null : decoded };
        }
        // Fold children into an object; repeated names become arrays
        const obj = {};
        for (const c of children) {
            const v = 'value' in c ? c.value : c.obj;
            if (c.name in obj) {
                if (!Array.isArray(obj[c.name])) obj[c.name] = [obj[c.name]];
                obj[c.name].push(v);
            } else {
                obj[c.name] = v;
            }
        }
        return { name, obj };
    }

    const root = parseElement();
    return root ? ('value' in root ? root.value : root.obj) : null;
}

// SOAP arrays parse as { item: x } or { item: [x, y] } — normalize to a JS array
function soapArray(node) {
    if (node == null || node === '') return [];
    if (node.item === undefined) return Array.isArray(node) ? node : [node];
    return Array.isArray(node.item) ? node.item : [node.item];
}

// ============================================
// espresso call wrapper
// ============================================
async function espressoCall(methodBodyXml, methodName, api = 'did') {
    if (!ESPRESSO_USER || !ESPRESSO_PASS) {
        const err = new Error('espresso credentials not configured (set ESPRESSO_USER / ESPRESSO_PASS)');
        err.status = 503;
        throw err;
    }
    const raw = api === 'lnp'
        ? await soapPost(methodBodyXml, ESPRESSO_LNP_URL, ESPRESSO_LNP_NS)
        : await soapPost(methodBodyXml);
    const doc = parseXml(raw);
    const body = doc && (doc.Body || doc.body);
    if (!body) throw new Error('Unparseable espresso response');

    if (body.Fault) {
        const err = new Error((body.Fault.faultstring || 'espresso fault').trim());
        err.status = 502;
        throw err;
    }
    const resp = body[methodName + 'Response'];
    if (!resp) throw new Error(`No ${methodName}Response in espresso reply`);

    // Every method returns (return, errors)
    const errors = soapArray(resp.errors);
    if (errors.length) {
        const err = new Error(errors.map(e => `${e.code}: ${e.message}`).join('; '));
        err.status = 502;
        throw err;
    }
    return resp.return;
}

// ============================================
// DID API operations
// ============================================
function getCatalog() {
    return espressoCall('<ns1:didGetProductCatalog/>', 'didGetProductCatalog')
        .then(r => soapArray(r).map(x => ({ ratecenter: x.ratecenter, npa: x.npa })));
}

function getProfiles() {
    return espressoCall('<ns1:didGetRoutingProfiles/>', 'didGetRoutingProfiles')
        .then(r => soapArray(r).map(x => (typeof x === 'string' ? x : x.profile || JSON.stringify(x))));
}

// requests: [{ratecenter, npa, quantity}] — prefix/country_prefix are deprecated
// but required by the schema; the manual says their values are ignored.
// Duplicate detection against espresso is ADVISORY ONLY, never blocking.
//
// didGetOrders returns every order on the espresso *company* account, not the
// orders of one customer — there is no per-customer filter. "TORONTO 647 x1"
// is the most ordinary request imaginable, so two unrelated customers ordering
// it the same day look identical here. Blocking on that would refuse a
// legitimate order, which is worse than the duplicate it would prevent.
//
// So this only logs a warning for support to notice. The real guarantee is the
// persisted order store plus the client's idempotency key. To close the
// redeploy gap properly, point ORDER_STORE_PATH at a Render persistent disk.
const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;

function sameRequestShape(a, b) {
    const norm = list => (list || [])
        .map(r => `${String(r.ratecenter).toUpperCase()}|${r.npa}|${parseInt(r.quantity, 10) || 1}`)
        .sort().join(';');
    return norm(a) === norm(b);
}

async function findRecentMatchingOrder(requests) {
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const fmt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} `
        + `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    const from = new Date(now.getTime() - DUPLICATE_WINDOW_MS);

    const body = `<ns1:didGetOrders>`
        + `<startDate xsi:type="xsd:string">${fmt(from)}</startDate>`
        + `<endDate xsi:type="xsd:string">${fmt(now)}</endDate></ns1:didGetOrders>`;
    let recent;
    try {
        recent = soapArray(await espressoCall(body, 'didGetOrders'));
    } catch (e) {
        // 491 "no did requests between those dates" is the normal empty case
        return null;
    }
    for (const o of recent) {
        const reqs = soapArray(o.requests).map(r => ({
            ratecenter: r.ratecenter, npa: r.npa, quantity: r.quantity
        }));
        // The order number comes back as `code`
        if (sameRequestShape(reqs, requests)) return String(o.code || '');
    }
    return null;
}

async function placeOrder(profile, requests, opts) {
    // Advisory only — see the note above on why this cannot block
    try {
        const similar = await findRecentMatchingOrder(requests);
        if (similar) {
            console.warn('[order] NOTE: espresso already has a recent order with the same shape:', similar,
                '— proceeding anyway (company-wide feed, cannot tell customers apart).',
                'accountRef:', (opts && opts.accountRef) || 'unknown');
        }
    } catch (e) { /* never let the advisory check block a real order */ }

    if (!profile) profile = ESPRESSO_DID_PROFILE;
    const profiles = await getProfiles();
    if (!profile) {
        if (!profiles.length) throw new Error('No routing profiles on this espresso account');
        profile = profiles[0];
    } else if (!profiles.includes(profile)) {
        // Refusing beats ordering numbers that route somewhere unintended
        throw new Error(`Routing profile "${profile}" not found on this account. Available: ${profiles.join(', ')}`);
    }
    const items = requests.map(r => `
      <item xsi:type="ns1:didRequestArrayStructure">
        <ratecenter xsi:type="xsd:string">${xmlEscape(r.ratecenter)}</ratecenter>
        <npa xsi:type="xsd:string">${xmlEscape(r.npa)}</npa>
        <quantity xsi:type="xsd:int">${parseInt(r.quantity, 10) || 1}</quantity>
        <prefix xsi:type="xsd:string"></prefix>
        <country_prefix xsi:type="xsd:string">No</country_prefix>
      </item>`).join('');

    const body = `<ns1:didOrderDids>
  <didRequestArray xsi:type="ns1:didRequestArrayRoot" SOAP-ENC:arrayType="ns1:didRequestArrayRootStructure[1]">
    <item xsi:type="ns1:didRequestArrayRootStructure">
      <profile xsi:type="xsd:string">${xmlEscape(profile)}</profile>
      <requests xsi:type="ns1:didRequestArrayStruct" SOAP-ENC:arrayType="ns1:didRequestArrayStructure[${requests.length}]">${items}
      </requests>
    </item>
  </didRequestArray>
</ns1:didOrderDids>`;

    const r = await espressoCall(body, 'didOrderDids');
    // didOrderDidsReturnStructure is an array of strings — the order number(s)
    const orders = soapArray(r).map(String);
    return { profile, orderNumbers: orders, orderNumber: orders[0] || null };
}

function getOrderStatus(orderNumber) {
    const body = `<ns1:didGetOrderStatus><didOrderId xsi:type="xsd:string">${xmlEscape(orderNumber)}</didOrderId></ns1:didGetOrderStatus>`;
    return espressoCall(body, 'didGetOrderStatus')
        .then(r => ({ orderNumber, status: (r && r.status) || String(r || '') }));
}

// Details come back as ranges {ratecenter, npa, start, end}. Expand each range
// into the individual numbers so the front end never has to.
function expandRange(start, end) {
    const s = String(start).replace(/\D/g, '');
    const e = String(end).replace(/\D/g, '');
    const nums = [];
    if (!s) return nums;
    const from = BigInt(s), to = BigInt(e || s);
    const cap = 10000n; // safety: never expand a malformed range into millions
    for (let n = from, i = 0n; n <= to && i < cap; n++, i++) nums.push(n.toString());
    return nums;
}

function getOrderDetails(orderNumber) {
    const body = `<ns1:didGetOrderDetails><didOrderId xsi:type="xsd:string">${xmlEscape(orderNumber)}</didOrderId></ns1:didGetOrderDetails>`;
    return espressoCall(body, 'didGetOrderDetails').then(r => {
        const ranges = soapArray(r).map(x => ({
            ratecenter: x.ratecenter, npa: x.npa, start: x.start, end: x.end
        }));
        const numbers = ranges.flatMap(x => expandRange(x.start, x.end));
        return { orderNumber, ranges, numbers };
    });
}

// ============================================
// LNP (Local Number Portability) API operations — v4 endpoint
// ============================================
// 1 = portable, 0 = ratecenter supported but not yet open, -1 = not portable
function lnpCheckPortability(npanxx) {
    const body = `<ns1:lnpCheckNpaNxxPortability><npanxx xsi:type="xsd:string">${xmlEscape(npanxx)}</npanxx></ns1:lnpCheckNpaNxxPortability>`;
    return espressoCall(body, 'lnpCheckNpaNxxPortability', 'lnp')
        .then(r => ({ npanxx, portable: parseInt(r, 10) }));
}

function lnpGetProfiles() {
    return espressoCall('<ns1:lnpGetRoutingProfiles/>', 'lnpGetRoutingProfiles', 'lnp')
        .then(r => soapArray(r).map(x => ({ id: parseInt(x.id, 10), label: x.label || '' })));
}

// data: { numbers: [10-digit strings], existing_account_number, service_type?,
//         current_provider_name?, desired_due_date, auth_date, end_user_name,
//         house_number, street_name, street_type?, city, province_state,
//         zip_code, comments?, losing_carrier_comments?, profile? (routing id) }
async function lnpCreatePon(data) {
    let profileId = parseInt(data.profile || ESPRESSO_LNP_PROFILE, 10) || null;
    const profiles = await lnpGetProfiles();
    if (!profileId) {
        if (!profiles.length) throw new Error('No LNP routing profiles on this espresso account');
        profileId = profiles[0].id;
    } else if (!profiles.some(p => p.id === profileId)) {
        // Same reasoning as placeOrder: a wrong profile misroutes silently
        throw new Error(`LNP routing profile ${profileId} not found on this account. Available: `
            + profiles.map(p => `${p.id} (${p.label})`).join(', '));
    }

    const str = (key, val) => `<${key} xsi:type="xsd:string">${xmlEscape(val == null ? '' : val)}</${key}>`;
    const items = data.numbers.map(n => `
        <item xsi:type="ns1:lnpSdStructure">
          ${str('activity', 'Port')}
          ${str('existing_account_number', data.existing_account_number)}
          ${str('start_number', n)}
          ${str('end_number', '')}
        </item>`).join('');

    const body = `<ns1:lnpCreatePons><data xsi:type="ns1:lnpCreatePonRequest"><pon_data xsi:type="ns1:lnpPonStructure">
${str('service_type', data.service_type || 'Wireline')}
${str('current_provider_name', data.current_provider_name)}
${str('desired_due_date', data.desired_due_date)}
${str('auth_date', data.auth_date)}
${str('end_user_name', data.end_user_name)}
${str('house_number', data.house_number)}
${str('street_directional', data.street_directional)}
${str('street_suffix', data.street_suffix)}
${str('street_name', data.street_name)}
${str('street_type', data.street_type)}
${str('descriptive_location', '')}
${str('floor', '')}
${str('room', '')}
${str('building', '')}
${str('city', data.city)}
${str('province_state', data.province_state)}
${str('zip_code', data.zip_code)}
${str('comments', data.comments)}
${str('losing_carrier_comments', data.losing_carrier_comments)}
<service_details SOAP-ENC:arrayType="ns1:lnpSdStructure[${data.numbers.length}]" xsi:type="ns1:lnpSdStructureArray">${items}
</service_details>
</pon_data>
<routing xsi:type="ns1:lnpRoutingStructure">
<default_routing_profile xsi:type="xsd:int">${parseInt(profileId, 10)}</default_routing_profile>
<details SOAP-ENC:arrayType="ns1:lnpRoutingDetails[0]" xsi:type="ns1:lnpRoutingDetailsArray"/>
</routing></data></ns1:lnpCreatePons>`;

    const r = await espressoCall(body, 'lnpCreatePons', 'lnp');
    const pons = soapArray(r);
    if (!pons.length) throw new Error('LNP API returned no PON');
    const first = pons[0];
    return {
        pon: first.pon,
        status: first.last_processstatus || '',
        dateLastUpdate: first.date_last_update || '',
        routingProfile: parseInt(profileId, 10)
    };
}

function lnpPonStatus(pon) {
    const body = `<ns1:lnpPonLastStatus><pon xsi:type="xsd:string">${xmlEscape(pon)}</pon></ns1:lnpPonLastStatus>`;
    return espressoCall(body, 'lnpPonLastStatus', 'lnp').then(r => {
        const reason = r.status_reason || {};
        return {
            pon: r.pon || pon,
            status: r.last_processstatus || '',
            dateLastUpdate: r.date_last_update || '',
            note: r.note || '',
            statusReason: {
                type: reason.type || '',
                typeLabel: reason.type_label || '',
                details: soapArray(reason.details).map(d =>
                    typeof d === 'string' ? d : (d && (d.message || d.description)) || JSON.stringify(d))
            }
        };
    });
}

// ============================================
// PAYMENT — charge proxy with idempotency
// ============================================
// The browser used to POST the charge to the billing API directly, which meant
// (a) nothing stopped the same balance being charged twice if state was lost,
// (b) the payment key shipped in client JS, and (c) a gateway 502 arrives
// without CORS headers, so the browser could not even read the status and had
// to treat every failure as "outcome unknown".
//
// Routing it here fixes all three: charges are recorded and de-duplicated, the
// key stays server-side, and the real HTTP status is visible.
const BILLING_API_URL = 'https://api.iristelx.com';
const PAYMENT_API_KEY = process.env.PAYMENT_API_KEY || 'b1582d78d369685683e090ad37489937';
const CHARGE_STORE_PATH = process.env.CHARGE_STORE_PATH || path.join(ROOT, '.charge-store.json');

let chargeStore = {};
try { chargeStore = JSON.parse(fs.readFileSync(CHARGE_STORE_PATH, 'utf8')); } catch (e) { chargeStore = {}; }

function saveChargeStore() {
    try {
        ensureStoreDir(CHARGE_STORE_PATH);
        fs.writeFileSync(CHARGE_STORE_PATH, JSON.stringify(chargeStore), 'utf8');
    } catch (e) {
        console.error('[charge] CHARGE RECORD NOT PERSISTED —', e.message,
            '\n  A restart could allow this balance to be charged again.',
            '\n  On Render, add a disk and set CHARGE_STORE_PATH inside its mount path.');
    }
}

function postJson(url, headers, body) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify(body);
        const req = https.request(url, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
            timeout: 45000
        }, res => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => resolve({ status: res.statusCode, raw: data }));
        });
        req.on('timeout', () => req.destroy(new Error('payment gateway timeout')));
        req.on('error', reject);
        req.end(payload);
    });
}

async function chargeBalance(body) {
    const { accountCode, amount, creditCard } = body;
    // Same account + same amount = the same charge, so a repeat is recognised
    // even from a browser that has forgotten everything.
    const key = body.idempotencyKey || `${accountCode}::${Number(amount).toFixed(2)}`;

    const seen = chargeStore[key];
    if (seen && seen.outcome === 'success') {
        console.log('[charge] duplicate suppressed for', key, '→', seen.reference);
        return { ...seen, duplicate: true };
    }
    // A previous attempt whose outcome we never learned: the card may already
    // have been charged, so refuse rather than risk a second one.
    if (seen && seen.outcome === 'unknown') {
        const err = new Error('A previous payment attempt for this amount did not return a result '
            + `(reference ${seen.reference}). Do not retry — contact support to confirm whether it went through.`);
        err.status = 409; err.reference = seen.reference;
        throw err;
    }

    const reference = (seen && seen.reference) || ('IRS-BAL-' + Date.now().toString(36).toUpperCase());
    chargeStore[key] = { reference, outcome: 'pending', amount, accountCode, createdAt: Date.now() };
    saveChargeStore();

    let result;
    try {
        result = await postJson(`${BILLING_API_URL}/bot/${accountCode}/payment`,
            { 'x-api-key': PAYMENT_API_KEY },
            { amount: Number(amount).toFixed(2), creditCard, reference });
    } catch (netErr) {
        chargeStore[key] = { ...chargeStore[key], outcome: 'unknown', detail: netErr.message };
        saveChargeStore();
        const err = new Error(`Payment service unreachable (${netErr.message}). Reference ${reference} — do not retry, contact support.`);
        err.status = 502; err.reference = reference;
        throw err;
    }

    let data = null;
    try { data = JSON.parse(result.raw); } catch (e) { /* gateway HTML, not JSON */ }

    // A gateway error says nothing about whether the charge ran upstream
    if (!data || [502, 503, 504].includes(result.status)) {
        chargeStore[key] = { ...chargeStore[key], outcome: 'unknown', detail: `HTTP ${result.status}` };
        saveChargeStore();
        console.error('[charge] unreadable response', result.status, result.raw.slice(0, 200));
        const err = new Error(`Payment service unavailable (HTTP ${result.status}). Reference ${reference} — do not retry, contact support.`);
        err.status = 502; err.reference = reference;
        throw err;
    }

    if (result.status < 200 || result.status >= 300) {
        // A clean decline: the charge definitively did not happen, so allow a retry
        delete chargeStore[key];
        saveChargeStore();
        const detail = Array.isArray(data.errors) ? data.errors.map(e => e && e.message).filter(Boolean).join(' ') : '';
        const err = new Error((data.message || `Payment failed (HTTP ${result.status})`) + (detail ? ' — ' + detail : ''));
        err.status = 402;
        throw err;
    }

    chargeStore[key] = { ...chargeStore[key], outcome: 'success', chargedAt: Date.now() };
    saveChargeStore();
    return { reference, amount: Number(amount).toFixed(2), result: data };
}

// ============================================
// MIND ACCOUNT — create once per customer
// ============================================
// Guarded by email, not by the browser: a customer returning on a new device
// would otherwise sign up again and end up with duplicate MIND accounts, and —
// worse — a different account id, which would slip past the DID order guard and
// bill them a second time.
const MIND_API_KEY = process.env.MIND_API_KEY || 'HRT88y2qywc6fwX779zG2D8fJtJQJbvz';

async function createAccount(email, contact) {
    const key = K.account(email);
    const seen = stateGet(key);
    if (seen && seen.accountId) {
        console.log('[account] reusing', seen.accountId, 'for', normEmail(email));
        return { accountId: seen.accountId, reused: true };
    }

    const requestBody = {
        contact: {
            fname: contact.fname, lname: contact.lname,
            address1: contact.address1, city: contact.city,
            province: contact.province, country: contact.country,
            postalCode: contact.postalCode, emailAddress: contact.emailAddress || email,
            phone: { mobile: contact.phone }
        },
        language: contact.language || 'en',
        businessUnit: '1'
    };

    const r = await postJson(`${BILLING_API_URL}/accounts`, { 'iristelx-api-key': MIND_API_KEY }, requestBody);
    let data = null;
    try { data = JSON.parse(r.raw); } catch (e) {}
    if (r.status < 200 || r.status >= 300 || !data) {
        const detail = data && Array.isArray(data.errors)
            ? data.errors.map(e => e && e.message).filter(Boolean).join(' ') : '';
        const err = new Error(((data && data.message) || `Account creation failed (HTTP ${r.status})`) + (detail ? ' — ' + detail : ''));
        err.status = r.status >= 400 && r.status < 500 ? r.status : 502;
        throw err;
    }

    const accountId = data.accountId || data.id || data.accountcode;
    if (!accountId) throw new Error('Account created but no id returned');
    stateSet(key, { accountId, email: normEmail(email) });
    return { accountId, reused: false };
}

// ============================================
// UBOSS PROVISIONING — never spawn a duplicate job
// ============================================
// UbossRobot does not resume: a retry restarts from step one. Once a previous
// run got far enough to add the number to the pool, every later attempt fails
// permanently with "Number(s) already exist in the number pool" — observed 10+
// times on one number over two weeks, never recovering.
//
// So an accidental repeat (refresh, new device, re-submit) must NEVER start a
// second job; it returns the existing one. Only an explicit, user-initiated
// retry may start a fresh job, and it says so with force:true.
const UBOSS_API_URL = 'https://api.iristelx.com/uboss-robot';
const UBOSS_API_KEY = process.env.UBOSS_API_KEY || 'b1582d78d369685683e090ad37489937';

function ubossJobStatus(jobId) {
    return new Promise((resolve) => {
        https.get(`${UBOSS_API_URL}/trunk-provisioning/${encodeURIComponent(jobId)}/status`,
            { headers: { 'x-api-key': UBOSS_API_KEY }, timeout: 20000 }, res => {
                let d = ''; res.on('data', c => d += c);
                res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { resolve(null); } });
            }).on('error', () => resolve(null)).on('timeout', function () { this.destroy(); resolve(null); });
    });
}

async function startProvisioning(body) {
    const { email, phoneNumbers, force } = body;
    const key = K.provision(email, phoneNumbers);
    const seen = stateGet(key);

    if (seen && seen.jobId && !force) {
        const live = await ubossJobStatus(seen.jobId);
        const status = live && live.status;
        console.log('[provision] existing job', seen.jobId, 'status', status, '— not starting another');
        return { jobId: seen.jobId, reused: true, status: status || seen.status || 'Unknown' };
    }

    const requestBody = {
        phoneNumbers: phoneNumbers,
        resellerName: body.resellerName,
        address: body.address,
        city: body.city,
        postcode: body.postcode,
        notificationEmail: body.notificationEmail,
        invoiceEmail: body.invoiceEmail,
        accountRef: body.accountRef,
        businessName: body.businessName,
        channelCount: body.channelCount
    };

    const r = await postJson(`${UBOSS_API_URL}/trunk-provisioning`, { 'x-api-key': UBOSS_API_KEY }, requestBody);
    let data = null;
    try { data = JSON.parse(r.raw); } catch (e) {}
    if (r.status < 200 || r.status >= 300 || !data || !data.id) {
        const err = new Error((data && data.message) || `Provisioning failed to start (HTTP ${r.status})`);
        err.status = 502;
        throw err;
    }

    stateSet(key, { jobId: data.id, email: normEmail(email), phoneNumbers, attempts: ((seen && seen.attempts) || 0) + 1 });
    return { jobId: data.id, reused: false, sipAuthenticationPassword: data.sipAuthenticationPassword };
}

// ============================================
// HTTP layer
// ============================================
function sendJson(res, status, obj) {
    const body = JSON.stringify(obj);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(body);
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let data = '';
        req.on('data', c => { data += c; if (data.length > 1e6) req.destroy(); });
        req.on('end', () => resolve(data));
        req.on('error', reject);
    });
}

async function handleApi(req, res, pathname) {
    try {
        if (pathname === '/api/did/catalog' && req.method === 'GET') {
            return sendJson(res, 200, { catalog: await getCatalog() });
        }
        if (pathname === '/api/did/profiles' && req.method === 'GET') {
            return sendJson(res, 200, { profiles: await getProfiles() });
        }
        if (pathname === '/api/did/order' && req.method === 'POST') {
            const body = JSON.parse(await readBody(req) || '{}');
            const requests = Array.isArray(body.requests) ? body.requests : [];
            if (!requests.length) return sendJson(res, 400, { error: 'requests[] is required' });
            for (const r of requests) {
                if (!r.ratecenter || !r.npa) return sendJson(res, 400, { error: 'each request needs ratecenter and npa' });
            }

            // Never place the same order twice. Keyed on EMAIL so it holds
            // across devices and cleared browsers, where an account id would
            // change and let a duplicate through.
            if (!body.email) return sendJson(res, 400, { error: 'email is required' });
            const key = K.order(body.email, requests);
            const seen = stateGet(key);
            if (seen && seen.orderNumber) {
                console.log('[order] duplicate suppressed for', key, '→', seen.orderNumber);
                return sendJson(res, 200, { ...seen, duplicate: true });
            }

            const result = await placeOrder(body.profile, requests, { accountRef: body.accountRef });
            stateSet(key, {
                orderNumber: result.orderNumber,
                orderNumbers: result.orderNumbers,
                profile: result.profile,
                email: normEmail(body.email),
                accountRef: body.accountRef || null,
                requests: requests
            });
            return sendJson(res, 200, result);
        }
        if (pathname === '/api/account' && req.method === 'POST') {
            const body = JSON.parse(await readBody(req) || '{}');
            if (!body.email) return sendJson(res, 400, { error: 'email is required' });
            if (!body.contact) return sendJson(res, 400, { error: 'contact is required' });
            return sendJson(res, 200, await createAccount(body.email, body.contact));
        }
        if (pathname === '/api/provision' && req.method === 'POST') {
            const body = JSON.parse(await readBody(req) || '{}');
            if (!body.email) return sendJson(res, 400, { error: 'email is required' });
            if (!Array.isArray(body.phoneNumbers) || !body.phoneNumbers.length) {
                return sendJson(res, 400, { error: 'phoneNumbers[] is required' });
            }
            return sendJson(res, 200, await startProvisioning(body));
        }
        // Everything this server knows about a customer — lets any device pick
        // an order back up instead of starting (and paying for) a new one.
        if (pathname === '/api/session' && req.method === 'GET') {
            const email = normEmail(new URL(req.url, 'http://x').searchParams.get('email'));
            if (!email) return sendJson(res, 400, { error: 'email is required' });
            const out = { email, account: null, order: null, pon: null, provisions: [] };
            for (const [k, v] of Object.entries(orderStore)) {
                if (!k.includes(`:${email}`)) continue;
                if (k.startsWith('account:')) out.account = v;
                else if (k.startsWith('order:')) out.order = v;
                else if (k.startsWith('pon:')) out.pon = v;
                else if (k.startsWith('provision:')) out.provisions.push(v);
            }
            return sendJson(res, 200, out);
        }
        if (pathname === '/api/payment/charge' && req.method === 'POST') {
            const body = JSON.parse(await readBody(req) || '{}');
            if (!body.accountCode || !body.amount || !body.creditCard) {
                return sendJson(res, 400, { error: 'accountCode, amount and creditCard are required' });
            }
            return sendJson(res, 200, await chargeBalance(body));
        }
        // Support/debug view of what this server has recorded
        if (pathname === '/api/did/orders/recorded' && req.method === 'GET') {
            pruneOrderStore();
            return sendJson(res, 200, {
                orders: Object.entries(orderStore).map(([key, v]) => ({ key, ...v }))
            });
        }
        let m = pathname.match(/^\/api\/did\/order\/([^/]+)\/status$/);
        if (m && req.method === 'GET') {
            return sendJson(res, 200, await getOrderStatus(decodeURIComponent(m[1])));
        }
        m = pathname.match(/^\/api\/did\/order\/([^/]+)\/details$/);
        if (m && req.method === 'GET') {
            return sendJson(res, 200, await getOrderDetails(decodeURIComponent(m[1])));
        }
        m = pathname.match(/^\/api\/lnp\/portability\/(\d{6})$/);
        if (m && req.method === 'GET') {
            return sendJson(res, 200, await lnpCheckPortability(m[1]));
        }
        if (pathname === '/api/lnp/profiles' && req.method === 'GET') {
            return sendJson(res, 200, { profiles: await lnpGetProfiles() });
        }
        if (pathname === '/api/lnp/pon' && req.method === 'POST') {
            const body = JSON.parse(await readBody(req) || '{}');
            const numbers = (Array.isArray(body.numbers) ? body.numbers : [])
                .map(n => String(n).replace(/\D/g, ''));
            if (!numbers.length) return sendJson(res, 400, { error: 'numbers[] is required' });
            if (numbers.some(n => n.length !== 10)) {
                return sendJson(res, 400, { error: 'every number must be exactly 10 digits' });
            }
            for (const field of ['end_user_name', 'house_number', 'street_name', 'city',
                                 'province_state', 'zip_code', 'auth_date', 'desired_due_date']) {
                if (!body[field] || !String(body[field]).trim()) {
                    return sendJson(res, 400, { error: `${field} is required` });
                }
            }
            // A duplicate PON files a second port request with the losing
            // carrier, which is disruptive and slow to unwind — so it is
            // guarded by email like everything else.
            if (!body.email) return sendJson(res, 400, { error: 'email is required' });
            const ponKey = K.pon(body.email);
            const seenPon = stateGet(ponKey);
            if (seenPon && seenPon.pon) {
                console.log('[pon] duplicate suppressed for', ponKey, '→', seenPon.pon);
                return sendJson(res, 200, { ...seenPon, duplicate: true });
            }
            const ponResult = await lnpCreatePon({ ...body, numbers });
            stateSet(ponKey, { ...ponResult, email: normEmail(body.email), numbers });
            return sendJson(res, 200, ponResult);
        }
        m = pathname.match(/^\/api\/lnp\/pon\/([^/]+)\/status$/);
        if (m && req.method === 'GET') {
            return sendJson(res, 200, await lnpPonStatus(decodeURIComponent(m[1])));
        }
        sendJson(res, 404, { error: 'Unknown API route' });
    } catch (err) {
        console.error('[api]', pathname, '-', err.message);
        // Carry the payment reference through: on an unknown outcome it is the
        // only handle support has on a charge that may have gone through.
        const payload = { error: err.message };
        if (err.reference) payload.reference = err.reference;
        sendJson(res, err.status || 500, payload);
    }
}

// ============================================
// Static files
// ============================================
const MIME = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.json': 'application/json',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.pdf': 'application/pdf',
    '.woff': 'font/woff', '.woff2': 'font/woff2'
};

function serveStatic(res, pathname) {
    let rel = decodeURIComponent(pathname);
    if (rel === '/') rel = '/signUp.html';
    const file = path.normalize(path.join(ROOT, rel));
    if (!file.startsWith(ROOT + path.sep) && file !== ROOT) {
        res.writeHead(403); return res.end('Forbidden');
    }
    fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404); return res.end('Not found'); }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
        res.end(data);
    });
}

const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://x').pathname;
    if (pathname.startsWith('/api/')) return handleApi(req, res, pathname);
    serveStatic(res, pathname);
});

server.listen(PORT, () => {
    // Print the resolved config: a deploy pointed at the wrong environment or
    // profile should be obvious from the log, not discovered via a bad order.
    console.log(`OnlineOrdering server on :${PORT} — espresso mode: ${ESPRESSO_MODE}` +
        (ESPRESSO_USER ? '' : ' (NO CREDENTIALS SET — /api/did/* will return 503)'));
    console.log('  DID profile: ' + (ESPRESSO_DID_PROFILE || '(not pinned — will use the account\'s first profile)'));
    console.log('  LNP profile: ' + (ESPRESSO_LNP_PROFILE || '(not pinned — will use the account\'s first profile)'));
});
