# Iristel Online Ordering

Static ordering pages plus a small Node server (`server.js`, no npm dependencies)
that serves them and proxies the espresso SOAP APIs as JSON: **DID Ordering V3**
under `/api/did/*` and **LNP (number porting) V4** under `/api/lnp/*`.

## Why a server?

Numbers are ordered from the espresso catalog (rate center + NPA + quantity)
instead of picked from stock. The espresso API is SOAP-only, sends no CORS
headers, and needs credentials that must not ship in browser JS — so the browser
talks to this server, and the server talks SOAP.

## Configuration

| Variable | Purpose |
|---|---|
| `ESPRESSO_USER` / `ESPRESSO_PASS` | espresso credentials (from Iristel) |
| `ESPRESSO_MODE` | `test` (default) or `production` |
| `ESPRESSO_DID_PROFILE` | Routing profile for DID orders |
| `ESPRESSO_LNP_PROFILE` | Routing profile **id** for port requests |
| `PORT` | Listen port (default 3000) |

### The routing profile matters, and differs per environment

The routing profile decides **where an ordered DID actually routes**. Get it
wrong and the failure is silent: the number provisions successfully, the trunk
builds normally, and calls never land. So the profile is pinned by env var, and
the server refuses to place an order if the pinned profile isn't on the account
rather than quietly falling back to another one.

The two environments do **not** carry the same profiles:

| | DID v3 (`ESPRESSO_DID_PROFILE`) | LNP v4 (`ESPRESSO_LNP_PROFILE`) |
|---|---|---|
| `test` | `Test Profile` | `2408` |
| `production` | `Profile 718524 DID E164` | `2408` |

Check what an account actually has with `GET /api/did/profiles` and
`GET /api/lnp/profiles`.

## Run locally

```bash
cp .env.local.example .env.local   # fill in the password
npm run dev                        # sources .env.local, then starts
# open http://localhost:3000
```

Or pass them inline:

```bash
ESPRESSO_USER=... ESPRESSO_PASS=... ESPRESSO_MODE=test \
ESPRESSO_DID_PROFILE='Test Profile' ESPRESSO_LNP_PROFILE=2408 npm start
```

`.env.local` is git-ignored. **Never commit credentials.**

## Deploy on Render

The service must be a **Web Service** (not a Static Site):

- Build command: *(none needed)*
- Start command: `npm start`
- Environment variables: all of the above, set in the Render dashboard

### Persistent disk (required before real customers)

Render wipes the filesystem on every redeploy, which would drop the order and
charge records and reopen the double-charge window. Add a disk:

**Dashboard → service → Disks → Add Disk**, mount path `/var/data`, then set:

```
ORDER_STORE_PATH  = /var/data/order-store.json
CHARGE_STORE_PATH = /var/data/charge-store.json
```

The server creates the files itself; only the mount has to exist.

Two Render constraints that come with a disk: the service can no longer run
more than one instance, and zero-downtime deploys are disabled. Both are fine
here — and single-instance is actually required anyway, since the stores are
per-instance files. Sharing them across instances needs a real datastore, which
is the proper pre-launch answer.

The startup log echoes the resolved mode and profiles, so a misconfigured deploy
is visible immediately:

```
OnlineOrdering server on :3000 — espresso mode: production
  DID profile: Profile 718524 DID E164
  LNP profile: 2408
```

Without credentials the pages still serve, but `/api/did/*` and `/api/lnp/*`
return 503 and the number-selection page shows a catalog error.

## API routes

| Route | Method | Purpose |
|---|---|---|
| `/api/did/catalog` | GET | Rate center + NPA pairs available to order |
| `/api/did/profiles` | GET | Routing profiles on the espresso account |
| `/api/did/order` | POST | Place a DID order — `{requests: [{ratecenter, npa, quantity}]}` |
| `/api/did/order/:id/status` | GET | Order status (`Processing`/`Approved`/`Completed`/…) |
| `/api/did/order/:id/details` | GET | Ranges + expanded individual numbers (Completed orders only) |
| `/api/lnp/portability/:npanxx` | GET | LNP v4: is this NPA-NXX portable? (`1`/`0`/`-1`) |
| `/api/lnp/profiles` | GET | LNP v4: routing profiles for porting |
| `/api/lnp/pon` | POST | LNP v4: create a porting request (PON) — pon_data fields + `numbers[]` |
| `/api/lnp/pon/:pon/status` | GET | LNP v4: last PON status incl. rejection reasons |
| `/api/payment/charge` | POST | Charge a balance — idempotent, keeps the payment key server-side |
| `/api/did/orders/recorded` | GET | Support view of orders this server has placed |

## Never charging or ordering twice

A customer can close the tab, clear storage, switch device, or double-click
Submit. Any of those used to place a **second billable DID order** or a second
card charge, because the only record lived in the browser.

The browser cannot be what guarantees "only once", so the guarantee sits in
front of the calls that spend money:

- **`/api/did/order`** and **`/api/payment/charge`** are idempotent. The key is
  the client's `idempotencyKey`, or a fingerprint of account + request shape —
  deliberately derived rather than random, so it is the same even from a fresh
  browser. A repeat returns the original result with `duplicate: true`.
- Records persist to disk (`ORDER_STORE_PATH`, `CHARGE_STORE_PATH`), so a
  restart does not reopen the window. **On Render, point these at a persistent
  disk** — the default location is wiped on redeploy (see below).
- A charge whose outcome was never learned (gateway 502) is recorded as
  `unknown` and every later attempt is refused with 409, because the card may
  already have been charged. A clean decline is retryable.

Browser state now prefers `localStorage` (falling back to `sessionStorage`, then
memory — a cross-origin iframe may block the first), and expires after 24h so a
stale half-order cannot resurface.

**Known limitation:** espresso's `didGetOrders` is not per-customer — it returns
every order on the company account — so it can only *warn* about a similar
recent order, never block. Two customers ordering `TORONTO 647 x1` on the same
day are indistinguishable there. The persisted store is the real protection.

## Order flow

1. **numberSelection** — customer picks rate center / NPA / quantity per trunk
   (for ports these are *temporary* numbers used until the port completes)
2. **siptrunkLOA** (ports only) — collects the PON data the LNP API needs
   (end user, existing account, dates, service address) with a live
   NPA-NXX portability check; no LOA file upload anymore
3. **sipReview** submit — MIND account → one DID order covering all trunks
   → (ports) PON created via `/api/lnp/pon` → redirect immediately
4. **provisioningStatus** — the customer waits here: polls the DID order; on
   `Completed`, distributes the assigned numbers across trunks and starts
   UbossRobot trunk provisioning, then polls that job as before. Porting
   orders also show a live PON status card (polls `/api/lnp/pon/:pon/status`)
