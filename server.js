// ============================================
// OnlineOrdering server
// ============================================
// Serves the static ordering pages AND proxies the Iristel espresso APIs as
// JSON: DID inventory and orders over REST under /api/did/* (the rate-center
// catalog still over SOAP v3), LNP (number porting) over SOAP v4 under
// /api/lnp/*.
//
// The browser cannot talk to espresso directly: there are no CORS headers,
// SOAP is rpc/encoded, and the credentials must not ship in client JS. This
// proxy is the one place that knows all three.
//
// Run:  ESPRESSO_USER=... ESPRESSO_PASS=... ESPRESSO_CLIENT_ID=... ESPRESSO_CLIENT_SECRET=... node server.js
// Env:  ESPRESSO_MODE=test|production  (default test; test = REST sandbox)
//       PORT                           (default 3000)
//
// No npm dependencies — `npm start` works with no install step.

const http = require('http');
const https = require('https');

// Reused across espresso/MIND/UbossRobot calls — saves a TLS handshake per
// request, which adds up on the multi-call order path.
const KEEPALIVE_AGENT = new https.Agent({ keepAlive: true, maxSockets: 10 });
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ESPRESSO_MODE = process.env.ESPRESSO_MODE === 'production' ? 'production' : 'test';
const ESPRESSO_URL = `https://connect.espressodid.com/cloud/public/v3/${ESPRESSO_MODE}`;
// rpc/encoded: the body namespace is the WSDL targetNamespace, which embeds the mode URL
const ESPRESSO_NS = `urn:${ESPRESSO_URL}`;
// Orders placed over SOAP before the REST switch are read back from the
// environment they were placed in (the live site ordered in production)
const ESPRESSO_LEGACY_MODE = ['production', 'test'].includes(process.env.ESPRESSO_LEGACY_DID_MODE)
    ? process.env.ESPRESSO_LEGACY_DID_MODE : ESPRESSO_MODE;
const ESPRESSO_LEGACY_URL = `https://connect.espressodid.com/cloud/public/v3/${ESPRESSO_LEGACY_MODE}`;
const ESPRESSO_LEGACY_NS = `urn:${ESPRESSO_LEGACY_URL}`;
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
// Porting has its own mode, defaulting to whatever DID ordering uses.
//
// A DID order that goes out by mistake costs a number. A PON that goes out by
// mistake starts a real number transfer: the customer's current provider is
// notified and unwinding it means cancelling a port. So the two are separable —
// ESPRESSO_LNP_MODE=test keeps porting in the sandbox while numbers are ordered
// for real, which is what you want while demoing on a live site.
const ESPRESSO_LNP_MODE = process.env.ESPRESSO_LNP_MODE === 'production' ? 'production'
    : process.env.ESPRESSO_LNP_MODE === 'test' ? 'test'
    : ESPRESSO_MODE;
const ESPRESSO_LNP_URL = `https://connect.espressodid.com/cloud/public/v4/${ESPRESSO_LNP_MODE}`;
const ESPRESSO_LNP_NS = `urn:${ESPRESSO_LNP_URL}`;

// The reseller every provisioning job is filed under — set via
// UBOSS_RESELLER_NAME. Defaults to 'Demo Reseller', the only reseller with
// completed jobs to date: 'IRISTEL' dies on the robot's non-exact reseller
// lookup (matches 6 links, strict-mode violation) until the UBoss team
// deploys the exact-match fix.
const UBOSS_RESELLER_NAME = process.env.UBOSS_RESELLER_NAME || 'Demo Reseller';

// Optional catalog restriction to NPAs whose "+1-<npa>" number pool works in
// UBoss. Off by default since the UBoss pool-lookup fix (2026-09-10 sweep:
// 204/416/647/431/604 all provision cleanly). Set a comma-separated
// UBOSS_POOL_NPAS to re-restrict if a pool breaks again.
const UBOSS_POOL_NPAS = (process.env.UBOSS_POOL_NPAS || '')
    .split(',').map(s => s.trim()).filter(Boolean);

// Optional fixed rate-center list, 'RATECENTER:NPA' pairs, used instead of
// espresso's catalog (see /api/did/catalog)
const DID_CATALOG_OVERRIDE = (process.env.DID_CATALOG_OVERRIDE || '')
    .split(',').map(s => s.trim()).filter(Boolean)
    .map(x => { const [rc, npa] = x.split(':'); return { ratecenter: String(rc || '').trim().toUpperCase(), npa: String(npa || '').trim() }; })
    .filter(x => x.ratecenter && /^\d{3}$/.test(x.npa));

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
// an order whose create answer was lost is found again in espresso by its
// reference. A real datastore is the pre-launch answer — tracked separately.
// Render allows one disk per service, which is all this needs — both stores are
// files in the same directory. Point STATE_DIR at the mount (e.g. /var/data)
// and both land there; the individual paths remain overridable.
const STATE_DIR = process.env.STATE_DIR || ROOT;
const ORDER_STORE_PATH = process.env.ORDER_STORE_PATH
    || path.join(STATE_DIR, STATE_DIR === ROOT ? '.order-store.json' : 'order-store.json');
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

// Records are ACTIVE while an order is in flight and DONE once it has been
// fully provisioned. The distinction matters: an active record suppresses
// duplicates (a refresh or a new device must not order or charge twice), but a
// done one must not — a customer coming back next week to buy a second trunk
// is placing a genuinely new order and has to be allowed to.
function stateGet(key, opts) {
    const rec = orderStore[key] || null;
    if (!rec) return null;
    if (opts && opts.activeOnly && rec.status === 'done') return null;
    return rec;
}

function stateSet(key, record) {
    orderStore[key] = {
        status: 'active',
        ...record,
        createdAt: (orderStore[key] && orderStore[key].createdAt) || Date.now(),
        updatedAt: Date.now()
    };
    saveOrderStore();
    return orderStore[key];
}

// Closes out everything in flight for a customer once provisioning succeeds.
// The MIND account is deliberately left active — that should always be reused,
// never recreated.
function markSessionDone(email) {
    const e = normEmail(email);
    let closed = 0;
    for (const [k, v] of Object.entries(orderStore)) {
        if (!k.includes(`:${e}`) || k.startsWith('account:')) continue;
        if (v && v.status !== 'done') {
            orderStore[k] = { ...v, status: 'done', doneAt: Date.now() };
            closed++;
        }
    }
    if (closed) {
        saveOrderStore();
        console.log('[session]', e, '— closed', closed, 'record(s); a new order is now allowed');
    }

    // The order is complete, so its payment is settled history: release this
    // customer's SUCCESSFUL charge records so their NEXT order charges the
    // card again instead of being treated as a duplicate. (Without this, the
    // in-chargeBalance release could never fire — sessionAlreadyProvisioned
    // sees only non-done records, and we just marked everything done.)
    // Pending/unknown outcomes are deliberately kept: they still guard
    // against a possible unresolved double charge.
    const acct = orderStore[`account:${e}`];
    if (acct && acct.accountId) {
        let released = 0;
        for (const [k, v] of Object.entries(chargeStore)) {
            if (k.startsWith(`${acct.accountId}::`) && v && v.outcome === 'success') {
                delete chargeStore[k];
                released++;
            }
        }
        if (released) {
            saveChargeStore();
            console.log('[session]', e, '— released', released, 'settled charge record(s); the next order will charge normally');
        }
    }
    return closed;
}

// Picked numbers are part of the shape: the same rate center with other
// numbers is a different order
function requestShape(requests) {
    return (requests || [])
        .map(r => `${String(r.ratecenter).toUpperCase()}|${r.npa}|${parseInt(r.quantity, 10) || 1}`
            + (Array.isArray(r.dids) && r.dids.length ? '|' + r.dids.map(tenDigits).sort().join(',') : ''))
        .sort().join(';');
}

// One namespace per step, so each is guarded independently
const K = {
    account:   email => `account:${normEmail(email)}`,
    order:     (email, requests) => `order:${normEmail(email)}::${requestShape(requests)}`,
    pon:       email => `pon:${normEmail(email)}`,
    provision: (email, numbers) => `provision:${normEmail(email)}::${(numbers || []).slice().sort().join(',')}`,
    bizdoc:    email => `bizdoc:${normEmail(email)}`
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
            agent: KEEPALIVE_AGENT,
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
    const raw = api === 'lnp' ? await soapPost(methodBodyXml, ESPRESSO_LNP_URL, ESPRESSO_LNP_NS)
        : api === 'did-legacy' ? await soapPost(methodBodyXml, ESPRESSO_LEGACY_URL, ESPRESSO_LEGACY_NS)
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

// ---- Legacy SOAP order reads ----
// Orders are placed through the REST API below. These read orders placed
// before the switch (SOAP order numbers, e.g. DID2610150200001) so anything
// still in flight finishes; they can go once no such order is open.
function getOrderStatus(orderNumber) {
    const body = `<ns1:didGetOrderStatus><didOrderId xsi:type="xsd:string">${xmlEscape(orderNumber)}</didOrderId></ns1:didGetOrderStatus>`;
    return espressoCall(body, 'didGetOrderStatus', 'did-legacy')
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
    return espressoCall(body, 'didGetOrderDetails', 'did-legacy').then(r => {
        const ranges = soapArray(r).map(x => ({
            ratecenter: x.ratecenter, npa: x.npa, start: x.start, end: x.end
        }));
        const numbers = ranges.flatMap(x => expandRange(x.start, x.end));
        return { orderNumber, ranges, numbers };
    });
}

// Why espresso rejected an order — per-request reject reasons (e.g. "not
// enough available numbers in rate center EDMONTON 587"). Included in snag
// reports so the provisioning team sees the cause without asking espresso.
function getOrderProblems(orderNumber) {
    const body = `<ns1:didGetOrderProblems><didOrderId xsi:type="xsd:string">${xmlEscape(orderNumber)}</didOrderId></ns1:didGetOrderProblems>`;
    return espressoCall(body, 'didGetOrderProblems', 'did-legacy')
        .then(r => soapArray(r).map(x => ({
            ratecenter: x.ratecenter, npa: x.npa, quantity: x.quantity,
            rejectReason: x.reject_reason || x.rejectReason || null
        })))
        .catch(e => {
            console.warn('[snag] could not fetch order problems for', orderNumber, '-', e.message);
            return [];
        });
}

// ============================================
// espresso REST API — inventory + DID orders
// ============================================
// Orders go through espresso's REST API (JSON, OAuth2). What it adds over
// SOAP is the live number inventory, so the customer picks the exact numbers
// they want and MIND is checked BEFORE anything is bought. The rate-center
// catalog and porting have no REST equivalent and stay on SOAP.
//
// Host follows ESPRESSO_MODE: production → api.espressodid.com, test → the
// sandbox. The sandbox may need its own login, so ESPRESSO_REST_USER/PASS
// override the SOAP credentials.
const ESPRESSO_REST_URL = (process.env.ESPRESSO_REST_URL
    || (ESPRESSO_MODE === 'production' ? 'https://api.espressodid.com' : 'https://api-sandbox.espressodid.com'))
    .replace(/\/$/, '');
// Tokens always come from production, even for the sandbox (espresso,
// 2026-10-23) — the sandbox refuses the client at its own /auth/token
const ESPRESSO_REST_AUTH_URL = (process.env.ESPRESSO_REST_AUTH_URL || 'https://api.espressodid.com').replace(/\/$/, '');
const ESPRESSO_CLIENT_ID = process.env.ESPRESSO_CLIENT_ID || '';
const ESPRESSO_CLIENT_SECRET = process.env.ESPRESSO_CLIENT_SECRET || '';
const ESPRESSO_REST_USER = process.env.ESPRESSO_REST_USER || ESPRESSO_USER;
const ESPRESSO_REST_PASS = process.env.ESPRESSO_REST_PASS || ESPRESSO_PASS;
// Iristel's own numbers — the only OCN the order API accepts
const ESPRESSO_OCN = process.env.ESPRESSO_OCN || '154E';
// Where the number picker gets its numbers: 'inventory' (search espresso's
// inventory) or 'reserve' (reserve a batch with a select-DIDs order and let
// the customer pick from it). 'reserve' stands in while espresso hasn't
// granted inventory search; it is never the default, so production can't
// start making reservation orders by accident.
const ESPRESSO_PICK_SOURCE = process.env.ESPRESSO_PICK_SOURCE === 'reserve' ? 'reserve' : 'inventory';
// espresso's nginx answers the order collection, /ws/v1/dids/orders, with a
// 301 to /ws/v1/dids/orders/ — a static Swagger docs folder (GET 200 HTML,
// POST 405) — so creating and listing orders never reach the API. The app
// answers at /index.php/ws/v1/dids/orders (seen 2026-10-21 on both hosts).
// Single orders (/ws/v1/dids/orders/{id}) and every other path work as published.
const ESPRESSO_REST_ROUTED = { '/ws/v1/dids/orders': '/index.php/ws/v1/dids/orders' };
const ESPRESSO_REST_CONFIGURED = !!(ESPRESSO_CLIENT_ID && ESPRESSO_CLIENT_SECRET
    && ESPRESSO_REST_USER && ESPRESSO_REST_PASS);

// err.apiCode is what the browser branches on (sent back as `code`)
function espressoRestError(message, fields) {
    return Object.assign(new Error(message), { status: 502 }, fields || {});
}

// 10-digit form for the browser, the store and UBoss; espresso and MIND
// use 11 (mindDigits). The conversion happens only at those edges.
function tenDigits(n) {
    const d = String(n || '').replace(/\D/g, '');
    return d.length === 11 && d[0] === '1' ? d.slice(1) : d;
}

// ---- Token ----
// espresso keeps at most 5 live tokens per user and revokes the oldest, so
// one token is shared by every request and refreshed just before it expires.
let restToken = null;         // { access, refresh, expiresAt }
let restTokenPending = null;  // the one in-flight fetch everyone waits on

async function requestRestToken(grant) {
    const form = new URLSearchParams({
        client_id: ESPRESSO_CLIENT_ID, client_secret: ESPRESSO_CLIENT_SECRET, ...grant
    }).toString();
    const r = await httpsRequest(`${ESPRESSO_REST_AUTH_URL}/ws/v1/auth/token`, {
        method: 'POST', headers: {
            'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json',
            'Content-Length': Buffer.byteLength(form)
        }
    }, form);
    let data = null;
    try { data = JSON.parse(r.raw); } catch (e) {}
    if (r.status !== 200 || !data || !data.access_token) {
        throw espressoRestError(`espresso REST login failed (HTTP ${r.status}): `
            + ((data && (data.error_description || data.error)) || String(r.raw || '').slice(0, 200)),
            { status: 503, apiCode: 'ESPRESSO_AUTH', espressoStatus: r.status });
    }
    restToken = {
        access: data.access_token, refresh: data.refresh_token || null,
        expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000
    };
    return restToken.access;
}

function espressoRestToken() {
    if (restToken && restToken.expiresAt - 60000 > Date.now()) return Promise.resolve(restToken.access);
    if (!restTokenPending) {
        const prev = restToken;
        restTokenPending = (async () => {
            if (prev && prev.refresh) {
                try { return await requestRestToken({ grant_type: 'refresh_token', refresh_token: prev.refresh }); }
                catch (e) { console.warn('[espresso] token refresh failed — logging in again:', e.message); }
            }
            return requestRestToken({ grant_type: 'password', username: ESPRESSO_REST_USER, password: ESPRESSO_REST_PASS });
        })().finally(() => { restTokenPending = null; });
    }
    return restTokenPending;
}

// One REST call. Errors keep espresso's HTTP status and first error code
// (espressoStatus / espressoCode); err.transport marks a call whose answer
// never arrived — for an order that means "may or may not exist".
async function espressoRest(method, apiPath, body) {
    if (!ESPRESSO_REST_CONFIGURED) {
        throw espressoRestError('espresso REST API not configured (set ESPRESSO_CLIENT_ID / ESPRESSO_CLIENT_SECRET)',
            { status: 503, apiCode: 'ESPRESSO_NOT_CONFIGURED' });
    }
    const payload = body === undefined ? null : JSON.stringify(body);
    const qAt = apiPath.indexOf('?');
    const path = qAt < 0 ? apiPath : apiPath.slice(0, qAt);
    const url = ESPRESSO_REST_URL + (ESPRESSO_REST_ROUTED[path] || path) + (qAt < 0 ? '' : apiPath.slice(qAt));
    let reauthed = false;
    for (;;) {
        const token = await espressoRestToken();
        let r;
        try {
            r = await httpsRequest(url, {
                method, headers: {
                    'Authorization': `Bearer ${token}`, 'Accept': 'application/json',
                    ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {})
                }
            }, payload);
        } catch (e) {
            throw espressoRestError(`espresso ${method} ${apiPath} — no answer: ${e.message}`,
                { status: 503, transport: true });
        }
        // The API answers in place. A redirect means the request went to
        // something that isn't the API (see ESPRESSO_REST_ROUTED); nothing
        // was processed, so it is refused as not ambiguous, never followed.
        if (r.status >= 300 && r.status < 400) {
            throw espressoRestError(`espresso ${method} ${apiPath} was redirected to ${r.headers.location || '(nowhere)'} instead of reaching the API`,
                { status: 503, apiCode: 'ESPRESSO_MISROUTED', espressoStatus: r.status });
        }
        // Expired or revoked token: rejected before any processing, so one
        // fresh login and a retry is safe even when placing an order
        if (r.status === 401 && !reauthed) { reauthed = true; restToken = null; continue; }
        let data = null;
        try { data = r.raw ? JSON.parse(r.raw) : {}; } catch (e) {}
        if (r.status >= 200 && r.status < 300) {
            if (data === null) {
                throw espressoRestError(`espresso ${method} ${apiPath} answered HTTP ${r.status} with something that isn't JSON`,
                    { apiCode: 'ESPRESSO_BAD_RESPONSE', espressoStatus: r.status });
            }
            return data;
        }
        const errs = data && Array.isArray(data.errors) ? data.errors : [];
        throw espressoRestError(`espresso ${method} ${apiPath} → HTTP ${r.status}: `
            + (errs.length ? errs.map(x => [x.code, x.message].filter(v => v != null && v !== '').join(' ')).join('; ')
                : String(r.raw || '').slice(0, 200)),
            { status: r.status >= 500 ? 503 : 502, espressoStatus: r.status,
              espressoCode: errs[0] && errs[0].code != null ? String(errs[0].code) : null, errors: errs });
    }
}

// ---- Company and routing profile ----
// Resolved once and cached for an hour. The routing profile decides where the
// numbers ring — a wrong one provisions fine but routes calls nowhere — so it
// is matched by the pinned label (ESPRESSO_DID_PROFILE), never guessed.
const REST_ACCOUNT_TTL_MS = 60 * 60 * 1000;
let restAccount = null; // { companyId, routingProfileId, profileLabel, at }

async function restRoutingProfiles(companyId) {
    const q = new URLSearchParams({ from: '0', size: '1000', ...(companyId ? { company_id: companyId } : {}) });
    const page = await espressoRest('GET', `/ws/v1/network/routing_profiles?${q}`);
    return Array.isArray(page) ? page : (page && Array.isArray(page.data) ? page.data : []);
}

async function espressoRestAccount(fresh) {
    if (!fresh && restAccount && Date.now() - restAccount.at < REST_ACCOUNT_TTL_MS) return restAccount;
    let companyId = process.env.ESPRESSO_COMPANY_ID || '';
    if (!companyId) {
        const r = await espressoRest('GET', '/ws/v1/general/companies');
        const active = (Array.isArray(r) ? r : (r && r.data) || []).filter(c => c && c.id && c.active !== false);
        if (active.length !== 1) {
            throw espressoRestError(`espresso lists ${active.length} active companies for this login — set ESPRESSO_COMPANY_ID`,
                { status: 503, apiCode: 'ESPRESSO_NOT_READY' });
        }
        companyId = active[0].id;
    }
    let routingProfileId = process.env.ESPRESSO_ROUTING_PROFILE_ID || '';
    // Pinned by id: the label (if pinned too) is what records and logs show
    let profileLabel = routingProfileId ? (ESPRESSO_DID_PROFILE || null) : null;
    if (!routingProfileId) {
        const all = (await restRoutingProfiles(companyId)).filter(p => p && p.type === 'did' && p.active !== false);
        const did = all.filter(p => p.id);
        const pin = ESPRESSO_DID_PROFILE.trim().toLowerCase();
        const pick = pin ? did.find(p => String(p.label || '').trim().toLowerCase() === pin)
            : (did.length === 1 ? did[0] : null);
        // espresso can list a profile without its id (seen 2026-10-23): an
        // order needs the id, so say exactly that
        const idless = all.filter(p => !p.id).map(p => p.label);
        if (!pick && idless.length) {
            throw espressoRestError(`espresso lists DID routing profile(s) without an id: ${idless.join(', ')} — `
                + 'ask espresso to expose the id, or set ESPRESSO_ROUTING_PROFILE_ID', { status: 503, apiCode: 'ESPRESSO_NOT_READY' });
        }
        if (!pick) {
            throw espressoRestError(`Routing profile "${ESPRESSO_DID_PROFILE || '(not pinned)'}" not found among active DID profiles: `
                + (did.map(p => p.label).join(', ') || 'none'), { status: 503, apiCode: 'ESPRESSO_NOT_READY' });
        }
        routingProfileId = pick.id;
        profileLabel = pick.label;
    }
    restAccount = { companyId, routingProfileId, profileLabel, at: Date.now() };
    return restAccount;
}

