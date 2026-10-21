# Iristel Online Ordering

Static ordering pages plus a small Node server (`server.js`, no npm dependencies)
that serves them and proxies the espresso APIs as JSON: the **REST** DID
inventory and order API under `/api/did/*`, the **DID Ordering V3** SOAP
rate-center catalog behind `/api/did/catalog`, and **LNP (number porting) V4**
SOAP under `/api/lnp/*`.

## Why a server?

Customers pick the exact numbers they want from espresso's live inventory, and
every number is checked against MIND before it is shown and again before it is
bought. espresso sends no CORS headers, its SOAP side is rpc/encoded, and its
credentials (the SOAP login and the REST OAuth client secret) must not ship in
browser JS. The MIND checks need keys of their own. So the browser talks to
this server, and the server talks to espresso and MIND.

## Which espresso API does what

| What | API | Host |
|---|---|---|
| Number inventory (the picker), DID orders, companies, routing profiles | REST (JSON, OAuth2) | `api.espressodid.com` (production) or `api-sandbox.espressodid.com` (test), picked by `ESPRESSO_MODE` |
| Rate-center catalog | SOAP DID v3 | `connect.espressodid.com/cloud/public/v3/<ESPRESSO_MODE>` |
| Number porting (LNP) | SOAP LNP v4 | `connect.espressodid.com/cloud/public/v4/<ESPRESSO_LNP_MODE>` |
| Orders placed over SOAP before the switch (status/details/problems only) | SOAP DID v3 | as above |

REST has no rate-center catalog and no porting, which is why those two stay on
SOAP. `ESPRESSO_REST_URL` overrides the REST host if it ever has to.

espresso keeps at most 5 live REST tokens per user and revokes the oldest, so
the server shares one token across every request and refreshes it just before
it expires.

espresso's nginx answers the order collection, `/ws/v1/dids/orders`, with a 301
to a static Swagger docs folder (GET 200 HTML, POST 405), so creating and
listing orders never reached the API. The server sends those two calls to
`/index.php/ws/v1/dids/orders`, which does (`ESPRESSO_REST_ROUTED`, seen
2026-10-21 on both hosts), and never follows a redirect. The readiness check
lists one order, so if the route breaks again the pages say ordering is
unavailable before payment rather than failing after it.

## Configuration

