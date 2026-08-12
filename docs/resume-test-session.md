# Resuming the production test without re-ordering a DID

The flow keeps its state in **`sessionStorage`** (`setCookie()` in
`js/common.js` writes there despite the name), so **closing the tab wipes
everything**. The ordered number itself is safe — it belongs to the account
permanently — but the browser forgets which trunk it was on.

Reconstructing that state is what lets you resume provisioning instead of
walking the flow again and ordering (and paying for) a second DID.

## Test number already ordered

| | |
|---|---|
| Number | `4169005041` (TORONTO 416-900) |
| espresso order | `DID2608120201666` — Completed, profile `Profile 718524 DID E164` |
| MIND account | `7142292` |

## How to resume

1. Start the server in production mode:

   ```bash
   ESPRESSO_USER='jerwin@iristel.com' ESPRESSO_PASS='<password>' \
   ESPRESSO_MODE=production \
   ESPRESSO_DID_PROFILE='Profile 718524 DID E164' \
   ESPRESSO_LNP_PROFILE=2408 \
   node server.js
   ```

2. Open <http://localhost:3000/Sip%20Trunk/provisioningStatus.html>

3. Paste the block below into the browser console, then reload the page.

```js
// Restore the test session — number already ordered, do NOT order another.
const S = {
  sip_trunks: JSON.stringify([{
    id: 1, name: 'Trunk 1', channels: 1, requests: [],
    numbers: ['4169005041'], primaryNumber: '4169005041'
  }]),
  sip_primaryNumber: '4169005041',
  iristel_account_id: '7142292',
  sip_businessName:  'Erwin Test Corp',
  sip_address1:      '34-1559 Albion Rd',
  sip_city:          'Etobicoke',
  sip_province:      'ON',
  sip_country:       'CA',
  sip_postalCode:    'M9V1B2',
  sip_billingFirstName: 'John',
  sip_billingLastName:  'Erwin',
  sip_billingEmail:  'shivamparshar36@gmail.com',
  sip_billingPhone:  '4169005041',
  sip_techEmail:     'shivamparshar36@gmail.com'
};
Object.entries(S).forEach(([k, v]) => sessionStorage.setItem(k, v));

// Clear anything that would re-order or replay a dead job
['sip_didOrderNumber', 'sip_provisionJobId', 'sip_provisionJobs',
 'sip_provisionResult', 'sip_welcomeEmailSent', 'sip_isPorting',
 'sip_numberSource', 'sip_ponNumber'].forEach(k => sessionStorage.removeItem(k));

location.reload();
```

## Why this cannot re-order a DID

Two independent guards:

- `waitForNumberOrder()` skips ordering entirely when `sip_didOrderNumber` is
  absent **or** the trunks already carry numbers — both are true here.
- The espresso order only ever happens on the **review** page at submit. Landing
  directly on `provisioningStatus.html` never reaches that code.

So this resumes at UbossRobot provisioning with the existing number, every time.

## Verify before you trust it

In the console after reload:

```js
JSON.parse(sessionStorage.getItem('sip_trunks'))[0].numbers  // ['4169005041']
sessionStorage.getItem('sip_didOrderNumber')                 // null
UBOSS_RESELLER_NAME                                          // 'Demo Reseller'
```

The page should show "Numbers ready" and move straight to provisioning.

## Known blocker

Provisioning still fails inside UbossRobot on an ambiguous locator
(`+1-416` matches 12 number pools). That needs Iristel's fix — see the two
failed jobs `f65e9289-2239-4159-905c-051bca60323b` (reseller lookup) and
`350e1c81-659b-43eb-90b8-3e49bea0afe6` (number pool lookup).

## Worth fixing separately

Because state lives in `sessionStorage`, a **real customer** who closes the tab
mid-order loses everything — and if they had already paid and ordered numbers,
restarting would order a second set. Persisting order state server-side, or at
minimum moving to real cookies with an expiry, should be tracked as its own
task before launch.