// ---- Inventory ----
const invFilter = (name, value, eq = '=') =>
    ({ category_name: name, category_operator: 'and', category_eq: eq, category_value: String(value) });

// The spec's defaults are odd (limit 0, offset 1024), so both are always sent.
// Documented as one object; a bare array or a {data:[…]} page parse too.
async function inventorySearch(filters, { limit = 50, offset = 0 } = {}) {
    const data = await espressoRest('POST', '/ws/v1/dids/inventory/search',
        { limit, offset, order_by: ['number asc'], filter: filters });
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.data)) return data.data;
    return data && data.number ? [data] : [];
}

// Free to sell: available, nobody's account, not vanity, Iristel's OCN
function inventoryRowFree(row) {
    return !!row && String(row.status || '').toLowerCase() === 'available' && !row.account
        && row.vanity !== true && (!row.ocn || String(row.ocn).toUpperCase() === ESPRESSO_OCN.toUpperCase());
}

// ---- Readiness ----
// Checked at startup and every 10 minutes; /api/config reports it so the
// pages can say "ordering is unavailable" up front instead of after payment.
//   pickReady — the inventory answers (the number picker works)
//   didReady  — that, plus the company and routing profile resolve and the
//               order collection answers
let espressoReadiness = { didReady: false, pickReady: false, checkedAt: 0, error: 'not checked yet' };
let readinessPending = null;

function checkEspressoReadiness() {
    if (readinessPending) return readinessPending;
    readinessPending = (async () => {
        const out = { didReady: false, pickReady: false, pickSource: ESPRESSO_PICK_SOURCE, checkedAt: Date.now(), error: null };
        let ordersOk = false;
        try {
            const { companyId } = await espressoRestAccount(true);
            // Orders are created and listed on the order collection, so it
            // must answer too (a misrouted collection blocks every order)
            await espressoRest('GET', `/ws/v1/dids/orders?${new URLSearchParams({ accountId: companyId, page: '1', size: '1' })}`);
            ordersOk = true;
        } catch (e) {
            out.error = e.message;
        }
        if (ESPRESSO_PICK_SOURCE === 'reserve') {
            // Picks come from the customer's own reservation, re-checked on
            // that order — inventory search isn't needed
            out.pickReady = out.didReady = ordersOk;
        } else {
            try {
                await inventorySearch([invFilter('status', 'available')], { limit: 1 });
                out.pickReady = true;
            } catch (e) {
                out.error = out.error || e.message;
            }
            // An order re-checks its picks in the inventory, so it needs both
            out.didReady = ordersOk && out.pickReady;
        }
        if (out.didReady !== espressoReadiness.didReady || out.pickReady !== espressoReadiness.pickReady) {
            console[out.didReady ? 'log' : 'warn']('[espresso] REST readiness — orders:', out.didReady ? 'ready' : 'NOT ready',
                '| picker:', out.pickReady ? 'ready' : 'NOT ready', out.error ? '| ' + out.error : '');
        }
        espressoReadiness = out;
        return out;
    })().finally(() => { readinessPending = null; });
    return readinessPending;
}

// ---- MIND, read-only ----
// Pick time and submit time look only: nothing is added to MIND until the
// numbers are bought. A number is free only when all three lookups agree —
// a service carrying it, the reserved pool, and the account lookup (the one
// that sees numbers held by wholesale accounts). Any error throws: an
// unclear answer is never "free".
async function mindPhoneAccountsStrict(number) {
    const digits = mindDigits(number);
    const r = await httpsRequest(`${BILLING_API_URL}/account-details-with-phone?telephoneNumber=${encodeURIComponent(digits)}`,
        { headers: { 'x-api-key': UBOSS_API_KEY, 'Accept': 'application/json' } });
    let data = null;
    try { data = JSON.parse(r.raw); } catch (e) {}
    if (r.status >= 200 && r.status < 300 && data && Array.isArray(data.accounts)) {
        if (data.accounts.length) {
            return data.accounts.map(a => ({ code: String(a.code || a.accountId || ''), product: (a.product && a.product.code) || null }));
        }
        if (data.isExist === false || /does not exist/i.test(String(data.message || ''))) return [];
    }
    const err = new Error(`MIND account lookup failed for ${digits} (HTTP ${r.status}): ${String(r.raw || '').slice(0, 200)}`);
    err.status = 502;
    throw err;
}

// Read-only calls are retried once when the answer never arrived
async function retryRead(fn) {
    try { return await fn(); }
    catch (e) {
        if (!/timeout|ECONNRESET|socket hang up|EAI_AGAIN|ETIMEDOUT/i.test(`${e.message} ${e.code || ''}`)) throw e;
        return fn();
    }
}

async function mindPickVerdict(number) {
    const [rows, inv, accounts] = await Promise.all([
        retryRead(() => mindNumberHolders(number)),
        retryRead(() => mindInventoryEntry(number)),
        retryRead(() => mindPhoneAccountsStrict(number))
    ]);
    if (rows.length) return { free: false, via: 'service' };
    if (inv) return { free: false, via: 'inventory' };
    if (accounts.length) return { free: false, via: 'account' };
    return { free: true };
}

// The picker re-shows the same numbers on a reload, so verdicts are cached
// briefly. Submit re-checks uncached.
const PICK_VERDICT_TTL_MS = 3 * 60 * 1000;
const pickVerdictCache = new Map(); // 11 digits → { at, verdict }

async function cachedPickVerdict(digits) {
    const hit = pickVerdictCache.get(digits);
    if (hit && Date.now() - hit.at < PICK_VERDICT_TTL_MS) return hit.verdict;
    const verdict = await mindPickVerdict(digits);
    pickVerdictCache.set(digits, { at: Date.now(), verdict });
    if (pickVerdictCache.size > 5000) pickVerdictCache.delete(pickVerdictCache.keys().next().value);
    return verdict;
}

// Numbers on other customers' open orders — bought or being bought, but not
// in MIND yet, so the MIND check can't see them
function numbersOnOpenOrders(exceptEmail) {
    const held = new Set();
    for (const [k, v] of Object.entries(orderStore)) {
        if (!k.startsWith('order:') || !v || v.status === 'done' || v.status === 'rejected') continue;
        if (exceptEmail && v.email === exceptEmail) continue;
        (v.requests || []).forEach(r => (r.dids || []).forEach(d => held.add(mindDigits(d))));
    }
    return held;
}

function shuffled(list) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = crypto.randomInt(i + 1);
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

// Numbers a customer can pick in a rate center: available in espresso and
// unknown to MIND. Walks the inventory a page at a time, MIND-checking a few
// at once, until `want` pass or PICK_MAX_CHECKS were tried. Shuffled within a
// page so two customers in the same rate center rarely see the same list.
const PICK_PAGE = 50;
const PICK_MAX_CHECKS = 200;
const PICK_CONCURRENCY = 5;

async function pickAvailableNumbers({ ratecenter, npa, want, exclude, email, fresh }) {
    const skip = new Set([...(exclude || []).map(mindDigits), ...numbersOnOpenOrders(normEmail(email))]);
    const filters = [invFilter('status', 'available'), invFilter('ratecenter', ratecenter),
        invFilter('prefix', `1${npa}`), invFilter('provider_code', ESPRESSO_OCN)];
    const verdictOf = fresh ? mindPickVerdict : cachedPickVerdict;
    const picked = [];
    let offset = 0, checked = 0, hidden = 0, failed = 0, lastError = null, exhausted = false, rowsSeen = 0, notFree = 0;
    while (picked.length < want && checked < PICK_MAX_CHECKS) {
        const rows = await inventorySearch(filters, { limit: PICK_PAGE, offset });
        offset += PICK_PAGE;
        rowsSeen += rows.length;
        const free = rows.filter(inventoryRowFree);
        notFree += rows.length - free.length;
        const candidates = shuffled(free.map(r => mindDigits(r.number))
            .filter(d => /^1\d{10}$/.test(d) && d.slice(1, 4) === String(npa) && !skip.has(d)));
        for (let i = 0; i < candidates.length && picked.length < want && checked < PICK_MAX_CHECKS; i += PICK_CONCURRENCY) {
            const batch = candidates.slice(i, i + Math.min(PICK_CONCURRENCY, PICK_MAX_CHECKS - checked));
            checked += batch.length;
            const verdicts = await Promise.all(batch.map(d => verdictOf(d).catch(e => ({ error: e }))));
            batch.forEach((d, j) => {
                const v = verdicts[j];
                if (v.error) { failed++; lastError = v.error; return; }
                if (!v.free) { hidden++; return; }
                if (picked.length < want) { picked.push(d); skip.add(d); }
            });
        }
        if (rows.length < PICK_PAGE) { exhausted = true; break; }
    }
    if (rowsSeen && rowsSeen === notFree) {
        console.warn('[espresso] inventory for', ratecenter, npa, '—', rowsSeen, 'rows, none sellable (status/account/vanity/OCN)');
    }
    // Nothing could be verified at all: MIND is down, not the rate center empty
    if (!picked.length && failed) {
        throw Object.assign(new Error(`MIND could not be checked (${failed} lookup(s) failed): ${lastError && lastError.message}`),
            { status: 503, apiCode: 'MIND_UNAVAILABLE' });
    }
    return {
        numbers: picked.map(tenDigits),
        exhausted: exhausted && picked.length < want,
        hidden, unverified: failed, checked
    };
}

// ---- Picking from a reservation (ESPRESSO_PICK_SOURCE=reserve) ----
// espresso's select-DIDs order reserves numbers for an hour without buying
// them. "Show available numbers" reserves a small batch for the customer,
// MIND checks it, and the picker shows what is free; Submit completes that
// same order with only the picked numbers (the rest are released when the
// reservation runs out). One reservation per customer and rate center.
const RESERVE_EXTRA = 2;                       // shown on top of what was asked
const RESERVE_MIN_LEFT_MS = 10 * 60 * 1000;    // older than this: reserve afresh
const RESERVE_WAIT_MS = 60 * 1000;             // reserving took ~25 s in the sandbox
const reservingNow = new Map();                // key → promise, so double clicks share one

const pickResKey = (email, ratecenter, npa) =>
    `pickres:${normEmail(email)}::${String(ratecenter).toUpperCase()}|${npa}`;
const reservedDids = order => (order.numbers || []).filter(n => n.status === 'RESERVED').map(n => mindDigits(n.did));
const reservationUsable = (order, minLeftMs) => !!(order && String(order.status).toUpperCase() === 'PENDING'
    && order.canComplete && order.reservationExpiresAt
    && Date.parse(order.reservationExpiresAt) - Date.now() > minLeftMs);

async function waitForReservation(id) {
    const t0 = Date.now();
    for (;;) {
        const o = await espressoRest('GET', `/ws/v1/dids/orders/${encodeURIComponent(id)}`);
        if (o.canComplete || /^(REJECTED|FAILED|EXPIRED|CANCELLED|COMPLETED)$/i.test(String(o.status))) return o;
        if (Date.now() - t0 > RESERVE_WAIT_MS) {
            // Release it rather than leave numbers held for an hour
            await espressoRest('POST', `/ws/v1/dids/orders/${encodeURIComponent(id)}/cancel`,
                { reason: 'Reservation took too long; the customer will retry' }).catch(() => {});
            throw busy(`espresso is still reserving numbers (order ${o.orderNumber}) — try again in a moment`);
        }
        await new Promise(r => setTimeout(r, 3000));
    }
}

async function createReservation({ accountRef, ratecenter, npa, quantity }) {
    const acct = await espressoRestAccount();
    const info = NPA_MIND_CITY[String(npa)];
    const filters = [{ categoryName: 'prefix', categoryValue: `1${npa}*` }];
    if (info) filters.unshift({ categoryName: 'ratecenter', categoryValue: `${String(ratecenter).toUpperCase()},${info.provinces[0]}` });
    const reference = `oo:${String(accountRef || 'na').replace(/[^\w-]/g, '').slice(0, 40)}:pick:${crypto.randomBytes(6).toString('hex')}`;
    const created = await espressoRest('POST', '/ws/v1/dids/orders', {
        accountId: acct.companyId, countryId: '1', ocn: ESPRESSO_OCN, vanity: false, selectDids: true,
        acquisitionType: 'PURCHASE', routingProfileId: acct.routingProfileId, reference,
        numberRequests: [{ quantity, filters }]
    });
    if (!created || !created.id) throw busy('espresso accepted the reservation but sent back no order id');
    console.log('[pick] reserving', quantity, 'in', ratecenter, npa, '→', created.orderNumber);
    return { order: await waitForReservation(created.id), reference };
}

// → { numbers: [10-digit], exhausted, hidden, unverified, checked, reservation }
async function reservePickBatch({ email, accountRef, ratecenter, npa, quantity, exclude }) {
    const key = pickResKey(email, ratecenter, npa);
    if (reservingNow.has(key)) return reservingNow.get(key);
    const work = (async () => {
        const skip = new Set((exclude || []).map(mindDigits));
        const rec = stateGet(key, { activeOnly: true });
        let order = null;
        if (rec && rec.orderId) {
            order = await espressoRest('GET', `/ws/v1/dids/orders/${encodeURIComponent(rec.orderId)}`).catch(() => null);
            const left = order ? reservedDids(order).filter(d => !skip.has(d)).length : 0;
            const holdsPicks = order ? reservedDids(order).some(d => skip.has(d)) : false;
            // Keep a reservation the customer already picked from on another
            // trunk — cancelling it would void those picks
            if (!reservationUsable(order, holdsPicks ? 0 : RESERVE_MIN_LEFT_MS) || (!holdsPicks && left < quantity)) {
                if (order && String(order.status).toUpperCase() === 'PENDING') {
                    await espressoRest('POST', `/ws/v1/dids/orders/${encodeURIComponent(order.id)}/cancel`,
                        { reason: 'Replaced by a new reservation for the same customer' }).catch(() => {});
                }
                order = null;
            }
        }
        let reference = rec && rec.reference;
        if (!order) {
            let made = await createReservation({ accountRef, ratecenter, npa, quantity: quantity + RESERVE_EXTRA });
            if (/^REJECTED$/i.test(made.order.status)) {
                made = await createReservation({ accountRef, ratecenter, npa, quantity });
            }
            order = made.order;
            reference = made.reference;
            if (!reservationUsable(order, 0)) {
                const why = order.rejectionReason || order.failureReason || {};
                console.warn('[pick] reservation', order.orderNumber, 'ended', order.status, why.code || '');
                if (/^REJECTED$/i.test(order.status)) {
                    return { numbers: [], exhausted: true, hidden: 0, unverified: 0, checked: 0, reservation: null };
                }
                throw busy(`espresso couldn't reserve numbers (${order.status}${why.code ? ' ' + why.code : ''})`);
            }
            stateSet(key, {
                email: normEmail(email), ratecenter: String(ratecenter).toUpperCase(), npa: String(npa),
                orderId: order.id, orderNumber: order.orderNumber, reference, expiresAt: order.reservationExpiresAt
            });
        }
        // Read-only MIND check of what was reserved, a few at a time
        const candidates = reservedDids(order).filter(d => !skip.has(d));
        const numbers = [];
        let hidden = 0, failed = 0, lastError = null;
        for (let i = 0; i < candidates.length; i += PICK_CONCURRENCY) {
            const batch = candidates.slice(i, i + PICK_CONCURRENCY);
            const verdicts = await Promise.all(batch.map(d => cachedPickVerdict(d).catch(e => ({ error: e }))));
            batch.forEach((d, j) => {
                const v = verdicts[j];
                if (v.error) { failed++; lastError = v.error; } else if (!v.free) hidden++; else numbers.push(d);
            });
        }
        if (!numbers.length && failed) {
            throw Object.assign(new Error(`MIND could not be checked (${failed} lookup(s) failed): ${lastError && lastError.message}`),
                { status: 503, apiCode: 'MIND_UNAVAILABLE' });
        }
        return {
            numbers: numbers.map(tenDigits), exhausted: numbers.length < quantity,
            hidden, unverified: failed, checked: candidates.length,
            reservation: { orderNumber: order.orderNumber, expiresAt: order.reservationExpiresAt }
        };
    })().finally(() => reservingNow.delete(key));
    reservingNow.set(key, work);
    return work;
}

// The customer's reservation holding these picks, and which picks can no
// longer be had: not on a live reservation ('expired'), no longer reserved
// on it ('espresso') or held in MIND ('mind'). One reservation per order.
async function reservedPicksCheck(picks, email) {
    const e = normEmail(email);
    const want = picks.map(mindDigits);
    const recs = Object.entries(orderStore)
        .filter(([k, v]) => k.startsWith('pickres:') && v && v.email === e && v.status !== 'done' && v.orderId);
    const orders = [];
    for (const [key, rec] of recs) {
        // Gone (404) means expired; any other failure is espresso being busy,
        // which must not strip the customer's picks
        const order = await espressoRest('GET', `/ws/v1/dids/orders/${encodeURIComponent(rec.orderId)}`).catch(e => {
            if (e.espressoStatus === 404) return null;
            throw busy(`espresso couldn't read reservation ${rec.orderNumber} — ${e.message}`);
        });
        if (order) orders.push({ key, rec, order, held: new Set(reservedDids(order)) });
    }
    const owners = new Set();
    const unavailable = [];
    for (const d of want) {
        const own = orders.find(o => o.held.has(d) && reservationUsable(o.order, 0));
        if (!own) { unavailable.push({ number: tenDigits(d), reason: 'expired' }); continue; }
        owners.add(own);
    }
    if (owners.size > 1) {
        throw Object.assign(new Error('Picked numbers come from more than one reservation — pick them from one city'),
            { status: 400, apiCode: 'MULTIPLE_RESERVATIONS' });
    }
    const owner = [...owners][0] || null;
    for (const d of want) {
        if (unavailable.some(u => mindDigits(u.number) === d)) continue;
        const v = await mindPickVerdict(d).catch(err => {
            throw Object.assign(new Error(`MIND could not be checked for ${d}: ${err.message}`), { status: 503, apiCode: 'MIND_UNAVAILABLE' });
        });
        pickVerdictCache.set(d, { at: Date.now(), verdict: v });
        if (!v.free) unavailable.push({ number: tenDigits(d), reason: 'mind', via: v.via });
    }
    return { owner, unavailable };
}

// ---- MIND city for a rate center ----
// Numbers are added to MIND under a city, and MIND has no city for many
// espresso rate centers (CHATHAM among them). Resolution, per rate center:
//   1. a MIND city of the same name (in the NPA's province)
//   2. a nearby city from MIND_CITY_ALIASES
//   3. the NPA's default city from NPA_MIND_CITY
// Every city named below exists in MIND's list (checked 2026-10-20).
const NPA_MIND_CITY = [
    [['416', '437', '647', '942'], 'TORONTO', ['ON']],
    [['905', '289', '365', '742'], 'HAMILTON', ['ON']],
    [['519', '226', '548', '382'], 'LONDON', ['ON']],
    [['613', '343', '753'], 'CARLETON', ['ON']],
    [['705', '249', '683'], 'SUDBURY', ['ON']],
    [['807'], 'THUNDER BAY', ['ON']],
    [['514', '438', '263'], 'MONTREAL', ['QC']],
    [['450', '579', '354'], 'LONGUEUIL', ['QC']],
    [['418', '581', '367'], 'QUEBEC', ['QC']],
    [['819', '873', '468'], 'SHERBROOKE', ['QC']],
    [['204', '431', '584'], 'WINNIPEG', ['MB']],
    [['306', '639', '474'], 'REGINA', ['SK']],
    [['403', '587', '825', '368'], 'CALGARY', ['AB']],
    [['780'], 'EDMONTON', ['AB']],
    [['604', '778', '236', '672'], 'VANCOUVER', ['BC']],
    [['250'], 'VICTORIA', ['BC']],
    [['902', '782'], 'HALIFAX', ['NS', 'PE']],
    [['506', '428'], 'MONCTON', ['NB']],
    [['709', '879'], "ST. JOHN'S", ['NL']],
    [['867'], 'WHITEHORSE', ['YT', 'NT', 'NU']]
].reduce((map, [npas, city, provinces]) => {
    npas.forEach(n => { map[n] = { city, provinces }; });
    return map;
}, {});