| Variable | Purpose |
|---|---|
| `ESPRESSO_USER` / `ESPRESSO_PASS` | espresso login (from Iristel) — SOAP (catalog, porting), and the REST login unless overridden below |
| `ESPRESSO_CLIENT_ID` / `ESPRESSO_CLIENT_SECRET` | REST OAuth client — without it the number picker and DID ordering are off |
| `ESPRESSO_REST_USER` / `ESPRESSO_REST_PASS` | Optional separate REST login, e.g. when the sandbox has its own account (default: `ESPRESSO_USER` / `ESPRESSO_PASS`) |
| `ESPRESSO_MODE` | `test` (default) or `production` — picks the REST host and the SOAP endpoint |
| `ESPRESSO_REST_URL` | Optional REST host override |
| `ESPRESSO_COMPANY_ID` | Optional espresso company id (default: the login's only active company; required if it has several) |
| `ESPRESSO_ROUTING_PROFILE_ID` | Optional routing profile id — skips the label lookup |
| `ESPRESSO_DID_PROFILE` | Routing profile **label** for DID orders, matched against the REST routing profiles |
| `ESPRESSO_OCN` | OCN numbers are searched and bought under (default `154E`, Iristel's own — the only one the order API accepts) |
| `ESPRESSO_LNP_MODE` | Porting environment — defaults to `ESPRESSO_MODE` |
| `ESPRESSO_LNP_PROFILE` | Routing profile **id** for port requests |
| `PORT` | Listen port (default 3000) |

### Porting has its own mode, and usually should

A DID order placed by mistake costs a number. A **port request** placed by
mistake starts a real number transfer: the customer's current provider is
notified, and unwinding it means cancelling a port.

So set `ESPRESSO_LNP_MODE=test` on any environment where the port-in flow can
be reached but real ports are not intended — a live demo, in particular:

```
ESPRESSO_MODE     = production   # numbers are ordered for real
ESPRESSO_LNP_MODE = test         # ports stay in the sandbox
```

The startup log states both plainly, so a live site that can file real ports
says so:

```
  DID orders : production via REST https://api.espressodid.com  ← orders are real and billed
  LNP ports  : test  (sandbox — safe to demo)
```

Unlike DID ordering, the LNP profile (`2408`) exists in **both** environments,
so no profile change is needed when switching.

### The routing profile matters, and differs per environment

The routing profile decides **where an ordered DID actually routes**. Get it
wrong and the failure is silent: the number provisions successfully, the trunk
builds normally, and calls never land. So the profile is pinned by env var, and
the server refuses to place an order if the pinned profile isn't on the account
rather than quietly falling back to another one.

DID orders resolve it over REST, once an hour: `ESPRESSO_ROUTING_PROFILE_ID` if
set, otherwise the company's active `did` profile whose label equals
`ESPRESSO_DID_PROFILE` (case-insensitive). Unpinned, it only works when the
company has exactly one DID profile. A miss leaves ordering off with
`ESPRESSO_NOT_READY` instead of guessing.

The two environments do **not** carry the same profiles:

| | DID (`ESPRESSO_DID_PROFILE`) | LNP v4 (`ESPRESSO_LNP_PROFILE`) |
|---|---|---|
| `test` | `Test Profile` | `2408` |
| `production` | `Profile 718524 DID E164` | `2408` |

The DID labels are the ones SOAP listed. The REST sandbox is a separate system,
so confirm its labels with `GET /api/did/profiles`, which now lists the REST
routing profiles and the one that is pinned. `GET /api/lnp/profiles` lists the
porting ones.

### MIND city for a rate center

After purchase every number is added to MIND under a city, and MIND has no
city for many espresso rate centers (CHATHAM among them). Each rate center
resolves, in order, to:

1. the MIND city of the same name (case and punctuation ignored), when it is in
   the NPA's province;
2. the nearby city in `MIND_CITY_ALIASES` — e.g. `CHATHAM → WINDSOR`;
3. the NPA's default city in `NPA_MIND_CITY` — e.g. 416/437/647/942 →
   TORONTO, 204/431/584 → WINNIPEG, 519/226/548/382 → LONDON.

Both tables are constants in `server.js`, not env vars; add an alias there when
a rate center has no city of its own. The city is settled when the customer
picks (`/api/did/available` returns it as `mindCity: {id, city, via}`, with
`via` = `exact`, `alias` or `npa`) and again when the order is placed — never
after the numbers are bought. A rate center with no city at all gets
`422 NO_MIND_CITY` (the picker also alerts ops), and the catalog leaves out any
NPA with no default city.

## Run locally

```bash
cp .env.local.example .env.local   # fill in the credentials
npm run dev                        # sources .env.local, then starts
# open http://localhost:3000
```

Or pass them inline:

```bash
ESPRESSO_USER=... ESPRESSO_PASS=... ESPRESSO_MODE=test \
ESPRESSO_CLIENT_ID=... ESPRESSO_CLIENT_SECRET=... \
ESPRESSO_DID_PROFILE='Test Profile' ESPRESSO_LNP_PROFILE=2408 npm start
```

`.env.local` is git-ignored. **Never commit credentials.**

### Test against the sandbox, with its own env file

`.env.local` carries the production-mode settings. Local tests of the ordering
flow use a **separate env file pointed at the sandbox** — `.env.sandbox`, made
from the same example with `ESPRESSO_MODE=test` (REST sandbox host, SOAP test
endpoint) and `ESPRESSO_LNP_MODE=test`, plus `ESPRESSO_REST_USER` /
`ESPRESSO_REST_PASS` if the sandbox login differs:

```bash
cp .env.local.example .env.sandbox   # ESPRESSO_MODE='test', sandbox credentials
sh -c '. ./.env.sandbox; node server.js'
```

Check that the startup log says `via REST https://api-sandbox.espressodid.com`
before placing anything. `.env.sandbox` holds credentials too, so it must be
listed in `.gitignore` alongside `.env.local` — **never commit it.**

## Deploy on Render

The service must be a **Web Service** (not a Static Site):

- Build command: *(none needed)*
- Start command: `npm start`
- Environment variables: all of the above, set in the Render dashboard —
  including `ESPRESSO_CLIENT_ID` / `ESPRESSO_CLIENT_SECRET` **before** a
  REST build deploys, or the picker and ordering come up switched off

### Persistent disk (required before real customers)

Render wipes the filesystem on every redeploy, which would drop the order and
charge records and reopen the double-charge window.

**One disk is enough** — Render allows only one per service, and that is all
this needs, since both stores are files in the same directory.

**Dashboard → service → Disks → Add Disk**, mount path `/var/data`, then set a
single variable:

```
STATE_DIR = /var/data
```

The server creates `order-store.json` and `charge-store.json` there itself; only
the mount has to exist. (`ORDER_STORE_PATH` / `CHARGE_STORE_PATH` still override
individually if you ever need them elsewhere.)

The startup log tells you whether it took effect:

```
  state dir  : /var/data
```

If it instead says `⚠ not a persistent disk — records are lost on redeploy`,
`STATE_DIR` isn't set and duplicate protection won't survive a deploy.

Two Render constraints that come with a disk: the service can no longer run
more than one instance, and zero-downtime deploys are disabled. Both are fine
here — and single-instance is actually required anyway, since the stores are
per-instance files. Sharing them across instances needs a real datastore, which
is the proper pre-launch answer.

The startup log echoes the resolved mode and profiles, so a misconfigured deploy
is visible immediately:

```
OnlineOrdering server on :3000 — espresso mode: production
  DID orders : production via REST https://api.espressodid.com  ← orders are real and billed
  LNP ports  : test  (sandbox — safe to demo)
  DID profile: Profile 718524 DID E164
  LNP profile: 2408
```

It then checks the REST side at startup and every 10 minutes, and logs when
that changes:

```
[espresso] REST readiness — orders: ready | picker: ready
```

`GET /api/config` reports the same as `pickReady` (the inventory answers) and
`didReady` (that, plus the company and routing profile resolve), so the pages
can say "ordering is unavailable" up front instead of after payment.

Without `ESPRESSO_USER` / `ESPRESSO_PASS` the pages still serve, but the
catalog and `/api/lnp/*` return 503 and the number-selection page shows a
catalog error. Without `ESPRESSO_CLIENT_ID` / `ESPRESSO_CLIENT_SECRET` (or
without any REST login) the picker and ordering return 503
`ESPRESSO_NOT_CONFIGURED`, and the startup log says ordering is off.

## API routes

| Route | Method | Purpose |
|---|---|---|
| `/api/config` | GET | Environments and readiness — `{didMode, lnpMode, didApi: 'rest', didReady, pickReady}` |
| `/api/did/catalog` | GET | Rate center + NPA pairs available to order (SOAP) |
| `/api/did/profiles` | GET | REST DID routing profiles on the company, and the pinned one |
| `/api/did/available` | GET | Numbers to pick — `?ratecenter=&npa=&quantity=&email=&exclude=` → up to max(quantity×2, 10) numbers free in espresso **and** MIND, plus `exhausted`, `hidden`, `mindCity` |
| `/api/did/check-picks` | POST | Read-only re-check of the picks before payment — same body as the order → `{ok, unavailable: [{number, reason}]}`, or `{ok: true, orderNumber}` when exactly this order was already placed. Also returns `409 ORDER_IN_PROGRESS` and `422 NO_MIND_CITY` like the order, so both are caught before payment |
| `/api/did/order` | POST | Place the DID order — `{email, accountRef, businessName, trunks, requests: [{ratecenter, npa, quantity, dids?, trunk}]}` |
| `/api/did/order/:ref/status` | GET | `Completed` / `Rejected` / `NeedsReview` / `Processing`, with `statusText` and `reason` |
| `/api/did/order/:ref/details` | GET | Assigned numbers, and `byRequest` — which request each one belongs to |
| `/api/did/order/:ref/problems` | GET | Per-request reject reasons, with `goneDids` — the picks that are no longer available |
| `/api/lnp/portability/:npanxx` | GET | LNP v4: is this NPA-NXX portable? (`1`/`0`/`-1`) |
| `/api/lnp/profiles` | GET | LNP v4: routing profiles for porting |
| `/api/lnp/pon` | POST | LNP v4: create a porting request (PON) — pon_data fields + `numbers[]` |
| `/api/lnp/pon/:pon/status` | GET | LNP v4: last PON status incl. rejection reasons |
| `/api/payment/charge` | POST | Charge a balance — idempotent, keeps the payment key server-side |
| `/api/did/orders/recorded` | GET | Support view of orders this server has placed |

**`/api/did/replace` is gone.** A number that is taken is never bought, so
there are no replacement orders any more.

### Picking and ordering numbers

- **Picking.** `/api/did/available` walks espresso's inventory for the rate
  center (status available, no account, not vanity, OCN `ESPRESSO_OCN`) and
  keeps a number only when MIND agrees it is free on all three lookups: a
  service carrying it, the reserved pool, and the account lookup. Numbers on
  another customer's open order, or in `exclude`, are skipped. `hidden` counts
  numbers MIND holds; `exhausted: true` means espresso has no more than these.
  Nothing is held — the list is a suggestion until the order goes in.
- **Request format.** A request with `dids` (10 digits, in the request's NPA)
  must have `quantity === dids.length`, and no number may be picked twice in
  one order (`400 DUPLICATE_PICK`). A request with only a quantity — porting
  temp numbers, or a page from before the picker — is picked by the server with
  the same checks.
- **Submit.** The picks are checked again, uncached: still in espresso, still
  not in MIND, not on someone else's order. If any are gone the answer is
  `409 NUMBERS_UNAVAILABLE` with `unavailable: [{number, reason}]` (`reason` is
  `espresso`, `mind` or `taken`) and **nothing is bought**.

Error codes the pages branch on (by `code` — the HTTP status can differ by
route):

| Status | `code` | Meaning |
|---|---|---|
| 409 | `NUMBERS_UNAVAILABLE` | Picks gone (or `shortfalls` for quantity-only requests) — nothing bought, pick again |
| 409 | `ORDER_IN_PROGRESS` | Another order is still going for this customer — carries `{orderNumber, orderId}` so the page can follow it |
| 400 | `DUPLICATE_PICK` / `INVALID_REQUEST` | Bad request shape |
| 422 | `NO_MIND_CITY` | No MIND city for the rate center — carries `{index, ratecenter, npa}`, `index` being the request's position in the flattened `requests` |
| 503 | `MIND_UNAVAILABLE` | MIND could not be checked — nothing shown or bought |
| 503 | `ESPRESSO_BUSY` | espresso didn't answer (or didn't confirm an order) — try again shortly |
| 503 | `INVENTORY_FORBIDDEN` | The login may not search inventory or order |
| 503 | `ESPRESSO_NOT_CONFIGURED` / `ESPRESSO_AUTH` / `ESPRESSO_NOT_READY` | REST client missing, login refused, or company/routing profile unresolved |
| 502 | `ESPRESSO_REJECTED` | espresso refused the order outright |

### Order IDs

| Form | Example | Used for |
|---|---|---|
| espresso order id (UUID) | `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` | Every `/api/did/order/:ref/*` call; kept in the `sip_didOrderId` cookie |
| espresso order number | `ORD-261020-XXXXXXXXXXXX` | What people see — pages, emails, IrisBridge, logs, the error dashboard; kept in `sip_didOrderNumber`. Also accepted as `:ref` |
| Legacy SOAP order id | `DID2610150200001` | Orders placed before the switch. Any `:ref` that is neither a UUID nor `ORD-…` goes to the SOAP helpers, and `status` returns the raw SOAP string (`Completed`, `Rejected`, …) |
| Our reference | `oo:<accountRef>:<12 hex>` | Sent with each order, so one whose create answer was lost is found again in espresso instead of being placed twice |

The legacy SOAP branch is only there until every order placed over SOAP is
done.

### Order status

| espresso | `status` | What the status page does |
|---|---|---|
| `COMPLETED` | `Completed` | Puts each number on the trunk it was picked for (`byRequest`) and carries on |
| `REJECTED` / `CANCELLED`, nothing assigned | `Rejected` | Nothing was bought — back to the picker, naming the numbers that are gone (`goneDids`) |
| `FAILED` / `EXPIRED`, or ended with numbers assigned | `NeedsReview` | **Stops.** The server raises a `did-needs-review` alert once; the customer is never sent to buy again |
| `PENDING` / `PROCESSING` | `Processing` | Keeps polling |

An order that completes with different numbers than were picked raises a
`did-order-mismatch` alert.

## Never charging or ordering twice

A customer can close the tab, clear storage, switch device, or double-click
Submit. Any of those used to place a **second billable DID order** or a second
card charge, because the only record lived in the browser.

The browser cannot be what guarantees "only once", so the guarantee sits in
front of the calls that spend money:

- **`/api/did/order`** and **`/api/payment/charge`** are idempotent. A DID
  order is keyed on the customer's email plus the request shape, picked
  numbers included; a charge on the client's `idempotencyKey`, or account +
  amount. Both are deliberately derived rather than random, so they are the
  same even from a fresh browser. A repeat returns the original result with
  `duplicate: true`, and a *different* order while one is still open gets
  `409 ORDER_IN_PROGRESS`.
- A DID order whose create answer never arrived is not retried blindly: it is
  looked up in espresso by its reference and adopted if it exists.
- Records persist to disk (`ORDER_STORE_PATH`, `CHARGE_STORE_PATH`), so a
  restart does not reopen the window. **On Render, point these at a persistent
  disk** — the default location is wiped on redeploy (see below).
- A charge whose outcome was never learned (gateway 502) is recorded as
  `unknown` and every later attempt is refused with 409, because the card may
  already have been charged. A clean decline is retryable.

Browser state now prefers `localStorage` (falling back to `sessionStorage`, then
memory — a cross-origin iframe may block the first), and expires after 24h so a
stale half-order cannot resurface.

**Known limitation:** espresso's order list is per company, not per customer,
so it is only ever searched for our own reference or an exact `ORD-` number,
never used to decide whether a customer has ordered. The persisted store is the
real protection.

## Order flow

1. **numberSelection** — customer chooses rate center / NPA / quantity per
   trunk, then picks the exact numbers from `/api/did/available` (for ports
   these are *temporary* numbers used until the port completes). The first
   number picked for a trunk becomes its main number.
2. **siptrunkLOA** (ports only) — collects the PON data the LNP API needs
   (end user, existing account, dates, service address) with a live
   NPA-NXX portability check; no LOA file upload anymore
3. **sipReview** — `/api/did/check-picks` runs **before** payment, so nobody
   pays for numbers that are already gone. Submit: MIND account → one DID order
   covering all trunks → (ports) PON created via `/api/lnp/pon` → redirect
   immediately. `NUMBERS_UNAVAILABLE` sends the customer back to the picker,
   which names the numbers to replace.
4. **provisioningStatus** — the customer waits here: polls the DID order; on
   `Completed`, puts the numbers on their trunks, adds them to MIND and starts
   UbossRobot trunk provisioning, then polls that job as before. `Rejected`
   goes back to the picker; `NeedsReview` stops. A number MIND refuses after
   purchase (`mind-tn-taken`, a rare race) also stops the order for ops — no
   replacement is ordered. Porting orders also show a live PON status card
   (polls `/api/lnp/pon/:pon/status`)
