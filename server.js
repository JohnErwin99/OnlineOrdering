// ============================================
// OnlineOrdering server
// ============================================
// Serves the static ordering pages AND proxies the Iristel espresso DID
// Ordering V3 SOAP API as JSON under /api/did/*.
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

const ROOT = __dirname;

// ============================================
// SOAP client (rpc/encoded, Credentials header)
// ============================================
function xmlEscape(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function soapEnvelope(bodyXml) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:ns1="${ESPRESSO_NS}"
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

function soapPost(bodyXml) {
    return new Promise((resolve, reject) => {
        const payload = soapEnvelope(bodyXml);
        const req = https.request(ESPRESSO_URL, {
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
async function espressoCall(methodBodyXml, methodName) {
    if (!ESPRESSO_USER || !ESPRESSO_PASS) {
        const err = new Error('espresso credentials not configured (set ESPRESSO_USER / ESPRESSO_PASS)');
        err.status = 503;
        throw err;
    }
    const raw = await soapPost(methodBodyXml);
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
async function placeOrder(profile, requests) {
    if (!profile) {
        const profiles = await getProfiles();
        if (!profiles.length) throw new Error('No routing profiles on this espresso account');
        profile = profiles[0];
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
            return sendJson(res, 200, await placeOrder(body.profile, requests));
        }
        let m = pathname.match(/^\/api\/did\/order\/([^/]+)\/status$/);
        if (m && req.method === 'GET') {
            return sendJson(res, 200, await getOrderStatus(decodeURIComponent(m[1])));
        }
        m = pathname.match(/^\/api\/did\/order\/([^/]+)\/details$/);
        if (m && req.method === 'GET') {
            return sendJson(res, 200, await getOrderDetails(decodeURIComponent(m[1])));
        }
        sendJson(res, 404, { error: 'Unknown API route' });
    } catch (err) {
        console.error('[api]', pathname, '-', err.message);
        sendJson(res, err.status || 500, { error: err.message });
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
    console.log(`OnlineOrdering server on :${PORT} — espresso mode: ${ESPRESSO_MODE}` +
        (ESPRESSO_USER ? '' : ' (NO CREDENTIALS SET — /api/did/* will return 503)'));
});