// Rate centers MIND has no city for → the nearest one it has
const MIND_CITY_ALIASES = {
    CHATHAM: 'WINDSOR'
};

const cityKey = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// The list is large and MIND is slow to send it (24 s seen on 2026-10-21),
// so it gets a longer timeout, and a failed hourly refresh keeps the last
// good copy — cities rarely change.
async function mindCities() {
    if (mindCitiesCache && mindCitiesCache.at > Date.now() - 3600000) return mindCitiesCache;
    let list = [], failure = null;
    try {
        const r = await retryRead(() => httpsRequest(`${BILLING_API_URL}/telephone-numbers/cities`,
            { headers: { 'iristelx-api-key': MIND_API_KEY, 'Accept': 'application/json' }, timeout: 60000 }));
        try { list = (JSON.parse(r.raw).cities || []).filter(c => c && c.city && c.id != null); } catch (e) {}
        if (!list.length) failure = `HTTP ${r.status}`;
    } catch (e) {
        failure = e.message;
    }
    if (list.length) {
        mindCitiesCache = { at: Date.now(), byKey: new Map(list.map(c => [cityKey(c.city), c])) };
        return mindCitiesCache;
    }
    if (mindCitiesCache) {
        console.warn('[mind] city list refresh failed (' + failure + ') — keeping the copy from',
            new Date(mindCitiesCache.at).toISOString());
        return mindCitiesCache;
    }
    // Never had one: nothing to fall back on, and nothing is cached
    throw Object.assign(new Error(`MIND city list unavailable: ${failure}`), { status: 503, apiCode: 'MIND_UNAVAILABLE' });
}

// → { id, city, via: 'exact' | 'alias' | 'npa' }, or null when nothing fits
async function resolveMindCity({ ratecenter, npa }) {
    const { byKey } = await mindCities();
    const info = NPA_MIND_CITY[String(npa)] || null;
    const fits = c => !info || !c.province || info.provinces.includes(String(c.province).toUpperCase());
    const exact = ratecenter && byKey.get(cityKey(ratecenter));
    if (exact && fits(exact)) return { id: exact.id, city: exact.city, via: 'exact' };
    const alias = ratecenter && MIND_CITY_ALIASES[cityKey(ratecenter)];
    const aliased = alias && byKey.get(cityKey(alias));
    if (aliased && fits(aliased)) return { id: aliased.id, city: aliased.city, via: 'alias' };
    const fallback = info && byKey.get(cityKey(info.city));
    return fallback ? { id: fallback.id, city: fallback.city, via: 'npa' } : null;
}

// ---- Orders ----
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// REST orders are referred to by UUID or ORD-…; anything else is a SOAP order
const isLegacyOrderRef = ref => !UUID_RE.test(ref) && !/^ORD-/i.test(ref);

// The order: record for an espresso order id or ORD- number
function findOrderRecord(ref) {
    for (const [key, v] of Object.entries(orderStore)) {
        if (key.startsWith('order:') && v && (v.orderId === ref || v.orderNumber === ref)) return { key, rec: v };
    }
    return null;
}

// Recent orders, newest-updated first — used to find an order by its
// reference or ORD- number when the store doesn't have it
async function recentRestOrders(match, pages = 3) {
    const { companyId } = await espressoRestAccount();
    for (let page = 1; page <= pages; page++) {
        const q = new URLSearchParams({ accountId: companyId, page: String(page), size: '50' });
        const r = await espressoRest('GET', `/ws/v1/dids/orders?${q}`);
        const rows = (r && Array.isArray(r.data)) ? r.data : [];
        const hit = rows.find(match);
        if (hit) return hit;
        if (rows.length < 50) break;
    }
    return null;
}

async function getRestOrder(ref) {
    let id = UUID_RE.test(ref) ? ref : null;
    if (!id) {
        const hit = findOrderRecord(ref);
        id = hit && hit.rec.orderId;
    }
    if (!id && /^ORD-/i.test(ref)) {
        const found = await recentRestOrders(o => o.orderNumber === ref);
        id = found && found.id;
    }
    if (!id) {
        throw espressoRestError(`Order ${ref} not found`, { status: 404, apiCode: 'ORDER_NOT_FOUND' });
    }
    return espressoRest('GET', `/ws/v1/dids/orders/${encodeURIComponent(id)}`);
}

// espresso status → what the status page acts on:
//   Completed   — numbers assigned
//   Rejected    — nothing bought; the customer can pick other numbers
//   NeedsReview — failed/expired, or ended with numbers assigned: stop and
//                 let ops look (never send the customer to buy again)
//   Processing  — still going
function mapRestOrderStatus(order) {
    const assigned = (order.numbers || []).filter(n => n.status === 'ASSIGNED').map(n => tenDigits(n.did));
    const reason = order.rejectionReason || order.failureReason || null;
    const base = {
        orderId: order.id, orderNumber: order.orderNumber, espressoStatus: order.status,
        reason: reason ? reason.message || reason.code || null : null, assigned
    };
    switch (String(order.status || '').toUpperCase()) {
        case 'COMPLETED':
            return { ...base, status: 'Completed', statusText: 'Your numbers are assigned' };
        case 'REJECTED':
        case 'CANCELLED':
            return assigned.length
                ? { ...base, status: 'NeedsReview', statusText: 'Our team is reviewing your number order' }
                : { ...base, status: 'Rejected', statusText: 'Some numbers are no longer available' };
        case 'FAILED':
        case 'EXPIRED':
            return { ...base, status: 'NeedsReview', statusText: 'Our team is reviewing your number order' };
        case 'PROCESSING':
            return { ...base, status: 'Processing', statusText: 'Assigning your numbers' };
        default:
            return { ...base, status: 'Processing', statusText: 'Reserving your numbers' };
    }
}

// Numbers by request position, from numberRequestId → numberRequests[].index
function numbersByRequest(order, statuses) {
    const indexOf = new Map((order.numberRequests || []).map(r => [r.id, r.index]));
    const groups = new Map();
    for (const n of order.numbers || []) {
        if (statuses && !statuses.includes(n.status)) continue;
        const idx = indexOf.has(n.numberRequestId) ? indexOf.get(n.numberRequestId) : null;
        if (!groups.has(idx)) groups.set(idx, []);
        groups.get(idx).push(tenDigits(n.did));
    }
    return [...groups.entries()].map(([index, dids]) => ({ index, dids }));
}

// Which picked numbers can no longer be had — gone from espresso's
// inventory, held in MIND, or on another customer's open order.
// → [{ number (10 digits), reason: 'espresso' | 'mind' | 'taken' }]
async function unavailablePicks(dids, email) {
    const others = numbersOnOpenOrders(normEmail(email));
    const out = [];
    let i = 0;
    const list = dids.map(mindDigits);
    await Promise.all(Array.from({ length: Math.min(4, list.length) }, async () => {
        while (i < list.length) {
            const d = list[i++];
            if (others.has(d)) { out.push({ number: tenDigits(d), reason: 'taken' }); continue; }
            const rows = await inventorySearch([invFilter('did', d)], { limit: 5 });
            const row = rows.find(x => mindDigits(x.number) === d);
            if (!inventoryRowFree(row)) {
                out.push({ number: tenDigits(d), reason: 'espresso', espressoStatus: row ? row.status : 'not found' });
                continue;
            }
            const v = await mindPickVerdict(d).catch(e => {
                throw Object.assign(new Error(`MIND could not be checked for ${d}: ${e.message}`),
                    { status: 503, apiCode: 'MIND_UNAVAILABLE' });
            });
            pickVerdictCache.set(d, { at: Date.now(), verdict: v });
            if (!v.free) out.push({ number: tenDigits(d), reason: 'mind', via: v.via });
        }
    }));
    return out;
}

// Per-request problems of a REST order, by request position, with the
// picked numbers that are gone (goneDids) when recheck is on
async function restOrderProblems(order, rec, { recheck = true, email } = {}) {
    const reqs = (rec && rec.requests) || [];
    const reasons = new Map();
    for (const nr of order.numberRequests || []) if (nr.error) reasons.set(nr.index, nr.error);
    const rej = order.rejectionReason;
    if (rej) {
        const nr = (order.numberRequests || []).find(r => r.id === rej.numberRequestId);
        if (nr && !reasons.has(nr.index)) reasons.set(nr.index, rej);
        else if (!nr && !reasons.size) (order.numberRequests || []).forEach(r => reasons.set(r.index, rej));
    }
    const out = [];
    for (const [index, reason] of reasons) {
        const r = reqs[index] || {};
        const dids = (r.dids || []).map(tenDigits);
        let goneDids = null;
        if (recheck && dids.length) {
            goneDids = await unavailablePicks(dids, email || (rec && rec.email))
                .then(list => list.map(x => x.number))
                .catch(() => dids);  // can't tell — treat all as gone
        }
        out.push({
            index, trunk: r.trunk != null ? r.trunk : null, ratecenter: r.ratecenter || null, npa: r.npa || null,
            quantity: r.quantity || dids.length || null, dids, goneDids,
            code: reason.code || null, rejectReason: reason.message || reason.code || null
        });
    }
    if (!out.length && order.failureReason) {
        out.push({ index: null, code: order.failureReason.code || null, rejectReason: order.failureReason.message || null });
    }
    return out;
}

// Problems for whatever order a record holds — REST or legacy SOAP. Used by
// snag reports, so it never throws and never re-checks numbers.
async function orderProblemsFor(rec) {
    if (!rec) return [];
    if (rec.orderId) {
        try { return await restOrderProblems(await getRestOrder(rec.orderId), rec, { recheck: false }); }
        catch (e) { console.warn('[snag] could not fetch order problems for', rec.orderNumber, '-', e.message); return []; }
    }
    return rec.orderNumber ? getOrderProblems(rec.orderNumber) : [];
}

// ---- Placing an order ----
// Every request carries the customer's picked numbers (dids, 10 digits). A
// request with only a quantity (porting temp numbers, a page from before the
// picker) is picked here, with the same checks the picker runs. Then:
//   1. duplicate guard — the same submit again returns the existing order
//   2. re-check the picks: espresso still has them, MIND still doesn't — if
//      any are gone → 409 NUMBERS_UNAVAILABLE and nothing is bought
//   3. record "placing" with a reference, then create the order
// The create is never retried blindly: when its answer is lost, the order is
// looked up by its reference, so a retry can't buy the numbers twice.
const placingNow = new Set();            // emails with a create in flight here
const PLACING_STALE_MS = 2 * 60 * 1000;
const OPEN_ORDER_WINDOW_MS = 24 * 60 * 60 * 1000;

function publicOrder(rec) {
    return {
        orderId: rec.orderId || null, orderNumber: rec.orderNumber || null,
        status: rec.espressoStatus || null, profile: rec.profile || null,
        requests: (rec.requests || []).map(r => ({
            ratecenter: r.ratecenter, npa: r.npa, quantity: r.quantity, dids: r.dids || [],
            trunk: r.trunk != null ? r.trunk : null
        }))
    };
}

// Validates and normalizes the browser's requests. Picked numbers must be
// 10 digits in the request's area code, one per unit of quantity, and never
// picked twice across the whole order.
function normalizeOrderRequests(raw) {
    if (!Array.isArray(raw) || !raw.length) return { error: 'requests[] is required' };
    const seen = new Set();
    const out = [];
    for (const [i, r] of raw.entries()) {
        if (!r || !r.ratecenter || !/^\d{3}$/.test(String(r.npa || ''))) {
            return { error: 'each request needs ratecenter and a 3-digit npa' };
        }
        const req = {
            ratecenter: String(r.ratecenter).trim(), npa: String(r.npa),
            quantity: parseInt(r.quantity, 10) || 0, trunk: r.trunk != null ? r.trunk : null
        };
        if (Array.isArray(r.dids) && r.dids.length) {
            const dids = r.dids.map(tenDigits);
            if (dids.some(d => !/^\d{10}$/.test(d) || d.slice(0, 3) !== req.npa)) {
                return { error: `request ${i + 1}: every number must be 10 digits in area code ${req.npa}` };
            }
            if (req.quantity && req.quantity !== dids.length) {
                return { error: `request ${i + 1}: quantity ${req.quantity} but ${dids.length} number(s) picked` };
            }
            for (const d of dids) {
                if (seen.has(d)) return { error: `${d} is picked twice`, code: 'DUPLICATE_PICK', number: d };
                seen.add(d);
            }
            req.dids = dids;
            req.quantity = dids.length;
        } else if (req.quantity < 1 || req.quantity > 100) {
            return { error: `request ${i + 1}: quantity must be 1 to 100` };
        }
        out.push(req);
    }
    return { requests: out };
}

// Another order in flight for this customer — a different pick must not buy
// a second set of numbers while the first is still going
function otherOpenOrder(email, key) {
    for (const [k, v] of Object.entries(orderStore)) {
        if (k === key || !k.startsWith('order:') || !k.includes(`:${email}`) || !v) continue;
        if (v.status === 'done' || v.status === 'rejected') continue;
        const age = Date.now() - (v.updatedAt || v.createdAt || 0);
        // Only REST orders count: an old SOAP record (orderNumber, no
        // orderId) from before the switch must not block a new order
        if (v.status === 'placing' ? age > PLACING_STALE_MS : !v.orderId) continue;
        if (age > OPEN_ORDER_WINDOW_MS) continue;
        return v;
    }
    return null;
}

function adoptOrder(key, base, order) {
    const rec = stateSet(key, {
        ...base, status: 'active', orderId: order.id,
        orderNumber: order.orderNumber || order.id, espressoStatus: order.status || null
    });
    console.log('[order]', rec.orderNumber, `(${order.id})`, 'for', rec.email, '—',
        (rec.requests || []).map(r => `${r.ratecenter} ${r.npa}: ${(r.dids || []).join(',')}`).join(' | '));
    return publicOrder(rec);
}

// The browser-facing code for an espresso failure
function espressoApiCode(e) {
    if (e.apiCode) return e.apiCode;
    if (e.espressoStatus === 401 || e.espressoStatus === 403) return 'INVENTORY_FORBIDDEN';
    if (e.transport || e.espressoStatus >= 500 || e.espressoStatus === 409) return 'ESPRESSO_BUSY';
    return null;
}

const busy = (message, fields) => Object.assign(new Error(message), { status: 503, apiCode: 'ESPRESSO_BUSY' }, fields || {});

// Submit when picks come from a reservation: re-check them on the
// reservation and in MIND, then complete the reservation order with exactly
// those numbers — no new order. Called from placeDidOrder, inside its lock.
async function completeReservedOrder({ key, body, email, requests }) {
    const unpicked = requests.map((r, i) => (Array.isArray(r.dids) && r.dids.length ? -1 : i)).filter(i => i >= 0);
    if (unpicked.length) {
        return { status: 409, payload: { error: 'Pick the numbers first — every request needs its picked numbers', code: 'PICK_REQUIRED', indexes: unpicked } };
    }
    const picks = requests.flatMap(r => r.dids);
    const { owner, unavailable } = await reservedPicksCheck(picks, email);
    if (unavailable.length) {
        console.warn('[order]', email, '— picked numbers no longer available:', JSON.stringify(unavailable));
        reportServerError(email, 'did-unavailable',
            new Error(`${unavailable.length} picked number(s) no longer available — customer sent back to pick again`),
            { unavailable }, 'warning');
        return { status: 409, payload: { error: 'Some of the numbers you picked are no longer available', code: 'NUMBERS_UNAVAILABLE', unavailable } };
    }
    const acct = await espressoRestAccount();
    const id = owner.order.id;
    const base = {
        email, accountRef: body.accountRef || null, requests, reference: owner.rec.reference, api: 'rest',
        profile: acct.profileLabel, reservationOrderId: id,
        trunks: Array.isArray(body.trunks) ? body.trunks : null,
        businessName: body.businessName || null
    };
    stateSet(key, { ...base, status: 'placing' });
    let order = null;
    try {
        order = await espressoRest('POST', `/ws/v1/dids/orders/${encodeURIComponent(id)}/complete`, { numbers: picks.map(mindDigits) });
    } catch (e) {
        if (e.espressoCode === 'RESERVATION_EXPIRED') {
            stateSet(key, { ...base, status: 'rejected', error: e.message });
            stateSet(owner.key, { ...owner.rec, status: 'done' });
            return { status: 409, payload: {
                error: 'The reservation for your numbers ran out', code: 'NUMBERS_UNAVAILABLE',
                unavailable: picks.map(n => ({ number: tenDigits(n), reason: 'expired' }))
            } };
        }
        // No answer, or espresso busy: the order itself says what happened
        const o = await espressoRest('GET', `/ws/v1/dids/orders/${encodeURIComponent(id)}`).catch(() => null);
        if (o && /^(PROCESSING|COMPLETED)$/i.test(String(o.status))) {
            order = o;
        } else {
            reportServerError(email, 'did-order', e, { reservation: owner.rec.orderNumber, picks });
            const err = busy(`espresso didn't complete the reservation ${owner.rec.orderNumber} — ${e.message}`);
            err.reported = true;
            throw err;
        }
    }
    stateSet(owner.key, { ...owner.rec, status: 'done', completedAt: Date.now() });
    return { status: 200, payload: adoptOrder(key, base, order) };
}

async function placeDidOrder(body) {
    if (!body.email) return { status: 400, payload: { error: 'email is required' } };
    const email = normEmail(body.email);
    const norm = normalizeOrderRequests(body.requests);
    if (norm.error) {
        return { status: 400, payload: { error: norm.error, code: norm.code || 'INVALID_REQUEST', number: norm.number || null } };
    }
    const requests = norm.requests;

    // 1. Keyed on email + the shape as sent — before anything is auto-picked
    //    — so a retry of the same submit always finds the same record
    const key = K.order(email, requests);
    let seen = stateGet(key, { activeOnly: true });
    if (seen && seen.status === 'rejected') seen = null;
    // Backstop: a previous order that actually provisioned must not block this one
    if (seen && await sessionAlreadyProvisioned(email)) { markSessionDone(email); seen = null; }
    if (seen && (seen.orderId || seen.orderNumber)) {
        console.log('[order] duplicate suppressed for', key, '→', seen.orderNumber);
        return { status: 200, payload: { ...publicOrder(seen), duplicate: true } };
    }
    if (placingNow.has(email)) {
        return { status: 409, payload: { error: 'This order is already being placed', code: 'ORDER_IN_PROGRESS' } };
    }
    placingNow.add(email);
    try {
        if (seen && seen.status === 'placing' && seen.reservationOrderId) {
            // A completion whose answer never arrived: adopt the order once
            // espresso has moved it on; still waiting means complete it below
            const o = await espressoRest('GET', `/ws/v1/dids/orders/${encodeURIComponent(seen.reservationOrderId)}`).catch(() => null);
            if (o && /^(EXPIRED|CANCELLED|REJECTED)$/i.test(String(o.status))) {
                // Nothing was bought: the reservation lapsed — pick again
                stateSet(key, { ...seen, status: 'rejected' });
                return { status: 409, payload: {
                    error: 'The reservation for your numbers ran out', code: 'NUMBERS_UNAVAILABLE',
                    unavailable: (seen.requests || []).flatMap(r => r.dids || []).map(n => ({ number: tenDigits(n), reason: 'expired' }))
                } };
            }
            if (o && !/^PENDING$/i.test(String(o.status))) return { status: 200, payload: adoptOrder(key, seen, o) };
        } else if (seen && seen.status === 'placing') {
            // A create whose answer never arrived — adopt it if espresso has it
            const found = await recentRestOrders(o => o.reference === seen.reference).catch(() => null);
            if (found) {
                const full = await espressoRest('GET', `/ws/v1/dids/orders/${encodeURIComponent(found.id)}`).catch(() => found);
                return { status: 200, payload: adoptOrder(key, seen, full) };
            }
            if (Date.now() - (seen.updatedAt || 0) < PLACING_STALE_MS) {
                return { status: 409, payload: { error: 'This order is already being placed', code: 'ORDER_IN_PROGRESS' } };
            }
        }
        const other = otherOpenOrder(email, key);
        if (other) {
            return { status: 409, payload: {
                error: other.orderNumber ? `Order ${other.orderNumber} is still in progress for this account`
                    : 'An order is still in progress for this account',
                code: 'ORDER_IN_PROGRESS', orderNumber: other.orderNumber || null, orderId: other.orderId || null
            } };
        }

        // Every number is stored in MIND under a city — settle it now, not
        // after the numbers are bought
        for (const [index, r] of requests.entries()) {
            const city = await resolveMindCity({ ratecenter: r.ratecenter, npa: r.npa });
            if (!city) {
                return { status: 422, payload: {
                    error: `No MIND city for ${r.ratecenter} (${r.npa})`, code: 'NO_MIND_CITY',
                    index, ratecenter: r.ratecenter, npa: r.npa
                } };
            }
            r.mindCityId = city.id;
            r.mindCity = city.city;
        }

        // Picks from the customer's reservation: complete that order with them
        if (ESPRESSO_PICK_SOURCE === 'reserve') return await completeReservedOrder({ key, body, email, requests });

        // Quantity-only requests are picked here, checked uncached
        const chosen = requests.flatMap(r => r.dids || []);
        const shortfalls = [];
        for (const [index, r] of requests.entries()) {
            if (r.dids) continue;
            const got = await pickAvailableNumbers({ ratecenter: r.ratecenter, npa: r.npa, want: r.quantity, exclude: chosen, email, fresh: true });
            if (got.numbers.length < r.quantity) {
                shortfalls.push({ index, ratecenter: r.ratecenter, npa: r.npa, wanted: r.quantity, found: got.numbers.length });
                continue;
            }
            r.dids = got.numbers;
            r.autoPicked = true;
            chosen.push(...got.numbers);
        }
        if (shortfalls.length) {
            return { status: 409, payload: { error: 'Not enough numbers available', code: 'NUMBERS_UNAVAILABLE', unavailable: [], shortfalls } };
        }

        // 2. The customer's picks may have gone since they were shown
        const picks = requests.filter(r => !r.autoPicked).flatMap(r => r.dids);
        const unavailable = picks.length ? await unavailablePicks(picks, email) : [];
        if (unavailable.length) {
            console.warn('[order]', email, '— picked numbers no longer available:', JSON.stringify(unavailable));
            reportServerError(email, 'did-unavailable',
                new Error(`${unavailable.length} picked number(s) no longer available — customer sent back to pick again`),
                { unavailable }, 'warning');
            return { status: 409, payload: {
                error: 'Some of the numbers you picked are no longer available', code: 'NUMBERS_UNAVAILABLE', unavailable
            } };
        }

        // 3. Create
        const acct = await espressoRestAccount();
        const reference = `oo:${String(body.accountRef || 'na').replace(/[^\w-]/g, '').slice(0, 40)}:${crypto.randomBytes(6).toString('hex')}`;
        const base = {
            email, accountRef: body.accountRef || null, requests, reference, api: 'rest', profile: acct.profileLabel,
            // Snapshot of the trunk layout so a customer returning on another
            // device can be put back where they were
            trunks: Array.isArray(body.trunks) ? body.trunks : null,
            businessName: body.businessName || null
        };
        stateSet(key, { ...base, status: 'placing' });
        const createBody = {
            accountId: acct.companyId, countryId: '1', ocn: ESPRESSO_OCN, vanity: false, selectDids: false,
            acquisitionType: 'PURCHASE', routingProfileId: acct.routingProfileId, reference,
            numberRequests: requests.map(r => ({
                quantity: r.dids.length,
                filters: [{ categoryName: 'did', categoryValue: r.dids.map(mindDigits) }]
            }))
        };
        let order = null;
        try {
            order = await espressoRest('POST', '/ws/v1/dids/orders', createBody);
            if (!order || !order.id) {
                order = null;
                throw espressoRestError('espresso accepted the order but sent back no order id', { apiCode: 'ESPRESSO_BAD_RESPONSE' });
            }
        } catch (e) {
            // No answer, or a server error: the order may exist anyway
            const ambiguous = !!(e.transport || e.apiCode === 'ESPRESSO_BAD_RESPONSE'
                || (e.espressoStatus >= 500 && e.espressoCode !== 'ACCOUNT_MAPPING_UNAVAILABLE'));
            if (ambiguous) {
                const found = await recentRestOrders(o => o.reference === reference).catch(() => null);
                if (found) {
                    order = await espressoRest('GET', `/ws/v1/dids/orders/${encodeURIComponent(found.id)}`).catch(() => found);
                }
            }
            if (!order) {
                // Refused outright — nothing was created, so a new submit may go
                if (!ambiguous) stateSet(key, { ...base, status: 'rejected', error: e.message });
                reportServerError(email, 'did-order', e, { reference, ambiguous, requests: publicOrder(base).requests });
                const code = espressoApiCode(e);
                const err = (ambiguous || code === 'ESPRESSO_BUSY')
                    ? busy(ambiguous ? `espresso didn't confirm the order (reference ${reference}) — ${e.message}` : e.message)
                    : Object.assign(new Error(e.message), {
                        status: code === 'INVENTORY_FORBIDDEN' ? 503 : 502, apiCode: code || 'ESPRESSO_REJECTED'
                    });
                err.reported = true;
                throw err;
            }
        }
        return { status: 200, payload: adoptOrder(key, base, order) };
    } finally {
        placingNow.delete(email);
    }
}

// Keeps the order: record in step with espresso and raises the alerts a
// final status needs — once each
function noteOrderOutcome(order, mapped) {
    const hit = findOrderRecord(order.id) || findOrderRecord(order.orderNumber);
    if (!hit) return;
    const { key, rec } = hit;
    const patch = { ...rec, espressoStatus: order.status, updatedAt: Date.now() };
    if (mapped.status === 'Rejected' && rec.status !== 'done') patch.status = 'rejected';
    if (mapped.status === 'NeedsReview' && !rec.reviewReported) {
        patch.status = rec.status === 'done' ? 'done' : 'review';
        patch.reviewReported = true;
        recordSnag(rec.email, 'did-needs-review',
            `espresso order ${order.orderNumber} ended ${order.status}` + (mapped.reason ? ` (${mapped.reason})` : '')
            + ` with ${mapped.assigned.length} number(s) assigned. The customer was stopped — check the order in espresso `
            + 'before anything is re-ordered.',
            { source: 'server', context: {
                orderId: order.id, orderNumber: order.orderNumber, status: order.status,
                numbers: (order.numbers || []).map(n => ({ did: n.did, status: n.status })),
                failureReason: order.failureReason || null, rejectionReason: order.rejectionReason || null
            } }).catch(e => console.error('[SNAG] needs-review report failed -', e.message));
    }
    if (mapped.status === 'Completed' && !rec.completionChecked) {
        patch.completionChecked = true;
        const picked = new Set((rec.requests || []).flatMap(r => r.dids || []).map(tenDigits));
        const got = new Set(mapped.assigned);
        const missing = [...picked].filter(d => !got.has(d));
        const extra = [...got].filter(d => !picked.has(d));
        if (missing.length || extra.length) {
            reportServerError(rec.email, 'did-order-mismatch',
                new Error(`espresso order ${order.orderNumber} completed with different numbers than picked`),
                { orderId: order.id, missing, extra });
        }
    }
    if (patch.status !== rec.status || patch.espressoStatus !== rec.espressoStatus
        || patch.reviewReported !== rec.reviewReported || patch.completionChecked !== rec.completionChecked) {
        orderStore[key] = patch;
        saveOrderStore();
    }
}

// Ops alerts that could fire on every page view (MIND down, inventory
// refused) go out at most once per window
const snagThrottle = new Map();
function throttledServerError(throttleKey, windowMs, email, stage, err, context, severity) {
    if (Date.now() - (snagThrottle.get(throttleKey) || 0) < windowMs) return;
    snagThrottle.set(throttleKey, Date.now());
    reportServerError(email || 'unknown', stage, err, context, severity);
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
        // Same reasoning as the DID routing profile: a wrong one misroutes silently
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
const CHARGE_STORE_PATH = process.env.CHARGE_STORE_PATH
    || path.join(STATE_DIR, STATE_DIR === ROOT ? '.charge-store.json' : 'charge-store.json');

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

function getJson(url, headers) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, { headers: { ...headers, accept: 'application/json' }, agent: KEEPALIVE_AGENT, timeout: 45000 },
            res => {
                let data = '';
                res.on('data', c => data += c);
                res.on('end', () => {
                    if (res.statusCode < 200 || res.statusCode >= 300) {
                        return reject(new Error(`HTTP ${res.statusCode}`));
                    }
                    try { resolve(JSON.parse(data)); }
                    catch (e) { reject(new Error('unparseable response')); }
                });
            });
        req.on('timeout', () => req.destroy(new Error('request timeout')));
        req.on('error', reject);
    });
}

function postJson(url, headers, body, opts) {
    const o = opts || {};
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify(body);
        const req = https.request(url, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
            agent: KEEPALIVE_AGENT,
            timeout: o.timeout || 45000
        }, res => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => resolve({ status: res.statusCode, raw: data }));
        });
        req.on('timeout', () => req.destroy(Object.assign(new Error(o.timeoutMessage || 'payment gateway timeout'), { timedOut: true })));
        req.on('error', reject);
        req.end(payload);
    });
}

async function chargeBalance(body) {
    const { accountCode, amount, creditCard } = body;
    // Same account + same amount = the same charge, so a repeat is recognised
    // even from a browser that has forgotten everything.
    //
    // Scoped to the customer's CURRENT order: once an order is provisioned the
    // record is closed out, so buying a second trunk at the same price later is
    // charged normally instead of being mistaken for a duplicate and given away.
    const key = body.idempotencyKey || `${accountCode}::${Number(amount).toFixed(2)}`;
    // Charges recorded before the key carried the amount already paid
    // (`acct::amount`, the old pages) still count for a customer's first
    // charge — a success, or an attempt whose outcome is unknown, must not
    // be charged again just because the key format changed
    const legacy = key.match(/^(.+)::0\.00::(\d+\.\d{2})$/);
    const legacyKey = legacy ? `${legacy[1]}::${legacy[2]}` : null;
    if (legacyKey && chargeStore[legacyKey] && !chargeStore[key]) {
        chargeStore[key] = { ...chargeStore[legacyKey], migratedFrom: legacyKey };
    }

    if (body.email && chargeStore[key] && chargeStore[key].outcome === 'success'
        && await sessionAlreadyProvisioned(body.email)) {
        console.log('[charge] previous order is provisioned — this is a new purchase, not a duplicate');
        markSessionDone(body.email);
        delete chargeStore[key];
        saveChargeStore();
    }

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
    // Still in flight — a browser that lost its connection mid-charge must
    // not send the card through a second time
    if (seen && seen.outcome === 'pending') {
        const fresh = Date.now() - (seen.createdAt || 0) < 2 * 60 * 1000;
        const err = new Error(fresh
            ? `A payment for this amount is still being processed (reference ${seen.reference}). Wait a minute, then refresh the page.`
            : `A previous payment attempt for this amount never finished (reference ${seen.reference}). Do not retry — contact support to confirm whether it went through.`);
        err.status = 409; err.reference = seen.reference;
        throw err;
    }

    const reference = (seen && seen.reference) || ('IRS-BAL-' + Date.now().toString(36).toUpperCase());
    chargeStore[key] = { reference, outcome: 'pending', amount, accountCode, createdAt: Date.now() };
    saveChargeStore();

    let result;
    try {
        // MIND's UPDATED payment body — the first shape ever confirmed to
        // actually capture on the card (Postman-verified). adapterId is
        // numeric 3, issuer is hardcoded 'SBI' exactly as in the proven test,
        // and our reference rides in externalRefId.
        result = await postJson(`${BILLING_API_URL}/bot/${accountCode}/payment`,
            { 'x-api-key': PAYMENT_API_KEY },
            {
                amount: Number(amount).toFixed(2),
                currency: 'CAD',
                remark: 'Online Sip Trunk',
                creditCard: { ...creditCard, adapterId: 3, issuer: 'SBI', externalRefId: reference }
            });
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
        // Gateway reasons ("Purchase Transaction rejected: Invalid Route
        // Service") are for ops, not customers — log them, return a generic
        // message the customer can act on.
        console.error('[charge] declined', reference, accountCode, amount, '—',
            data.message || `HTTP ${result.status}`, detail);
        const err = new Error('Payment could not be completed. Please verify your card details and try again, or use a different card.');
        err.status = 402;
        throw err;
    }

    // Keep the gateway's own response: MIND returning 2xx is what we call
    // success, but whether a real card capture happened (and under which
    // Moneris transaction id) is only knowable from this payload.
    console.log('[charge] success', reference, accountCode, amount, '— gateway said:', result.raw.slice(0, 500));
    chargeStore[key] = { ...chargeStore[key], outcome: 'success', chargedAt: Date.now(), gatewayResponse: data };
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

// Asks MIND directly whether this email already has an account. MIND ignores
// query filters and returns every account, so the match is done here.
//
// This is the authoritative check, and the one that matters once real
// customers arrive: our own records can be wiped by a redeploy, and an account
// may have been created before this server existed or outside the flow
// entirely. Without it, a customer whose order failed would sign up again and
// end up with a second MIND account.
async function findMindAccountByEmail(email, { strict = false } = {}) {
    const target = normEmail(email);
    if (!target) return null;
    try {
        const r = await getJson(`${BILLING_API_URL}/accounts`, { 'iristelx-api-key': MIND_API_KEY });
        const list = (r && r.accounts) || [];
        const matches = list.filter(a =>
            a && a.contact && normEmail(a.contact.emailAddress) === target);
        if (!matches.length) return null;
        // Prefer an active account, then the most recently created
        matches.sort((a, b) =>
            (String(b.status) === 'ACTIVE') - (String(a.status) === 'ACTIVE')
            || String(b.createdOn || '').localeCompare(String(a.createdOn || '')));
        if (matches.length > 1) {
            console.warn('[account]', matches.length, 'MIND accounts share', target,
                '— using', matches[0].accountId);
        }
        return matches[0];
    } catch (e) {
        // A lookup failure must not block signup; the store still guards the
        // common case, and creating one extra account beats a dead end.
        // Sign-in is strict: a failed lookup is not "no account".
        if (strict) throw e;
        console.warn('[account] MIND lookup failed (continuing):', e.message);
        return null;
    }
}

// Only what a prefill or sign-in needs — not the full billing record
async function mindAccountSummary(accountId) {
    const r = await httpsRequest(`${BILLING_API_URL}/accounts/${encodeURIComponent(accountId)}`,
        { headers: { 'iristelx-api-key': MIND_API_KEY, 'Accept': 'application/json' } });
    let data = null;
    try { data = JSON.parse(r.raw); } catch (e) {}
    if (r.status < 200 || r.status >= 300 || !data) {
        const err = new Error((data && data.message) || `Account lookup failed (HTTP ${r.status})`);
        err.status = (r.status >= 400 && r.status) || 502;
        throw err;
    }
    return { contact: data.contact || null, language: data.language || null, name: data.name || null };
}

// MyIristel sign-in. There is no MyIristel sign-in API yet, so an email that
// has an Iristel (MIND) account is a MyIristel account: the same lookup signup
// uses (our records first, then MIND by email), except it never creates one.
// The password is not checked. Null when no account uses the email.
async function myIristelSignIn(email) {
    const key = K.account(email);
    let accountId = (stateGet(key) || {}).accountId;
    if (!accountId) {
        const found = await findMindAccountByEmail(email, { strict: true });
        if (!found || !found.accountId) return null;
        accountId = String(found.accountId);
        stateSet(key, { accountId, email: normEmail(email), foundInMind: true });
    }
    return { accountId: String(accountId), ...(await mindAccountSummary(accountId)) };
}

async function createAccount(email, contact, knownAccountId) {
    const key = K.account(email);
    const seen = stateGet(key);
    if (seen && seen.accountId) {
        console.log('[account] reusing', seen.accountId, 'for', normEmail(email));
        return { accountId: seen.accountId, reused: true };
    }

    // The browser already had an account id — from an earlier order, or from
    // signup. Adopt it rather than creating a second MIND account, and record
    // it so a later resume on another device knows the account exists. Without
    // this the mapping only ever got written when WE created the account, so a
    // returning customer's account step looked like it had never happened.
    //
    // Only when MIND says the account is this customer's: the id can be left
    // over from someone else who used the same browser, and adopting it put
    // the new customer's service on their account.
    if (knownAccountId) {
        const owner = await mindAccountSummary(knownAccountId)
            .then(s => normEmail(s.contact && s.contact.emailAddress), () => null);
        if (owner === normEmail(email)) {
            console.log('[account] adopting existing', knownAccountId, 'for', normEmail(email));
            stateSet(key, { accountId: String(knownAccountId), email: normEmail(email), adopted: true });
            return { accountId: String(knownAccountId), reused: true, adopted: true };
        }
        console.warn('[account] ignoring browser account', knownAccountId, 'for', normEmail(email),
            '— it belongs to', owner || '(lookup failed)');
    }

    // Nothing local — ask MIND before creating. This is what stops a customer
    // whose first order failed from getting a second account when they start
    // over from signup.
    const existing = await findMindAccountByEmail(email);
    if (existing && existing.accountId) {
        console.log('[account] found existing MIND account', existing.accountId, 'for', normEmail(email));
        stateSet(key, { accountId: String(existing.accountId), email: normEmail(email), foundInMind: true });
        return { accountId: String(existing.accountId), reused: true, foundInMind: true };
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
        // Without a product MIND gives the account its default Essentials
        // bundle; this flow only sells the SIP trunk
        product: { planCode: 'EXLNP_SBSIPTRNK' },
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
// MIND SERVICE CREATION
// ============================================
// The SIP trunk service used to be created client-side at plan-selection
// time, which minted a NEW service on every visit to the selection page.
// It now happens exactly once, server-side, after payment settles on the
// review page — guarded by the order store so retries and resumed sessions
// reuse the same service.
// A NEW service of this plan that MIND created on the account since `since`
// (with a minute's slack for clock skew) and that no customer record holds
async function findNewMindService(accountId, planCode, since) {
    const r = await httpsRequest(`${BILLING_API_URL}/accounts/${encodeURIComponent(accountId)}/services`,
        { headers: { 'iristelx-api-key': MIND_API_KEY, 'Accept': 'application/json' }, timeout: 60000 });
    const data = JSON.parse(r.raw);
    const list = Array.isArray(data) ? data : (data.services || []);
    const known = new Set(Object.entries(orderStore).filter(([k]) => k.startsWith('service:')).map(([, v]) => String(v && v.serviceId)));
    const fresh = list.filter(sv => String(sv.status || '').toUpperCase() === 'NEW'
        && (sv.planCode || (sv.provisioning && sv.provisioning.planCode)) === planCode
        && Date.parse(sv.createdOn) >= since - 60000
        && !known.has(String(sv.serviceId)))
        .sort((a, b) => Date.parse(b.createdOn) - Date.parse(a.createdOn));
    return fresh.length ? String(fresh[0].serviceId) : null;
}

async function createMindService(email, accountId, planCode, contact, businessName) {
    if (!accountId) throw new Error('accountId is required');
    const key = `service:${normEmail(email)}`;
    // activeOnly: a 'done' record belongs to a completed previous order —
    // a new purchase must mint a NEW service, not attach to the old one.
    const seen = stateGet(key, { activeOnly: true });
    if (seen && seen.serviceId) {
        console.log('[service] reusing service', seen.serviceId, 'for', normEmail(email));
        return { serviceId: seen.serviceId, reused: true };
    }

    const requestBody = {
        accountId: String(accountId),
        planCode: planCode || 'EXLNP_SBSIPTRNK',
        contact: {
            fname: contact.fname, lname: contact.lname,
            address1: contact.address1, city: contact.city,
            province: contact.province, country: contact.country,
            postalCode: contact.postalCode, emailAddress: contact.emailAddress || email,
            phone: contact.phone || ''
        }
    };
    // Without a name MIND calls the service after the contact ("John Erwin"),
    // so ops searching MIND for the business found nothing
    const name = String(businessName || '').trim().slice(0, 100);
    if (name) requestBody.name = name;
    const startedAt = Date.now();
    let r;
    try {
        r = await postJson(`${BILLING_API_URL}/accounts/${encodeURIComponent(accountId)}/services`,
            { 'iristelx-api-key': MIND_API_KEY }, requestBody, { timeout: 90000, timeoutMessage: 'MIND service creation timed out' });
    } catch (e) {
        // MIND can time out yet still create the service (seen 2026-10-21):
        // adopt the one it made instead of failing, so a retry can't add a
        // second service to the account
        const made = e.timedOut ? await findNewMindService(accountId, requestBody.planCode, startedAt).catch(() => null) : null;
        if (!made) throw e;
        stateSet(key, { email: normEmail(email), accountId: String(accountId), serviceId: made, adoptedAfterTimeout: true });
        console.warn('[service] create timed out — adopted service', made, 'that MIND created on account', accountId);
        return { serviceId: made, reused: false, adopted: true };
    }
    let data = null;
    try { data = JSON.parse(r.raw); } catch (e) {}
    if (r.status < 200 || r.status >= 300 || !data) {
        const err = new Error((data && data.message) || `Service creation failed (HTTP ${r.status})`);
        err.status = r.status >= 400 && r.status < 500 ? r.status : 502;
        throw err;
    }
    const serviceId = data.serviceId || data.id
        || (data.service && (data.service.serviceId || data.service.id));
    if (!serviceId) throw new Error('Service created but no id returned');
    stateSet(key, { email: normEmail(email), accountId: String(accountId), serviceId: String(serviceId) });
    console.log('[service] created', serviceId, 'on account', accountId, 'for', normEmail(email));
    return { serviceId: String(serviceId), reused: false };
}

// ============================================
// MIND SERVICE QUANTITIES — channels and DIDs, set once the customer has paid
// ============================================
// The SIP trunk service carries one billable line per channel
// (EXLNP_SBSIPTRNK) and one per DID (EXLNP_SBDID — every DID is billed, none
// comes with the trunk). Their quantities are set with
// PUT /accounts/{acct}/services/{svc}/quantity, from the order as placed —
// the same rule the review page priced it with (getTrunkBilling in
// js/sip-provisioning-common.js), so MIND bills what the customer was
// charged. Get Services and the add-on list don't carry quantities; the
// service journal (GET /accounts/{a}/services/{s}/log, field SRV_QUANTITY)
// is the only read-back. New lines start at quantity 1.
const SIP_QTY_CODES = { channels: 'EXLNP_SBSIPTRNK', dids: 'EXLNP_SBDID' };

// Channels and DIDs for the customer's current order: the newest in-flight
// order record's trunks, else the trunks the browser sent (an order that
// needed no DID order has no record).
function orderQuantities(email, fallbackTrunks) {
    const e = normEmail(email);
    let newest = null;
    for (const [k, v] of Object.entries(orderStore)) {
        if (!k.startsWith('order:') || !k.includes(`:${e}`) || !v || v.status === 'done' || v.status === 'rejected') continue;
        if (!newest || (v.createdAt || 0) > (newest.createdAt || 0)) newest = v;
    }
    const trunks = (newest && Array.isArray(newest.trunks) && newest.trunks.length) ? newest.trunks
        : (Array.isArray(fallbackTrunks) ? fallbackTrunks : []);
    let channels = 0, dids = 0;
    trunks.forEach(t => {
        channels += Math.max(1, parseInt(t.channels, 10) || 1);
        dids += (t.requests || []).reduce((s, r) => s + (parseInt(r.quantity, 10) || 0), 0)
            || (t.numbers || []).length;
    });
    return { channels, dids, trunks: trunks.length };
}

// The billable lines on a service, e.g. ['EXLNP_SBSIPTRNK', 'EXLNP_SBDID']
async function mindServiceLines(accountId, serviceId) {
    const r = await httpsRequest(
        `${BILLING_API_URL}/accounts/${encodeURIComponent(accountId)}/services/${encodeURIComponent(serviceId)}/add-on`,
        { headers: { 'iristelx-api-key': MIND_API_KEY, 'Accept': 'application/json' } });
    let d = null;
    try { d = JSON.parse(r.raw); } catch (e) {}
    if (r.status < 200 || r.status >= 300 || !d || !Array.isArray(d.services)) {
        throw new Error(`MIND service lines lookup failed (HTTP ${r.status}): ${String(r.raw || '').slice(0, 200)}`);
    }
    return d.services.map(s => String(s.code || ''));
}

async function putServiceQuantity(accountId, serviceId, serviceCode, quantity) {
    const payload = JSON.stringify({ serviceCode, quantity: String(quantity) });
    const r = await httpsRequest(
        `${BILLING_API_URL}/accounts/${encodeURIComponent(accountId)}/services/${encodeURIComponent(serviceId)}/quantity`,
        { method: 'PUT', headers: {
            'iristelx-api-key': MIND_API_KEY,
            'Content-Type': 'application/json', 'Accept': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
        } }, payload);
    let d = null;
    try { d = JSON.parse(r.raw); } catch (e) {}
    if (r.status < 200 || r.status >= 300 || !d || String(d.quantity) !== String(quantity)) {
        throw new Error(`MIND quantity update failed for ${serviceCode}=${quantity} (HTTP ${r.status}): ${String(r.raw || '').slice(0, 200)}`);
    }
    return d;
}

// Confirm the service's billable lines, then set each quantity. Idempotent:
// the same service with the same counts already set is a no-op. Throws when
// anything is left unset, with the partial result attached for the report.
async function setServiceQuantities(email, fallbackTrunks) {
    const e = normEmail(email);
    const svc = stateGet(`service:${e}`, { activeOnly: true });
    if (!svc || !svc.serviceId || !svc.accountId) throw new Error('No MIND service on file for this order');
    const q = orderQuantities(e, fallbackTrunks);
    if (!q.trunks) throw new Error('No trunks on file to take the channel/DID counts from');

    const key = `svcqty:${e}`;
    const seen = stateGet(key, { activeOnly: true });
    // A record from before every DID was billed (it has extraDids) is redone
    if (seen && seen.complete && seen.serviceId === svc.serviceId && seen.channels === q.channels && seen.dids === q.dids
        && !('extraDids' in seen)) {
        return { ...seen, reused: true };
    }

    const lines = await mindServiceLines(svc.accountId, svc.serviceId);
    const result = { serviceId: svc.serviceId, accountId: svc.accountId, channels: q.channels, dids: q.dids,
        lines, set: {}, problems: [] };
    for (const [what, code] of Object.entries(SIP_QTY_CODES)) {
        const qty = q[what];
        if (!lines.includes(code)) {
            // A missing line only matters when there is something to bill on it
            if (qty) result.problems.push(`service ${svc.serviceId} has no ${code} line`);
            continue;
        }
        // Written even when 0 (MIND accepts it), so neither MIND's default
        // nor an earlier, higher count — e.g. before the customer reselected
        // fewer numbers — is left standing
        try {
            const d = await putServiceQuantity(svc.accountId, svc.serviceId, code, qty);
            result.set[code] = { quantity: qty, line: d.servId || null };
        } catch (err) {
            result.problems.push(err.message);
        }
    }
    result.complete = result.problems.length === 0;
    stateSet(key, { email: e, ...result });
    console.log('[mind] quantities for service', svc.serviceId, '— channels', q.channels, 'DIDs', q.dids,
        result.complete ? 'set' : 'INCOMPLETE: ' + result.problems.join('; '));
    if (!result.complete) {
        const err = new Error('Channel/DID quantities not fully set: ' + result.problems.join('; '));
        err.result = result;
        throw err;
    }
    return result;
}

// Accounts are created with status NEW; once the order has fully provisioned
// the account (and its SIP trunk service) are flipped to ACTIVE via
// PATCH /accounts/{id} and PATCH /accounts/{id}/services/{id}. Best-effort:
// a failure here must never fail the completion call, only log.
async function patchMindStatus(path, label) {
    const payload = JSON.stringify({ status: 'ACTIVE' });
    const r = await httpsRequest(`${BILLING_API_URL}${path}`,
        { method: 'PATCH', headers: {
            'iristelx-api-key': MIND_API_KEY,
            'Content-Type': 'application/json', 'Accept': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
        } },
        payload);
    if (r.status < 200 || r.status >= 300) {
        throw new Error(`${label} activation failed (HTTP ${r.status}): ${r.raw.slice(0, 200)}`);
    }
}

async function activateMindStatuses(email) {
    const e = normEmail(email);
    const rec = stateGet(`service:${e}`) || {};
    const accountId = rec.accountId || (stateGet(`account:${e}`) || {}).accountId;
    if (!accountId) {
        console.warn('[mind] no accountId on file for', e, '— skipping status activation');
        return;
    }
    try {
        await patchMindStatus(`/accounts/${encodeURIComponent(accountId)}`, 'account');
        console.log('[mind] account', accountId, 'set ACTIVE for', e);
    } catch (err) {
        console.warn('[mind]', err.message);
    }
    if (rec.serviceId) {
        try {
            await patchMindStatus(
                `/accounts/${encodeURIComponent(accountId)}/services/${encodeURIComponent(rec.serviceId)}`,
                'service');
            console.log('[mind] service', rec.serviceId, 'set ACTIVE for', e);
        } catch (err) {
            console.warn('[mind]', err.message);
        }
    }
}

// ============================================
// MIND NUMBER ASSIGNMENT
// ============================================
// The espresso DID API has no notion of a customer — numbers are ordered into
// a routing profile on the company account — so nothing downstream tells MIND
// which service the numbers belong to. This is the missing link (per Shoam):
// PATCH /accounts/{accountId}/services/{serviceId}/telephone-number attaches
// a number (MSISDN) to the service so it shows on the account in MIND.
// Cities (Shivam's numeric ids) are cached for an hour by mindCities(); the
// id is required by the inventory add. resolveMindCity (espresso REST
// section) maps a rate center MIND has no city for to a nearby one.
let mindCitiesCache = null; // { at, byKey: Map<cityKey, city> }

// The order request a number was picked under, if any
function orderRequestForNumber(email, digits) {
    const e = normEmail(email);
    for (const [k, v] of Object.entries(orderStore)) {
        if (!k.startsWith('order:') || !k.includes(`:${e}`) || !v || v.status === 'rejected') continue;
        for (const r of v.requests || []) {
            if ((r.dids || []).some(d => mindDigits(d) === digits)) return r;
        }
    }
    return null;
}

// The MIND city a number goes in: the one resolved when it was ordered, else
// resolved now from its rate center and its own NPA. Fails closed — a number
// is never added to MIND without a city.
async function mindCityForNumber(email, number, ratecenterHint) {
    const digits = mindDigits(number);
    const req = orderRequestForNumber(email, digits);
    if (req && req.mindCityId != null) return { id: req.mindCityId, city: req.mindCity || null };
    const ratecenter = (req && req.ratecenter) || ratecenterHint || null;
    const city = await resolveMindCity({ ratecenter, npa: digits.slice(1, 4) });
    if (!city) {
        const err = new Error(`MIND has no city for ${ratecenter || 'this rate center'} (${digits.slice(1, 4)}) `
            + 'and no nearby city is mapped — add one to MIND_CITY_ALIASES or NPA_MIND_CITY');
        err.status = 502;
        throw err;
    }
    return city;
}

// Numbers must exist in the IristelX (MIND) database before they can be
// attached to a service — the PATCH 403s otherwise (per Shivam). Inventory
// add wants ranges: { start, end, cityId }. "Already exists" counts as done.
async function ensureNumbersInMindInventory(email, numbers, cityHint) {
    const key = `mindinv:${normEmail(email)}`;
    const seen = stateGet(key) || {};
    const added = new Set(seen.added || []);
    const pending = numbers.filter(n => !added.has(n));
    if (!pending.length) return { added: [...added], reused: true };

    let cityId = seen.cityId || null;
    for (const digits of pending) {
        // Each number goes in under its own request's city
        const city = await mindCityForNumber(email, digits, cityHint);
        cityId = city.id;
        // A number MIND already had is not this customer's to claim — it
        // stays out of `added`, which is what marks a number as ours
        if (await mindInventoryAdd(digits, city.id, city.city) === 'inserted') added.add(digits);
        else console.warn('[mind] inventory already had', digits, '— not recorded as this customer\'s');
    }
    stateSet(key, { email: normEmail(email), cityId, added: [...added] });
    return { added: [...added], reused: false };
}

// Adds one number to MIND's inventory (the *reserved* pool, per Shivam).
// The response is layered and comes back HTTP 200 either way:
//   - MIND:      "INSERTED IN MIND", or "NOT INSERTED IN MIND … already
//                exists" (code 3100) → the number is used by someone.
//   - IristelX DB: may add "NOT INSERTED IN THE DATABASE … ER_DUP_ENTRY" —
//                IGNORED: the lookups that ran before the add already catch
//                numbers that are in the pool, and MIND is what matters.
// MIND's layer is the verdict ('inserted' | 'exists'); anything else throws.
async function mindInventoryAdd(digits, cityId, cityName) {
    if (cityId == null) {
        const err = new Error(`MIND inventory add for ${digits} needs a city`);
        err.status = 502;
        throw err;
    }
    const entry = { start: digits, end: digits, cityId };
    const payload = JSON.stringify({ telephoneNumbers: [entry] });
    const r = await httpsRequest(`${BILLING_API_URL}/telephone-numbers`,
        { method: 'POST', headers: {
            'iristelx-api-key': MIND_API_KEY,
            'Content-Type': 'application/json', 'Accept': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
        } }, payload);
    let data = null;
    try { data = JSON.parse(r.raw); } catch (e) {}
    const errors = data && Array.isArray(data.errors) ? data.errors : [];
    const mindErrors = errors.filter(x => !/DATABASE|ER_DUP_ENTRY/i.test(JSON.stringify(x)));
    if ((r.status === 400 && /exist/i.test(r.raw || '')) || mindErrors.some(x => /exist/i.test(JSON.stringify(x)))) {
        return 'exists';
    }
    const inserted = (data && Array.isArray(data.telephoneNumbers) ? data.telephoneNumbers : [])
        .some(t => /INSERTED IN MIND/i.test(String(t && t.status || '')));
    if (r.status < 200 || r.status >= 300 || mindErrors.length || !inserted) {
        const err = new Error(`MIND inventory add failed for ${digits} (HTTP ${r.status}, city ${cityName || cityId}): `
            + String(r.raw || '').slice(0, 200));
        err.status = 502;
        throw err;
    }
    console.log('[mind] inventory added', digits, `(${cityName || 'city'} ${cityId})`);
    return 'inserted';
}

// Marks a number as added to MIND by this customer — i.e. theirs from now on
function rememberInventoryAdd(email, digits, cityId) {
    const key = `mindinv:${normEmail(email)}`;
    const seen = stateGet(key) || {};
    const added = new Set(seen.added || []);
    added.add(digits);
    stateSet(key, { ...seen, email: normEmail(email), cityId: seen.cityId || cityId, added: [...added] });
}

// MIND expects the 11-digit E.164-without-plus form (e.g. 12045551234)
function mindDigits(n) {
    const d = String(n).replace(/\D/g, '');
    return d.length === 10 ? '1' + d : d;
}

// Who already holds a number in MIND: one row per service carrying it, []
// when nobody does; row.code is that service's id. Only the 11-digit form
// matches — a 10-digit query silently comes back empty, i.e. a false "free".
// (The newer /account-details-with-phone misses SIP trunk services, so this
// is the lookup.) Fails closed: an unclear answer is never read as "free".
async function mindNumberHolders(number) {
    const digits = mindDigits(number);
    const r = await httpsRequest(`${BILLING_API_URL}/telephone-numbers/account-details/${encodeURIComponent(digits)}`,
        { headers: { 'iristelx-api-key': MIND_API_KEY, 'Accept': 'application/json' } });
    let rows = null;
    try { rows = JSON.parse(r.raw); } catch (e) {}
    if (r.status < 200 || r.status >= 300 || !Array.isArray(rows)) {
        const err = new Error(`MIND number lookup failed for ${digits} (HTTP ${r.status}): ${String(r.raw || '').slice(0, 200)}`);
        err.status = 502;
        throw err;
    }
    return rows;
}

// MIND's number inventory entry for a number, or null. This is where a
// trunk's EXTRA DIDs live: a service carries only one number (the primary),
// so the rest sit here — serviceId null, inUse false — and the service
// lookup above never sees them. Same 11-digit rule (a 10-digit fullNumber is
// a 400) and the same fail-closed handling.
async function mindInventoryEntry(number) {
    const digits = mindDigits(number);
    const r = await httpsRequest(`${BILLING_API_URL}/telephone-numbers/reserved?fullNumber=${encodeURIComponent(digits)}`,
        { headers: { 'iristelx-api-key': MIND_API_KEY, 'Accept': 'application/json' } });
    let data = null;
    try { data = JSON.parse(r.raw); } catch (e) {}
    if (r.status < 200 || r.status >= 300 || !data || !Array.isArray(data.telephoneNumbers)) {
        const err = new Error(`MIND inventory lookup failed for ${digits} (HTTP ${r.status}): ${String(r.raw || '').slice(0, 200)}`);
        err.status = 502;
        throw err;
    }
    return data.telephoneNumbers.find(t => mindDigits(t.telephoneNumber) === digits) || null;
}

// Which MIND account holds a number, per account-details-with-phone (the
// UBoss-gateway lookup Shivam listed as step 4). Returns [{code, product}]
// — account codes only, never names or contact details. Best-effort: used
// to enrich ops alerts and verify assignments, so a failure returns [].
async function mindPhoneAccounts(number) {
    try {
        const digits = mindDigits(number);
        const r = await httpsRequest(`${BILLING_API_URL}/account-details-with-phone?telephoneNumber=${encodeURIComponent(digits)}`,
            { headers: { 'x-api-key': UBOSS_API_KEY, 'Accept': 'application/json' } });
        const data = JSON.parse(r.raw);
        if (r.status < 200 || r.status >= 300 || !Array.isArray(data.accounts)) return [];
        return data.accounts.map(a => ({ code: String(a.code || a.accountId || ''), product: (a.product && a.product.code) || null }));
    } catch (e) {
        return [];
    }
}

// Is a number free to use for this customer's order?
//   taken — on someone else's service, in the inventory as an extra DID this
//           customer never added (another order's numbers 2..n), or known to
//           MIND in a state neither lookup shows (it refuses to add it)
//   ours  — only on this order's service / added to inventory by this
//           customer (a reload or resume after we linked it)
//   free  — MIND has never heard of it
// A number both lookups call free is then ADDED to the inventory (Shivam's
// step 1) — the add is the final word: MIND says "already exists" for
// numbers it holds in states no lookup returns (e.g. run 1's numbers sat on
// a wholesale account), and a successful add claims the number for this
// customer. Step 2: the add is confirmed by reading the pool back.
async function numberVerdict(email, number, serviceId, cityHint) {
    const [rows, inv] = await Promise.all([mindNumberHolders(number), mindInventoryEntry(number)]);
    if (!rows.length && !inv) {
        const digits = mindDigits(number);
        const city = await mindCityForNumber(email, digits, cityHint);
        const cityId = city.id;
        if (await mindInventoryAdd(digits, cityId, city.city) === 'exists') {
            return { verdict: 'taken', via: 'mind', holderServiceId: null, holderPlan: null };
        }
        // Shivam's step 2: Get Number — the pool must now show it
        if (!(await mindInventoryEntry(number))) {
            const err = new Error(`Number ${digits} was added to MIND but is not in the reserved pool`);
            err.status = 502;
            throw err;
        }
        rememberInventoryAdd(email, digits, cityId);
        return { verdict: 'free' };
    }
    const foreign = rows.find(r => !serviceId || String(r.code) !== String(serviceId));
    if (foreign) {
        return { verdict: 'taken', via: 'service', holderServiceId: String(foreign.code || ''), holderPlan: foreign.planCode || null };
    }
    if (inv && inv.serviceId && String(inv.serviceId) !== String(serviceId)) {
        return { verdict: 'taken', via: 'inventory', holderServiceId: String(inv.serviceId), holderPlan: null };
    }
    if (inv && !inv.serviceId) {
        const added = (stateGet(`mindinv:${normEmail(email)}`) || {}).added || [];
        if (!added.includes(mindDigits(number))) {
            return { verdict: 'taken', via: 'inventory', holderServiceId: null, holderPlan: null };
        }
    }
    return { verdict: rows.length || inv ? 'ours' : 'free' };
}

// The gate before a delivered number goes anywhere (MIND, UBoss), and the
// step that stores the numbers in MIND. Numbers were checked when picked and
// again at submit, so a taken one here is a rare race: it is listed under
// didrelease: and reported once for ops. Only the holder's service id and
// plan are kept: the rows also carry the other customer's contact details.
async function checkNumbersInMind(email, numbers, serviceId, cityHint) {
    const e = normEmail(email);
    const lookups = await Promise.all(numbers.map(async n => ({ number: n, ...(await numberVerdict(e, n, serviceId, cityHint)) })));
    const out = { free: [], ours: [], taken: [] };
    for (const { number, verdict, via, holderServiceId, holderPlan } of lookups) {
        if (verdict !== 'taken') { out[verdict].push(number); continue; }
        const entry = { number, via, holderServiceId, holderPlan };
        // Name the holding MIND account in the ops alert where we can
        if (via === 'mind') entry.holders = await mindPhoneAccounts(number);
        out.taken.push(entry);
        flagTakenNumber(e, entry);
    }
    console.log('[mind] number check for', e, '— free:', out.free.length, 'ours:', out.ours.length, 'taken:', out.taken.length);
    return out;
}

// A number bought from espresso that MIND refuses — it passed the pick-time
// and submit-time checks, so something took it in between. Provisioning
// stops; it is listed under didrelease: and reported once for ops to resolve
// (free it in MIND, or disconnect it in the EspressoDID portal).
function flagTakenNumber(email, entry) {
    const releaseKey = `didrelease:${email}`;
    const release = (stateGet(releaseKey) || {}).numbers || [];
    if (release.some(x => mindDigits(x.number) === mindDigits(entry.number))) return;  // already reported
    stateSet(releaseKey, { email, numbers: [...release, { ...entry, at: new Date().toISOString() }] });
    const holders = (entry.holders || []).map(h => `${h.code}${h.product ? ' (' + h.product + ')' : ''}`).join(', ');
    const where = entry.via === 'service'
        ? `is already on MIND service ${entry.holderServiceId} (plan ${entry.holderPlan || 'unknown'})`
        : entry.via === 'mind'
            ? (holders ? `is already held by MIND account ${holders}`
                : 'is already known to MIND (it refuses to add or attach it — held or recently released)')
            : entry.holderServiceId
                ? `is already in MIND's number inventory, attached to service ${entry.holderServiceId}`
                : "is already in MIND's number inventory (an extra DID on another order)";
    recordSnag(email, 'mind-tn-taken',
        `Number ${entry.number} ${where}. It was bought from espresso but MIND refused it, so provisioning `
        + 'for this order is halted. Resolve it in MIND, or disconnect it in the EspressoDID portal (DID Disconnect) '
        + 'and place a new order for the customer.',
        { source: 'server', severity: 'error', context: entry })
        .catch(err => console.error('[SNAG] taken-number report failed -', err.message));
}

// espresso ratecenter of the customer's current order — doubles as the MIND
// city name. The newest in-flight order wins: a rejected or finished order
// from earlier may still be on file under another rate center.
function orderRatecenter(email) {
    const e = normEmail(email);
    let best = null;
    for (const [k, v] of Object.entries(orderStore)) {
        if (!k.startsWith('order:') || !k.includes(`:${e}`) || !v || v.status === 'rejected') continue;
        const req0 = (v.requests || [])[0];
        if (!req0 || !req0.ratecenter) continue;
        const rank = [v.status !== 'done' ? 1 : 0, v.createdAt || 0];
        if (!best || rank[0] > best.rank[0] || (rank[0] === best.rank[0] && rank[1] > best.rank[1])) {
            best = { rank, ratecenter: req0.ratecenter };
        }
    }
    return best && best.ratecenter;
}

async function assignNumbersToMindService(email, serviceId, accountId, numbers, cityHint) {
    if (!serviceId) throw new Error('serviceId is required');
    if (!accountId) throw new Error('accountId is required');
    if (!numbers || !numbers.length) throw new Error('no numbers to assign');

    const key = `mindassign:${normEmail(email)}`;
    const seen = stateGet(key);
    const wanted = numbers.slice().sort().join(',');
    if (seen && seen.serviceId === String(serviceId) && seen.numbers === wanted) {
        console.log('[mind] numbers already assigned to service', serviceId, '— skipping');
        return { assigned: seen.assigned, serviceId, reused: true };
    }

    const normalized = numbers.map(mindDigits);

    // Never attach a number another customer's service already carries —
    // the status page checks first, but resume/catch-up calls land here too.
    const primary = normalized[0];
    if ((await numberVerdict(email, primary, serviceId, cityHint)).verdict === 'taken') {
        const err = new Error(`Number ${primary} is already held elsewhere in MIND — not attaching it`);
        err.takenNumber = primary;
        throw err;
    }

    // Shivam's step 1: ALL numbers go into the reserved pool — the primary
    // so it can be attached, the extra DIDs so a later order can't be
    // handed them ("if adding the same number again doesn't work, it means
    // the number is used by someone").
    await ensureNumbersInMindInventory(email, normalized, cityHint);

    // Step 2: Get Number — the primary must now sit in the pool, unattached
    // (or already on this service, for a resume)
    const pooled = await mindInventoryEntry(primary);
    if (pooled && pooled.serviceId && String(pooled.serviceId) !== String(serviceId)) {
        const err = new Error(`Number ${primary} is in the reserved pool on service ${pooled.serviceId} — not attaching it`);
        err.takenNumber = primary;
        throw err;
    }
    if (!pooled) console.warn('[mind] primary', primary, 'not visible in the reserved pool before attach — PATCH will decide');

    // Step 3: the service carries a single MSISDN, so only the PRIMARY
    // number (first in the list — callers put trunk.primaryNumber first)
    // is attached; the rest stay in the reserved pool against this unit.
    const payload = JSON.stringify({ telephoneNumber: primary });
    const r = await httpsRequest(
        `${BILLING_API_URL}/accounts/${encodeURIComponent(accountId)}/services/${encodeURIComponent(serviceId)}/telephone-number`,
        { method: 'PATCH', headers: {
            'iristelx-api-key': MIND_API_KEY,
            'Content-Type': 'application/json', 'Accept': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
        } },
        payload);
    if (r.status < 200 || r.status >= 300) {
        const err = new Error(`MIND telephone-number update failed for ${primary} (HTTP ${r.status}): ${r.raw.slice(0, 200)}`);
        // 10008 "no longer available": MIND holds the number in a state the
        // lookups don't show — it can't be this customer's, so it is taken
        if (/no longer available|"10008"|:10008\b/i.test(r.raw || '')) err.takenNumber = primary;
        throw err;
    }
    const assigned = [primary];
    console.log('[mind] assigned primary', primary, 'to service', serviceId, 'on account', accountId,
        normalized.length > 1 ? `(${normalized.length - 1} more in reserved pool)` : '');

    // Confirm the attach took. (a) The pool entry is the reliable signal:
    // it must now show inUse on this service. (b) Shivam's step 4 lookup is
    // recorded for evidence — what it returns for an attached SIP trunk
    // number is still being established, so it never blocks.
    let verify = null;
    try {
        const attached = e => !!(e && e.inUse && String(e.serviceId || '') === String(serviceId));
        let after = await mindInventoryEntry(primary);
        // The pool lags the PATCH by a few seconds (2026-10-21) — look again
        // before calling it unconfirmed
        if (!attached(after)) {
            await new Promise(r => setTimeout(r, 5000));
            after = await mindInventoryEntry(primary);
        }
        const confirmed = attached(after);
        const step4 = await mindPhoneAccounts(primary);
        verify = { confirmed, inUse: after ? after.inUse : null, poolServiceId: after ? after.serviceId : null, step4 };
        console.log('[mind] attach verify for', primary, '—', confirmed ? 'confirmed' : 'NOT confirmed',
            '| pool:', JSON.stringify(after && { inUse: after.inUse, serviceId: after.serviceId }),
            '| account-details-with-phone:', JSON.stringify(step4));
        if (!confirmed) {
            reportServerError(email, 'mind-assign-verify',
                new Error(`Primary ${primary} attached to service ${serviceId} but the reserved pool does not confirm it`),
                { primary, serviceId, accountId, pool: after, step4 }, 'warning');
        }
    } catch (e) {
        console.warn('[mind] attach verify failed for', primary, '-', e.message);
    }
    stateSet(key, { email: normEmail(email), accountId: String(accountId), serviceId: String(serviceId), numbers: wanted, assigned, verify });
    return { assigned, serviceId, reused: false };
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
const UBOSS_API_URL = process.env.UBOSS_API_URL || 'https://api.iristelx.com/uboss-robot';
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

// True when every provisioning job on file for this customer has completed —
// i.e. the previous order is finished and a new one is legitimate.
async function sessionAlreadyProvisioned(email) {
    const e = normEmail(email);
    const jobs = Object.entries(orderStore)
        .filter(([k, v]) => k.startsWith('provision:') && k.includes(`:${e}`) && v && v.jobId && v.status !== 'done')
        .map(([, v]) => v);
    if (!jobs.length) return false;
    const statuses = await Promise.all(jobs.map(j => ubossJobStatus(j.jobId)));
    return statuses.every(live => live && String(live.status || '').toLowerCase() === 'completed');
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
        // Fixed per environment, never taken from the browser: 'IRISTEL' in
        // production, the 'Demo Reseller' sandbox in test. (Customers do NOT
        // get their own reseller — that was briefly the case and is reverted.)
        resellerName: UBOSS_RESELLER_NAME,
        address: body.address,
        city: body.city,
        postcode: body.postcode,
        notificationEmail: body.notificationEmail,
        // Invoices go to the company's provisioning mailbox, never the
        // customer — hardcoded so the browser can't redirect them.
        invoiceEmail: 'provisioning@iristel.com',
        accountRef: body.accountRef,
        businessName: body.businessName,
        channelCount: body.channelCount,
        // UbossRobot sends the welcome letter to notificationEmail itself once
        // the job completes — replaces the manual POST /email/{jobId} step.
        sendWelcomeLetterToNotificationEmail: body.sendWelcomeLetterToNotificationEmail !== false,
        // Shown on the my.iristel dashboard. The service reference falls back
        // to the MIND service on file when the browser has lost it.
        location: String(body.location || '').trim(),
        serviceReference: String(body.serviceReference
            || (stateGet(`service:${normEmail(email)}`, { activeOnly: true }) || {}).serviceId || ''),
        planName: String(body.planName || 'SIP Trunk'),
        monthlyRecurringPrice: Number(body.monthlyRecurringPrice) || 0
    };

    const r = await postJson(`${UBOSS_API_URL}/trunk-provisioning`, { 'x-api-key': UBOSS_API_KEY }, requestBody);
    let data = null;
    try { data = JSON.parse(r.raw); } catch (e) {}
    if (r.status < 200 || r.status >= 300 || !data || !data.id) {
        const err = new Error((data && data.message) || `Provisioning failed to start (HTTP ${r.status})`);
        err.status = 502;
        throw err;
    }

    stateSet(key, {
        jobId: data.id, email: normEmail(email), phoneNumbers,
        trunkName: body.trunkName || null,
        channelCount: body.channelCount || null,
        attempts: ((seen && seen.attempts) || 0) + 1
    });
    return { jobId: data.id, reused: false, sipAuthenticationPassword: data.sipAuthenticationPassword };
}

// ============================================
// BUSINESS REGISTRATION DOCUMENT UPLOADS
// ============================================
// The legal document is required to weed out fraudulent signups and travels
// to Dynamics 365 with the rest of the order. Files live on the same disk as
// the stores; the pointer lives in the order store so it survives devices.
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(STATE_DIR, 'uploads');
// 5 MB — matches the Dynamics 365 org attachment limit (maxuploadfilesize);
// anything bigger would store here but fail to attach to the CRM contact.
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const UPLOAD_MIME_TYPES = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png' };

function saveBusinessDoc(email, filename, mimeType, base64Data) {
    if (!UPLOAD_MIME_TYPES[mimeType]) {
        const err = new Error('Only PDF, JPG or PNG documents are accepted');
        err.status = 400; throw err;
    }
    const buf = Buffer.from(base64Data, 'base64');
    if (!buf.length) { const err = new Error('Empty file'); err.status = 400; throw err; }
    if (buf.length > MAX_UPLOAD_BYTES) {
        const err = new Error('Document must be 10 MB or smaller'); err.status = 400; throw err;
    }
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    const safeName = String(filename || 'document').replace(/[^\w.-]/g, '_').slice(0, 80);
    const storedName = `${normEmail(email).replace(/[^\w.@-]/g, '_')}-${Date.now()}-${safeName}`;
    fs.writeFileSync(path.join(UPLOADS_DIR, storedName), buf);
    stateSet(K.bizdoc(email), {
        email: normEmail(email), filename: safeName, storedName,
        mimeType, size: buf.length
    });
    return { filename: safeName, size: buf.length };
}

function getBusinessDoc(email) {
    const rec = stateGet(K.bizdoc(email));
    if (!rec || !rec.storedName) return null;
    try {
        return { ...rec, data: fs.readFileSync(path.join(UPLOADS_DIR, rec.storedName)) };
    } catch (e) { return { ...rec, data: null }; }
}

// ============================================
// SNAG REPORTS — customer sees "we hit a snag", ops sees everything
// ============================================
// Every failure — reported by the browser (source 'client') or caught in an
// API route (source 'server') — persists here. GET /api/snags feeds the error
// dashboard (admin/errors.html, embedded in the partner portal); errors also
// email provisioning a short alert linking to it. Warnings are dashboard-only.
const SNAG_STORE_PATH = process.env.SNAG_STORE_PATH
    || path.join(STATE_DIR, STATE_DIR === ROOT ? '.snag-store.json' : 'snag-store.json');
let snagStore = [];
try { snagStore = JSON.parse(fs.readFileSync(SNAG_STORE_PATH, 'utf8')); } catch (e) { snagStore = []; }
// Reports from before the dashboard have no id/source/severity
snagStore.forEach(r => {
    if (!r.id) r.id = crypto.randomUUID();
    r.source = r.source || 'client';
    r.severity = r.severity || 'error';
    r.context = r.context || {};
});

// The system a failure belongs to — what the error dashboard and the alert
// email group by. The detailed stage stays alongside it. Decided by the
// stage's prefix, so a new stage lands in the right system on its own. The
// exceptions are named for where support has to look, not the step that
// noticed: both replacement DID orders (after a MIND-taken number, after a
// UBoss pool collision) are espresso orders, and "no numbers to provision"
// means the DID order's numbers never reached the trunk — UBoss was never
// called.
const ESPRESSO_STAGES = new Set(['mind-tn-replace', 'uboss-pool-retry', 'uboss-no-numbers']);
function snagSystem(stage) {
    const s = String(stage || '');
    if (ESPRESSO_STAGES.has(s)) return 'ESPRESSO';
    if (s.startsWith('mind-')) return 'MIND';
    if (s.startsWith('uboss-')) return 'UBOSS';
    if (s.startsWith('did-') || s.startsWith('espresso') || s.startsWith('lnp-')) return 'ESPRESSO';
    if (s.startsWith('payment')) return 'PAYMENT';
    if (s.startsWith('crm')) return 'CRM';
    return 'OTHER';
}

async function recordSnag(email, stage, detail, { source = 'client', severity = 'error', context = {} } = {}) {
    const e = normEmail(email);
    const report = {
        id: crypto.randomUUID(), at: new Date().toISOString(), email: e, stage, system: snagSystem(stage),
        source, severity, context, detail: String(detail || '').slice(0, 2000),
        account: null, orderNumber: null, orderId: null, numbers: [], provisionJobs: [], businessName: null,
        orderProblems: []
    };
    let orderRec = null;
    for (const [k, v] of Object.entries(orderStore)) {
        if (!k.includes(`:${e}`) || !v) continue;
        if (k.startsWith('account:')) report.account = v.accountId;
        // A rejected order counts only when there is no newer one
        else if (k.startsWith('order:') && (v.status !== 'rejected' || !orderRec)) {
            orderRec = v;
            report.orderNumber = v.orderNumber;
            report.orderId = v.orderId || null;
            report.numbers = [];
            report.businessName = v.businessName || report.businessName;
            (v.trunks || []).forEach(t => (t.numbers || []).forEach(n => report.numbers.push(n)));
        }
        else if (k.startsWith('provision:')) report.provisionJobs.push({ jobId: v.jobId, numbers: v.phoneNumbers });
    }
    // For espresso failures the reject reason is the actionable part
    if (report.orderNumber && /espresso|order|number/i.test(stage)) {
        report.orderProblems = await orderProblemsFor(orderRec);
    }
    snagStore.push(report);
    try {
        ensureStoreDir(SNAG_STORE_PATH);
        fs.writeFileSync(SNAG_STORE_PATH, JSON.stringify(snagStore), 'utf8');
    } catch (err) { console.error('[SNAG] report not persisted -', err.message); }
    console.error('[SNAG]', severity, e, '| stage:', stage, '| account:', report.account,
        '| order:', report.orderNumber, '| detail:', report.detail.slice(0, 200),
        report.orderProblems.length ? '| problems: ' + JSON.stringify(report.orderProblems) : '');
    // Fire-and-forget: the customer's flow never waits on (or fails with) email
    if (severity === 'error') sendSnagReport(report);
    return report;
}

// Server-side failures: recorded without ever delaying or changing the
// customer's response. 400s are input validation, not incidents.
function reportServerError(email, stage, err, context = {}, severity = 'error') {
    if (!email || (err && err.status === 400)) return;
    recordSnag(email, stage, (err && err.message) || String(err),
        { source: 'server', severity, context: { httpStatus: (err && err.status) || null, ...context } })
        .catch(e => console.error('[SNAG] server report failed -', e.message));
}

// For promise chains in routes: record, then rethrow so the API catch-all
// still sends the customer the same error response as before.
function reportAndRethrow(email, stage, context) {
    return err => { reportServerError(email, stage, err, context); throw err; };
}

// The partner-portal page that iframes admin/errors.html — Webflow has no
// env vars, so the link lives here.
const ERROR_DASHBOARD_URL = 'https://partner.iristel.com/dashboards/errors';
const errorDashboardLink = report => `${ERROR_DASHBOARD_URL}?id=${encodeURIComponent(report.id)}`;
const snagSubject = report =>
    `[SNAG] Online Sip Order — ${report.businessName || report.email} (${snagSystem(report.stage)}: ${report.stage})`;

// Prefer the Power Automate webhook (no Azure admin consent needed); the
// direct Graph path is the fallback once Mail.Send is ever granted.
function sendSnagReport(report) {
    if (SNAG_WEBHOOK_URL) return sendSnagWebhook(report);
    return sendSnagEmail(report);
}

// Power Automate: flow trigger "When an HTTP request is received" →
// "Send an email (V2)" to provisioning. The flow URL comes from env.
const SNAG_WEBHOOK_URL = process.env.SNAG_WEBHOOK_URL || '';

async function sendSnagWebhook(report) {
    try {
        const bodyStr = JSON.stringify({
            subject: snagSubject(report),
            body: snagEmailHtml(report),
            bodyText: snagEmailText(report),
            ...report
        });
        const r = await httpsRequest(SNAG_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) }
        }, bodyStr);
        if (r.status >= 200 && r.status < 300) {
            console.log('[SNAG mail] webhook accepted for', report.email);
        } else {
            console.error('[SNAG mail] webhook failed (HTTP ' + r.status + '):', r.raw.slice(0, 300));
        }
    } catch (err) {
        console.error('[SNAG mail] webhook failed -', err.message);
    }
}

// ============================================
// SNAG EMAIL — full report to provisioning via Microsoft Graph (Outlook).
// Uses the same Azure app registration as D365; requires the Mail.Send
// APPLICATION permission with admin consent on that app, and SNAG_MAIL_FROM
// must be a real M365 mailbox the app may send as.
// ============================================
const SNAG_MAIL_TO = 'provisioning@iristel.com';
const SNAG_MAIL_FROM = process.env.SNAG_MAIL_FROM || 'provisioning@iristel.com';

let graphToken = null; // { token, expiresAt }

async function graphGetToken() {
    if (graphToken && graphToken.expiresAt > Date.now() + 60000) return graphToken.token;
    const body = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: D365_CLIENT_ID,
        client_secret: D365_CLIENT_SECRET,
        scope: 'https://graph.microsoft.com/.default'
    }).toString();
    const r = await httpsRequest(`https://login.microsoftonline.com/${D365_TENANT_ID}/oauth2/v2.0/token`,
        { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } }, body);
    const data = JSON.parse(r.raw);
    if (!data.access_token) throw new Error('Graph auth failed: ' + (data.error_description || r.raw.slice(0, 200)));
    graphToken = { token: data.access_token, expiresAt: Date.now() + (data.expires_in || 3600) * 1000 };
    return graphToken.token;
}

// The email is just the alert — the full report (UBoss jobs, numbers, espresso
// problems, context) lives on the error dashboard it links to.
function snagEmailSummary(report) {
    const detail = String(report.detail || '');
    return {
        customer: report.businessName ? `${report.businessName} (${report.email})` : report.email,
        detail: detail.length > 200 ? detail.slice(0, 200) + '…' : detail
    };
}

function snagEmailText(report) {
    const { customer, detail } = snagEmailSummary(report);
    return [
        `A customer order hit a snag and needs follow-up within 2 hours.`,
        ``,
        `When:          ${report.at}`,
        `Customer:      ${customer}`,
        `Order number:  ${report.orderNumber || '--'}`,
        `Failed stage:  ${snagSystem(report.stage)} (${report.stage})`,
        `Error:         ${detail || '--'}`,
        ``,
        `Full details in the error dashboard:`,
        errorDashboardLink(report)
    ].join('\n');
}

// HTML version — Outlook (both the Power Automate connector and Graph) treats
// the body as HTML, which collapses plain-text newlines into one blob.
function snagEmailHtml(report) {
    const esc = s => String(s == null || s === '' ? '--' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const row = (label, value) =>
        `<tr><td style="padding:4px 14px 4px 0;color:#666;white-space:nowrap;vertical-align:top">${label}</td>` +
        `<td style="padding:4px 0">${value}</td></tr>`;
    const { customer, detail } = snagEmailSummary(report);
    return `
<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#222;max-width:640px">
  <p style="font-size:15px"><b>A customer order hit a snag</b> and needs follow-up within 2 hours.</p>
  <table style="border-collapse:collapse;font-size:14px">
    ${row('When', esc(report.at))}
    ${row('Customer', esc(customer))}
    ${row('Order number', esc(report.orderNumber))}
    ${row('Failed stage', `<b style="color:#b00020">${esc(snagSystem(report.stage))}</b> <span style="color:#666">(${esc(report.stage)})</span>`)}
    ${row('Error', esc(detail))}
  </table>
  <p style="margin:20px 0">
    <a href="${esc(errorDashboardLink(report))}"
       style="background:#2563eb;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:600;display:inline-block">
      View in error dashboard</a>
  </p>
  <p style="color:#666;font-size:12px">The dashboard has the full report: numbers, UBoss jobs, espresso order problems and the complete error.</p>
</div>`;
}

async function sendSnagEmail(report) {
    if (!D365_ENABLED) { console.error('[SNAG mail] skipped — Azure creds not configured'); return; }
    const mail = {
        message: {
            subject: snagSubject(report),
            body: { contentType: 'HTML', content: snagEmailHtml(report) },
            toRecipients: [{ emailAddress: { address: SNAG_MAIL_TO } }]
        },
        saveToSentItems: true
    };
    try {
        const token = await graphGetToken();
        const bodyStr = JSON.stringify(mail);
        const r = await httpsRequest(
            `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(SNAG_MAIL_FROM)}/sendMail`,
            { method: 'POST', headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr)
            } }, bodyStr);
        if (r.status === 202) {
            console.log('[SNAG mail] sent to', SNAG_MAIL_TO, 'for', report.email);
        } else if (r.status === 403 || r.status === 401) {
            console.error('[SNAG mail] Graph refused (HTTP ' + r.status + ') — the Azure app needs the '
                + 'Mail.Send APPLICATION permission with admin consent '
                + '(Azure Portal > App registrations > API permissions > Microsoft Graph > Application > Mail.Send). '
                + 'Snag is still recorded in the snag store.');
        } else {
            console.error('[SNAG mail] send failed (HTTP ' + r.status + '):', r.raw.slice(0, 300));
        }
    } catch (err) {
        console.error('[SNAG mail] send failed -', err.message);
    }
}

// ============================================
// DYNAMICS 365 — every completed order becomes/updates a CONTACT
// ============================================
// Topic "Sip Order": mapped fields go to real contact columns; everything
// without a direct mapping goes into description. The business registration
// document is attached as a Note (annotation). Credentials via env only.
// Tolerate a bare hostname in the env var: the OAuth scope must be a full
// https URL or AAD rejects it ("scope input parameter is not valid").
const D365_URL = (process.env.D365_URL || '').replace(/\/$/, '')
    .replace(/^(?!https?:\/\/)(.+)$/, 'https://$1');
const D365_TENANT_ID = process.env.D365_TENANT_ID || '';
const D365_CLIENT_ID = process.env.D365_CLIENT_ID || '';
const D365_CLIENT_SECRET = process.env.D365_CLIENT_SECRET || '';
const D365_ENABLED = !!(D365_URL && D365_TENANT_ID && D365_CLIENT_ID && D365_CLIENT_SECRET);

let d365Token = null; // { token, expiresAt }

function httpsRequest(urlStr, options, bodyStr) {
    return new Promise((resolve, reject) => {
        const u = new URL(urlStr);
        const req = https.request({
            hostname: u.hostname, path: u.pathname + u.search, method: options.method || 'GET',
            headers: options.headers || {}, agent: KEEPALIVE_AGENT, timeout: options.timeout || 30000
        }, res => {
            let d = ''; res.on('data', c => d += c);
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, raw: d }));
        });
        req.on('error', reject);
        req.on('timeout', () => req.destroy(new Error('request timeout')));
        if (bodyStr) req.write(bodyStr);
        req.end();
    });
}

async function d365GetToken() {
    if (d365Token && d365Token.expiresAt > Date.now() + 60000) return d365Token.token;
    const body = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: D365_CLIENT_ID,
        client_secret: D365_CLIENT_SECRET,
        scope: `${D365_URL}/.default`
    }).toString();
    const r = await httpsRequest(`https://login.microsoftonline.com/${D365_TENANT_ID}/oauth2/v2.0/token`,
        { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } }, body);
    const data = JSON.parse(r.raw);
    if (!data.access_token) throw new Error('D365 auth failed: ' + (data.error_description || r.raw.slice(0, 200)));
    d365Token = { token: data.access_token, expiresAt: Date.now() + (data.expires_in || 3600) * 1000 };
    return d365Token.token;
}

async function d365Api(method, resource, bodyObj, extraHeaders) {
    const token = await d365GetToken();
    const bodyStr = bodyObj ? JSON.stringify(bodyObj) : null;
    const r = await httpsRequest(`${D365_URL}/api/data/v9.2/${resource}`, {
        method,
        headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json',
            'OData-MaxVersion': '4.0', 'OData-Version': '4.0',
            ...(bodyStr ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
            ...(extraHeaders || {})
        }
    }, bodyStr);
    if (r.status >= 400) throw new Error(`D365 ${method} ${resource} failed (HTTP ${r.status}): ${r.raw.slice(0, 300)}`);
    return r;
}

// OData string-literal escaping (single quotes double up)
function odataStr(v) { return String(v).replace(/'/g, "''"); }

// First matching record id across a list of $filter expressions — the upsert
// identity ladder. Returns { id, via } or null.
async function d365FindFirst(entitySet, idField, filters) {
    for (const f of filters) {
        if (!f) continue;
        const r = await d365Api('GET', `${entitySet}?$select=${idField}&$filter=${encodeURIComponent(f)}`);
        const hit = (JSON.parse(r.raw).value || [])[0];
        if (hit) return { id: hit[idField], via: f };
    }
    return null;
}

// The 13 cr57d_ columns live on the ACCOUNT table (business), created by John
// in iris-sandbox. Text columns have hard max lengths — truncate defensively;
// Currency/Whole Number reject strings — send numbers.
function buildCrmAccountRecord(info, contact, email) {
    const t = (v, max) => (v === undefined || v === null || v === '') ? undefined : String(v).slice(0, max);
    const num = v => { const n = parseFloat(v); return isNaN(n) ? undefined : n; };
    const int = v => { const n = parseInt(v, 10); return isNaN(n) ? undefined : n; };
    const record = {
        name: t(info.businessName, 160) || t(`${contact.fname || ''} ${contact.lname || ''}`.trim(), 160) || email,
        cr57d_mindaccountnumber: t(info.accountId, 50),
        cr57d_paymentmethod: t(info.payment.method, 50),
        cr57d_cardlast4: t(info.payment.last4, 4),
        cr57d_paymentreference: t(info.payment.reference, 100),
        cr57d_amountcharged: num(info.payment.amount),
        cr57d_businessname: t(info.businessName, 200),
        cr57d_businessregnumber: t(info.bizRegNumber, 100),
        cr57d_serviceplan: t(info.plan, 100),
        cr57d_didordernumber: t(info.orderNumber, 100),
        cr57d_phonenumbers: t(info.numbers.join(', '), 4000),
        cr57d_channelcount: int(info.channelCount),
        cr57d_ubossjobids: t(info.provisionJobs.join(', '), 2000),
        cr57d_ordercompletedon: new Date().toISOString(),
        // Server-authoritative: true when a PON record exists for this email
        cr57d_isporting: !!info.isPorting,
        emailaddress1: email,
        telephone1: t(contact.phone, 50),
        address1_line1: t(contact.address1, 250), address1_city: t(contact.city, 80),
        address1_stateorprovince: t(contact.province, 50), address1_postalcode: t(contact.postalCode, 20),
        address1_country: t(contact.country, 80)
    };
    // Never overwrite existing CRM data with blanks
    for (const k of Object.keys(record)) if (record[k] === undefined) delete record[k];
    return record;
}

async function crmSyncOrder(body) {
    const email = normEmail(body.email);
    const contact = body.contact || {};

    // Everything the server itself knows about this customer's order
    const info = {
        payment: body.payment || {}, businessName: null, bizRegNumber: body.bizRegNumber || null,
        plan: body.plan || null, accountId: null, orderNumber: null, numbers: [],
        channelCount: null, provisionJobs: [], doc: null, isPorting: false
    };
    for (const [k, v] of Object.entries(orderStore)) {
        if (!k.includes(`:${email}`) || !v) continue;
        if (k.startsWith('account:')) info.accountId = v.accountId;
        else if (k.startsWith('order:') && v.status !== 'rejected') {
            info.orderNumber = v.orderNumber;
            info.businessName = v.businessName || info.businessName;
            (v.trunks || []).forEach(t => {
                (t.numbers || []).forEach(n => info.numbers.push(n));
                info.channelCount = (info.channelCount || 0) + (t.channels || 0);
            });
        }
        else if (k.startsWith('provision:')) info.provisionJobs.push(v.jobId);
        else if (k.startsWith('pon:')) info.isPorting = true;
    }
    info.businessName = body.businessName || info.businessName;
    const doc = getBusinessDoc(email);
    if (doc) info.doc = { filename: doc.filename, size: doc.size };

    // ---- 1. ACCOUNT upsert (the business — carries the 13 cr57d_ columns).
    // Identity ladder: MIND account number (stable across all of a customer's
    // orders) → email → business name. A repeat order PATCHes the same account
    // (latest order wins on order-specific fields); a new account is created
    // only when all three lookups miss. Old values stay in the D365 audit log.
    const accountRecord = buildCrmAccountRecord(info, contact, email);
    const accFound = await d365FindFirst('accounts', 'accountid', [
        info.accountId && `cr57d_mindaccountnumber eq '${odataStr(info.accountId)}'`,
        `emailaddress1 eq '${odataStr(email)}'`,
        info.businessName && `name eq '${odataStr(info.businessName)}'`
    ]);
    let crmAccountId;
    if (accFound) {
        crmAccountId = accFound.id;
        await d365Api('PATCH', `accounts(${crmAccountId})`, accountRecord);
    } else {
        const created = await d365Api('POST', 'accounts', accountRecord);
        const m = /accounts\(([0-9a-f-]+)\)/i.exec(created.headers['odata-entityid'] || '');
        crmAccountId = m && m[1];
    }
    if (!crmAccountId) throw new Error('Account upserted but no id resolved');

    // ---- 2. CONTACT upsert (the person), linked to the account
    const contactRecord = {
        firstname: contact.fname || '', lastname: contact.lname || email,
        emailaddress1: email,
        telephone1: contact.phone || '',
        address1_line1: contact.address1 || '', address1_city: contact.city || '',
        address1_stateorprovince: contact.province || '', address1_postalcode: contact.postalCode || '',
        address1_country: contact.country || '',
        description: `Sip Order — order data on account "${accountRecord.name}"`,
        'parentcustomerid_account@odata.bind': `/accounts(${crmAccountId})`
    };
    const q = await d365Api('GET', `contacts?$select=contactid,description&$filter=${encodeURIComponent(`emailaddress1 eq '${odataStr(email)}'`)}`);
    const found = (JSON.parse(q.raw).value || [])[0];
    let contactId;
    if (found) {
        contactId = found.contactid;
        // Records from the description-dump era keep their richer text
        if ((found.description || '').length > contactRecord.description.length) {
            delete contactRecord.description;
        }
        await d365Api('PATCH', `contacts(${contactId})`, contactRecord);
    } else {
        const created = await d365Api('POST', 'contacts', contactRecord);
        const m = /contacts\(([0-9a-f-]+)\)/i.exec(created.headers['odata-entityid'] || '');
        contactId = m && m[1];
    }
    if (!contactId) throw new Error('Contact upserted but no id resolved');

    // ---- 3. Legal document → Note on the ACCOUNT, once per stored file.
    // Repeat orders each add their own note, so the business's timeline keeps
    // every registration document ever submitted.
    let noteAttached = false;
    if (doc && doc.data) {
        const subject = `Sip Order — Business Registration Document (${doc.storedName})`;
        const existing = await d365Api('GET',
            `annotations?$select=annotationid&$filter=${encodeURIComponent(`_objectid_value eq ${crmAccountId} and subject eq '${odataStr(subject)}'`)}`);
        if (!(JSON.parse(existing.raw).value || []).length) {
            await d365Api('POST', 'annotations', {
                subject,
                notetext: 'Uploaded during online SIP trunk ordering.',
                filename: doc.filename,
                mimetype: doc.mimeType,
                documentbody: doc.data.toString('base64'),
                'objectid_account@odata.bind': `/accounts(${crmAccountId})`
            });
        }
        noteAttached = true;
    }
    console.log('[crm] account', accFound ? 'updated' : 'created', crmAccountId,
        '| contact', found ? 'updated' : 'created', contactId, 'for', email,
        noteAttached ? '(document attached)' : '(no document)');
    return { accountId: crmAccountId, contactId, updated: !!accFound, documentAttached: noteAttached };
}

// ============================================
// HTTP layer
// ============================================
function sendJson(res, status, obj) {
    const body = JSON.stringify(obj);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(body);
}

function readBody(req, limit) {
    const max = limit || 1e6;
    return new Promise((resolve, reject) => {
        let data = '';
        req.on('data', c => { data += c; if (data.length > max) req.destroy(); });
        req.on('end', () => resolve(data));
        req.on('error', reject);
    });
}

async function handleApi(req, res, pathname) {
    try {
        // Which environment each API is pointed at. Deliberately carries no
        // credentials — it exists so the port-in page can tell the customer
        // (or whoever is demoing) that a request is simulated rather than real.
        if (pathname === '/api/config' && req.method === 'GET') {
            // Ordering readiness — awaited (up to 5 s) on the first call after
            // a start, re-checked in the background when stale
            if (!espressoReadiness.checkedAt) {
                await Promise.race([checkEspressoReadiness(), new Promise(r => setTimeout(r, 5000))]);
            } else if (Date.now() - espressoReadiness.checkedAt > (espressoReadiness.didReady ? 10 * 60000 : 60000)) {
                checkEspressoReadiness().catch(() => {});
            }
            return sendJson(res, 200, {
                didMode: ESPRESSO_MODE, lnpMode: ESPRESSO_LNP_MODE, didApi: 'rest', pickSource: ESPRESSO_PICK_SOURCE,
                didReady: espressoReadiness.didReady, pickReady: espressoReadiness.pickReady
            });
        }
        // Rate centers stay on SOAP (REST has no catalog)
        if (pathname === '/api/did/catalog' && req.method === 'GET') {
            // A fixed list instead of espresso's (e.g. the sandbox demo: its
            // test numbers are Toronto 416, which the SOAP test catalog
            // doesn't list). DID_CATALOG_OVERRIDE='TORONTO:416,WINNIPEG:204'
            let catalog = DID_CATALOG_OVERRIDE.length ? DID_CATALOG_OVERRIDE.slice() : await getCatalog();
            // UbossRobot can only provision NPAs whose "+1-<npa>" number pool
            // exists in UBoss with an exact-match link — a missing pool makes
            // every job for that NPA fail at Step 01 (confirmed for 647), and
            // an ambiguous one dies on a strict-mode violation (416). Until
            // the UBoss side is fixed, only offer NPAs from the allowlist so
            // customers can't order a number we cannot provision.
            if (UBOSS_POOL_NPAS.length) {
                catalog = catalog.filter(c => UBOSS_POOL_NPAS.includes(String(c.npa)));
            }
            // Numbers are stored in MIND under a city; an NPA with no city
            // mapped would fail after purchase, so it isn't offered
            const unmapped = [...new Set(catalog.filter(c => !NPA_MIND_CITY[String(c.npa)]).map(c => String(c.npa)))];
            if (unmapped.length) {
                console.warn('[catalog] not offered — no MIND city mapped for NPA', unmapped.join(', '));
                catalog = catalog.filter(c => NPA_MIND_CITY[String(c.npa)]);
            }
            return sendJson(res, 200, { catalog });
        }
        if (pathname === '/api/did/profiles' && req.method === 'GET') {
            const acct = await espressoRestAccount().catch(() => null);
            const list = await restRoutingProfiles(acct && acct.companyId);
            return sendJson(res, 200, {
                pinned: acct && acct.profileLabel,
                profiles: list.filter(p => p && p.type === 'did').map(p => ({ id: p.id, label: p.label, active: p.active !== false }))
            });
        }
        // Numbers the customer can pick in a rate center: available in
        // espresso and unknown to MIND (read-only checks; nothing is held)
        if (pathname === '/api/did/available' && req.method === 'GET') {
            const q = new URL(req.url, 'http://x').searchParams;
            const ratecenter = String(q.get('ratecenter') || '').trim();
            const npa = String(q.get('npa') || '').trim();
            const quantity = Math.min(Math.max(parseInt(q.get('quantity'), 10) || 1, 1), 50);
            const email = normEmail(q.get('email'));
            const exclude = String(q.get('exclude') || '').split(',').map(tenDigits).filter(d => /^\d{10}$/.test(d));
            if (!ratecenter || !/^\d{3}$/.test(npa)) {
                return sendJson(res, 400, { error: 'ratecenter and a 3-digit npa are required' });
            }
            try {
                const mindCity = await resolveMindCity({ ratecenter, npa });
                if (!mindCity) {
                    throttledServerError(`nocity:${ratecenter}:${npa}`, 60 * 60000, email, 'did-available',
                        new Error(`No MIND city for ${ratecenter} (${npa}) — add a nearby city to MIND_CITY_ALIASES`), { ratecenter, npa });
                    return sendJson(res, 422, { error: `Numbers in ${ratecenter} can't be offered right now`, code: 'NO_MIND_CITY' });
                }
                const found = ESPRESSO_PICK_SOURCE === 'reserve'
                    ? await reservePickBatch({ email, accountRef: (stateGet(`account:${email}`) || {}).accountId,
                        ratecenter, npa, quantity, exclude })
                    : await pickAvailableNumbers({ ratecenter, npa, want: Math.max(quantity * 2, 10), exclude, email });
                return sendJson(res, 200, { ratecenter, npa, ...found, mindCity });
            } catch (e) {
                const code = espressoApiCode(e) || 'ESPRESSO_BUSY';
                if (code === 'MIND_UNAVAILABLE') {
                    throttledServerError('mind-pick', 15 * 60000, email, 'mind-pick-check', e, { ratecenter, npa });
                } else {
                    throttledServerError(`pick:${code}`, 15 * 60000, email, 'did-available', e, { ratecenter, npa, code });
                }
                return sendJson(res, 503, { error: e.message, code });
            }
        }
        // Read-only pre-check the review page runs BEFORE taking payment:
        // are the picked numbers still free? The order re-checks anyway; this
        // just keeps a customer from paying for numbers that are already gone.
        if (pathname === '/api/did/check-picks' && req.method === 'POST') {
            const body = JSON.parse(await readBody(req) || '{}');
            const norm = normalizeOrderRequests(body.requests);
            if (norm.error) {
                return sendJson(res, 400, { error: norm.error, code: norm.code || 'INVALID_REQUEST', number: norm.number || null });
            }
            const email = normEmail(body.email);
            // Already ordered (a resumed submit): the order call returns it
            const seen = email && stateGet(K.order(email, norm.requests), { activeOnly: true });
            if (seen && seen.status !== 'rejected' && (seen.orderId || seen.orderNumber)) {
                return sendJson(res, 200, { ok: true, unavailable: [], orderNumber: seen.orderNumber });
            }
            // Same guard the order applies — refuse before payment, not after
            const other = email && otherOpenOrder(email, K.order(email, norm.requests));
            if (other) {
                return sendJson(res, 409, {
                    error: other.orderNumber ? `Order ${other.orderNumber} is still in progress for this account`
                        : 'An order is still in progress for this account',
                    code: 'ORDER_IN_PROGRESS', orderNumber: other.orderNumber || null, orderId: other.orderId || null
                });
            }
            // Reserve mode orders only picked numbers: a request saved without
            // picks (an older page) goes back to the picker before payment
            const unpicked = norm.requests.map((r, i) => (r.dids ? -1 : i)).filter(i => i >= 0);
            if (ESPRESSO_PICK_SOURCE === 'reserve' && unpicked.length) {
                return sendJson(res, 409, { error: 'Pick the numbers first', code: 'PICK_REQUIRED', indexes: unpicked });
            }
            try {
                for (const [index, r] of norm.requests.entries()) {
                    if (!(await resolveMindCity({ ratecenter: r.ratecenter, npa: r.npa }))) {
                        return sendJson(res, 422, {
                            error: `No MIND city for ${r.ratecenter} (${r.npa})`, code: 'NO_MIND_CITY',
                            index, ratecenter: r.ratecenter, npa: r.npa
                        });
                    }
                }
                const picks = norm.requests.flatMap(r => r.dids || []);
                const unavailable = !picks.length ? []
                    : ESPRESSO_PICK_SOURCE === 'reserve' ? (await reservedPicksCheck(picks, email)).unavailable
                    : await unavailablePicks(picks, email);
                return sendJson(res, 200, { ok: !unavailable.length, unavailable });
            } catch (e) {
                const code = espressoApiCode(e) || 'ESPRESSO_BUSY';
                throttledServerError(`checkpicks:${code}`, 15 * 60000, email, code === 'MIND_UNAVAILABLE' ? 'mind-pick-check' : 'did-check-picks', e, { code });
                return sendJson(res, 503, { error: e.message, code });
            }
        }
        if (pathname === '/api/did/order' && req.method === 'POST') {
            const body = JSON.parse(await readBody(req) || '{}');
            try {
                const { status, payload } = await placeDidOrder(body);
                return sendJson(res, status, payload);
            } catch (e) {
                const code = espressoApiCode(e);
                if (!e.reported) {
                    reportServerError(body.email, code === 'MIND_UNAVAILABLE' ? 'mind-pick-check' : 'did-order', e,
                        { accountRef: body.accountRef || null, code });
                }
                const retryable = ['ESPRESSO_BUSY', 'INVENTORY_FORBIDDEN', 'MIND_UNAVAILABLE'].includes(code);
                return sendJson(res, retryable ? 503 : (e.status >= 400 ? e.status : 502), { error: e.message, code: code || null });
            }
        }
        // Read-only MIND account lookup, proxied because api.iristelx.com
        // sends no CORS headers — a browser fetch dies on the preflight and
        // the signup prefill silently fell back to "Test User".
        const mAcct = pathname.match(/^\/api\/mind\/account\/([\w-]+)$/);
        if (mAcct && req.method === 'GET') {
            return sendJson(res, 200, await mindAccountSummary(mAcct[1]));
        }
        if (pathname === '/api/mind/service' && req.method === 'POST') {
            const body = JSON.parse(await readBody(req) || '{}');
            if (!body.email) return sendJson(res, 400, { error: 'email is required' });
            if (!body.accountId) return sendJson(res, 400, { error: 'accountId is required' });
            return sendJson(res, 200,
                await createMindService(body.email, body.accountId, body.planCode, body.contact || {}, body.businessName)
                    .catch(reportAndRethrow(body.email, 'mind-service', { accountId: body.accountId, planCode: body.planCode || null })));
        }
        // Channel and DID quantities on the paid order's service. Never
        // blocks the customer — a miss is reported for ops to fix in MIND.
        if (pathname === '/api/mind/service/quantities' && req.method === 'POST') {
            const body = JSON.parse(await readBody(req) || '{}');
            if (!body.email) return sendJson(res, 400, { error: 'email is required' });
            try {
                return sendJson(res, 200, { ok: true, ...(await setServiceQuantities(body.email, body.trunks)) });
            } catch (e) {
                console.error('[mind] quantities:', e.message);
                reportServerError(body.email, 'mind-quantity', e, { result: e.result || null });
                return sendJson(res, 200, { ok: false, error: e.message, result: e.result || null });
            }
        }
        // Is any of these numbers already on someone else's MIND service?
        // Gates provisioning — the status page replaces a taken number before
        // UBoss ever sees it (UBoss burns every number it touches).
        if (pathname === '/api/mind/check-numbers' && req.method === 'POST') {
            const body = JSON.parse(await readBody(req) || '{}');
            if (!body.email) return sendJson(res, 400, { error: 'email is required' });
            if (!Array.isArray(body.numbers) || !body.numbers.length) {
                return sendJson(res, 400, { error: 'numbers[] is required' });
            }
            const email = normEmail(body.email);
            // This order's service — a number on it is ours, not taken
            const serviceId = body.serviceId
                || (stateGet(`service:${email}`, { activeOnly: true }) || {}).serviceId
                || (stateGet(`mindassign:${email}`, { activeOnly: true }) || {}).serviceId
                || null;
            return sendJson(res, 200, await checkNumbersInMind(email, body.numbers, serviceId, body.city || orderRatecenter(email))
                .catch(reportAndRethrow(email, 'mind-tn-check', { numbers: body.numbers, serviceId })));
        }
        if (pathname === '/api/mind/assign-number' && req.method === 'POST') {
            const body = JSON.parse(await readBody(req) || '{}');
            if (!body.email) return sendJson(res, 400, { error: 'email is required' });
            const email = normEmail(body.email);

            // Everything but the serviceId is already on file server-side
            let accountId = null, ratecenter = null, primary = null;
            const numbers = [];
            for (const [k, v] of Object.entries(orderStore)) {
                if (!k.includes(`:${email}`) || !v) continue;
                if (k.startsWith('account:')) accountId = v.accountId;
                else if (k.startsWith('order:') && v.status !== 'rejected') {
                    (v.trunks || []).forEach(t => {
                        if (!primary && t.primaryNumber) primary = t.primaryNumber;
                        (t.numbers || []).forEach(n => numbers.push(n));
                    });
                    // espresso ratecenter doubles as the MIND city name
                    const req0 = (v.requests || [])[0];
                    if (req0 && req0.ratecenter) ratecenter = req0.ratecenter;
                }
            }
            accountId = body.accountId || accountId;
            const serviceId = body.serviceId
                || (stateGet(`service:${email}`) || {}).serviceId
                || (stateGet(`mindassign:${email}`) || {}).serviceId;
            // Primary number first — assignNumbersToMindService attaches
            // normalized[0] to the service; the rest only go to inventory.
            let wanted = body.numbers && body.numbers.length ? body.numbers : [...new Set(numbers)];
            if (primary && !body.numbers) {
                wanted = [primary, ...wanted.filter(n => n !== primary)];
            }
            const cityHint = body.city || ratecenter;
            try {
                return sendJson(res, 200, await assignNumbersToMindService(email, serviceId, accountId, wanted, cityHint));
            } catch (e) {
                // A number MIND won't attach is taken: the status page stops
                // before UBoss and ops resolve it, like a failed check
                if (e.takenNumber) {
                    const entry = { number: e.takenNumber, via: 'mind', holderServiceId: null, holderPlan: null };
                    flagTakenNumber(email, entry);
                    return sendJson(res, 200, { assigned: [], error: e.message, taken: [entry] });
                }
                // Reported but never customer-blocking — same policy as CRM sync
                console.error('[mind] assignment failed:', e.message);
                reportServerError(email, 'mind-assign-number', e, { serviceId: serviceId || null, accountId, numbers: wanted });
                return sendJson(res, 200, { assigned: [], error: e.message });
            }
        }
        if (pathname === '/api/account' && req.method === 'POST') {
            const body = JSON.parse(await readBody(req) || '{}');
            if (!body.email) return sendJson(res, 400, { error: 'email is required' });
            if (!body.contact) return sendJson(res, 400, { error: 'contact is required' });
            return sendJson(res, 200, await createAccount(body.email, body.contact, body.accountId)
                .catch(reportAndRethrow(body.email, 'mind-account', { accountId: body.accountId || null })));
        }
        if (pathname === '/api/myiristel/sign-in' && req.method === 'POST') {
            const body = JSON.parse(await readBody(req) || '{}');
            if (!body.email) return sendJson(res, 400, { error: 'email is required' });
            const acct = await myIristelSignIn(body.email)
                .catch(reportAndRethrow(body.email, 'mind-account-sign-in', {}));
            if (!acct) return sendJson(res, 404, { error: 'No MyIristel account uses this email', code: 'NO_ACCOUNT' });
            return sendJson(res, 200, acct);
        }
        if (pathname === '/api/business-doc' && req.method === 'POST') {
            // Base64 inflates ~4/3, so 15 MB of JSON covers a 10 MB file
            const body = JSON.parse(await readBody(req, 15 * 1024 * 1024) || '{}');
            if (!body.email) return sendJson(res, 400, { error: 'email is required' });
            if (!body.data || !body.filename || !body.mimeType) {
                return sendJson(res, 400, { error: 'filename, mimeType and data are required' });
            }
            try {
                return sendJson(res, 200, saveBusinessDoc(body.email, body.filename, body.mimeType, body.data));
            } catch (e) {
                return sendJson(res, e.status || 500, { error: e.message });
            }
        }
        if (pathname === '/api/notify-snag' && req.method === 'POST') {
            const body = JSON.parse(await readBody(req) || '{}');
            if (!body.email) return sendJson(res, 400, { error: 'email is required' });
            const report = await recordSnag(body.email, body.stage || 'unknown', body.detail);
            return sendJson(res, 200, { recorded: true, at: report.at });
        }
        if (pathname === '/api/snags' && req.method === 'GET') {
            // Reports from before the system grouping get theirs on the way out
            return sendJson(res, 200, { snags: snagStore.map(s => s.system ? s : { ...s, system: snagSystem(s.stage) }) });
        }
        if (pathname === '/api/crm/sync' && req.method === 'POST') {
            const body = JSON.parse(await readBody(req) || '{}');
            if (!body.email) return sendJson(res, 400, { error: 'email is required' });
            if (!D365_ENABLED) {
                console.warn('[crm] sync requested but D365 env vars are not set — skipped for', normEmail(body.email));
                return sendJson(res, 200, { skipped: true, reason: 'D365 not configured' });
            }
            try {
                return sendJson(res, 200, await crmSyncOrder(body));
            } catch (e) {
                // CRM problems must never disturb the customer's flow
                console.error('[crm] sync failed for', normEmail(body.email), '-', e.message);
                reportServerError(body.email, 'crm-sync', e, {}, 'warning');
                return sendJson(res, 200, { synced: false, error: e.message });
            }
        }
        if (pathname === '/api/provision' && req.method === 'POST') {
            const body = JSON.parse(await readBody(req) || '{}');
            if (!body.email) return sendJson(res, 400, { error: 'email is required' });
            if (!Array.isArray(body.phoneNumbers) || !body.phoneNumbers.length) {
                return sendJson(res, 400, { error: 'phoneNumbers[] is required' });
            }
            // The business name doubles as the reseller name — a job without it
            // would provision under a blank reseller, so refuse up front.
            if (!body.businessName || !String(body.businessName).trim()) {
                return sendJson(res, 400, { error: 'businessName is required' });
            }
            return sendJson(res, 200, await startProvisioning(body)
                .catch(reportAndRethrow(body.email, 'uboss-start', { phoneNumbers: body.phoneNumbers, trunkName: body.trunkName || null })));
        }
        // What is still IN FLIGHT for a customer, so another device can pick the
        // order back up instead of starting (and paying for) a new one. A
        // finished order is not resumable — coming back later means a new order.
        if (pathname === '/api/session' && req.method === 'GET') {
            const email = normEmail(new URL(req.url, 'http://x').searchParams.get('email'));
            if (!email) return sendJson(res, 400, { error: 'email is required' });
            const out = { email, account: null, order: null, pon: null, provisions: [], resumable: false };
            for (const [k, v] of Object.entries(orderStore)) {
                if (!k.includes(`:${email}`)) continue;
                if (k.startsWith('account:')) out.account = v;      // always reusable
                else if (v && v.status === 'done') continue;         // finished — not resumable
                else if (k.startsWith('order:')) {
                    // A rejected order was replaced by a new pick; one still
                    // being placed has nothing to resume yet
                    if (v.status === 'rejected' || v.status === 'placing') continue;
                    if (!out.order || (v.createdAt || 0) > (out.order.createdAt || 0)) out.order = v;
                }
                else if (k.startsWith('pon:')) out.pon = v;
                else if (k.startsWith('provision:')) out.provisions.push(v);
            }
            // An order whose provisioning already succeeded is finished, even if
            // nothing told us so — close it out rather than offering a resume.
            if (out.order && await sessionAlreadyProvisioned(email)) {
                markSessionDone(email);
                out.order = null; out.pon = null; out.provisions = [];
            }
            out.resumable = !!(out.order || out.provisions.length);
            return sendJson(res, 200, out);
        }
        // The status page reports a successful provisioning here, which closes
        // the order out so the customer's next purchase is treated as new.
        // The trunk snapshot is taken when the order is placed, before Iristel
        // has assigned anything, so it carries requests but no numbers. Once
        // they arrive the status page sends them back here — otherwise a
        // resumed order shows an empty number until espresso is re-queried.
        if (pathname === '/api/session/trunks' && req.method === 'POST') {
            const body = JSON.parse(await readBody(req) || '{}');
            const email = normEmail(body.email);
            if (!email) return sendJson(res, 400, { error: 'email is required' });
            if (!Array.isArray(body.trunks)) return sendJson(res, 400, { error: 'trunks[] is required' });

            let updated = 0;
            for (const [k, v] of Object.entries(orderStore)) {
                if (!k.startsWith('order:') || !k.includes(`:${email}`)) continue;
                if (v && (v.status === 'done' || v.status === 'rejected' || v.status === 'placing')) continue;
                orderStore[k] = { ...v, trunks: body.trunks, updatedAt: Date.now() };
                updated++;
            }
            if (updated) saveOrderStore();
            return sendJson(res, 200, { updated });
        }
        if (pathname === '/api/session/complete' && req.method === 'POST') {
            const body = JSON.parse(await readBody(req) || '{}');
            if (!body.email) return sendJson(res, 400, { error: 'email is required' });
            const closed = markSessionDone(body.email);
            await activateMindStatuses(body.email);
            return sendJson(res, 200, { closed });
        }
        if (pathname === '/api/payment/charge' && req.method === 'POST') {
            const body = JSON.parse(await readBody(req) || '{}');
            if (!body.accountCode || !body.amount || !body.creditCard) {
                return sendJson(res, 400, { error: 'accountCode, amount and creditCard are required' });
            }
            return sendJson(res, 200, await chargeBalance(body).catch(err => {
                // A decline is the customer's card, not an incident — dashboard
                // only. Unknown/unreachable outcomes need a human to reconcile.
                const declined = err.status === 402;
                reportServerError(body.email, declined ? 'payment-declined' : 'payment-gateway', err,
                    { reference: err.reference || null, amount: body.amount, accountCode: body.accountCode },
                    declined ? 'warning' : 'error');
                throw err;
            }));
        }
        // Support/debug view of what this server has recorded
        if (pathname === '/api/did/orders/recorded' && req.method === 'GET') {
            pruneOrderStore();
            return sendJson(res, 200, {
                orders: Object.entries(orderStore).map(([key, v]) => ({ key, ...v }))
            });
        }
        // Order reads take the espresso order id (UUID) or its ORD- number;
        // anything else is an order placed over SOAP before the switch.
        let m = pathname.match(/^\/api\/did\/order\/([^/]+)\/status$/);
        if (m && req.method === 'GET') {
            const ref = decodeURIComponent(m[1]);
            if (isLegacyOrderRef(ref)) {
                const legacy = await getOrderStatus(ref);
                // A rejected SOAP order is over: the customer re-picks, and
                // the open-order guard must not keep blocking that
                const hit = /rejected|cancel/i.test(legacy.status) && findOrderRecord(ref);
                if (hit && hit.rec.status !== 'done' && hit.rec.status !== 'rejected') {
                    orderStore[hit.key] = { ...hit.rec, status: 'rejected', updatedAt: Date.now() };
                    saveOrderStore();
                }
                return sendJson(res, 200, legacy);
            }
            const order = await getRestOrder(ref);
            const { assigned, ...mapped } = mapRestOrderStatus(order);
            noteOrderOutcome(order, { ...mapped, assigned });
            return sendJson(res, 200, mapped);
        }
        // Assigned numbers, and which request each belongs to (byRequest),
        // so the status page puts every number on the trunk it was picked for
        m = pathname.match(/^\/api\/did\/order\/([^/]+)\/details$/);
        if (m && req.method === 'GET') {
            const ref = decodeURIComponent(m[1]);
            if (isLegacyOrderRef(ref)) return sendJson(res, 200, await getOrderDetails(ref));
            const order = await getRestOrder(ref);
            const byRequest = numbersByRequest(order, ['ASSIGNED']);
            return sendJson(res, 200, {
                orderId: order.id, orderNumber: order.orderNumber, status: order.status,
                numbers: byRequest.flatMap(g => g.dids), byRequest, ranges: []
            });
        }
        // Per-request rejection reasons, with the picked numbers that are
        // gone (goneDids) — the status page sends the customer back to
        // replace just those.
        m = pathname.match(/^\/api\/did\/order\/([^/]+)\/problems$/);
        if (m && req.method === 'GET') {
            const ref = decodeURIComponent(m[1]);
            if (isLegacyOrderRef(ref)) return sendJson(res, 200, { problems: await getOrderProblems(ref) });
            const order = await getRestOrder(ref);
            const hit = findOrderRecord(order.id) || findOrderRecord(order.orderNumber);
            return sendJson(res, 200, { problems: await restOrderProblems(order, hit && hit.rec) });
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
            const ponResult = await lnpCreatePon({ ...body, numbers })
                .catch(reportAndRethrow(body.email, 'lnp-pon', { numbers }));
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
        if (err.apiCode) payload.code = err.apiCode;
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

// Only the site's pages and assets are public — never the server source
// (it carries API key defaults), dotfiles, uploads, docs or tooling
const PRIVATE_PATH = /^\/(server\.js|package(-lock)?\.json|yarn\.lock|README\.md|docs\/|uploads\/|node_modules\/)|\/\./;

function serveStatic(res, pathname) {
    let rel = decodeURIComponent(pathname);
    if (rel === '/') rel = '/signUp.html';
    if (PRIVATE_PATH.test(rel)) { res.writeHead(404); return res.end('Not found'); }
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
    console.log('  DID orders : ' + ESPRESSO_MODE + ' via REST ' + ESPRESSO_REST_URL
        + (ESPRESSO_MODE === 'production' ? '  ← orders are real and billed' : '')
        + (ESPRESSO_REST_CONFIGURED ? '' : '  ⚠ ESPRESSO_CLIENT_ID / ESPRESSO_CLIENT_SECRET not set — ordering is off'));
    console.log('  LNP ports  : ' + ESPRESSO_LNP_MODE
        + (ESPRESSO_LNP_MODE === 'production'
            ? '  ⚠ PORT REQUESTS ARE REAL — they notify the losing carrier'
            : '  (sandbox — safe to demo)'));
    console.log('  DID profile: ' + (process.env.ESPRESSO_ROUTING_PROFILE_ID
        ? 'id ' + process.env.ESPRESSO_ROUTING_PROFILE_ID
        : (ESPRESSO_DID_PROFILE || '(not pinned — only works when the company has exactly one DID profile)')));
    console.log('  LNP profile: ' + (ESPRESSO_LNP_PROFILE || '(not pinned — will use the account\'s first profile)'));
    console.log('  state dir  : ' + STATE_DIR
        + (STATE_DIR === ROOT ? '  ⚠ not a persistent disk — records are lost on redeploy' : ''));
    // espresso REST readiness: now, then every 10 minutes
    if (ESPRESSO_REST_CONFIGURED) {
        checkEspressoReadiness().catch(() => {});
        setInterval(() => checkEspressoReadiness().catch(() => {}), 10 * 60000).unref();
    }
});
