# Iristel Online Ordering

Static ordering pages plus a small Node server (`server.js`, no npm dependencies)
that serves them and proxies the **espresso DID Ordering V3 SOAP API** as JSON
under `/api/did/*`.

## Why a server?

Numbers are ordered from the espresso catalog (rate center + NPA + quantity)
instead of picked from stock. The espresso API is SOAP-only, sends no CORS
headers, and needs credentials that must not ship in browser JS — so the browser
talks to this server, and the server talks SOAP.

## Run locally

```bash
ESPRESSO_USER=yourUser ESPRESSO_PASS=yourPass node server.js
# open http://localhost:3000
```

## Deploy on Render

The service must be a **Web Service** (not a Static Site):

- Build command: *(none needed)*
- Start command: `npm start`
- Environment variables:
  - `ESPRESSO_USER` / `ESPRESSO_PASS` — espresso DID API credentials (from Iristel)
  - `ESPRESSO_MODE` — `test` (default) or `production`

Without credentials the pages still serve, but `/api/did/*` returns 503 and the
number-selection page shows a catalog error.

## API routes

| Route | Method | Purpose |
|---|---|---|
| `/api/did/catalog` | GET | Rate center + NPA pairs available to order |
| `/api/did/profiles` | GET | Routing profiles on the espresso account |
| `/api/did/order` | POST | Place a DID order — `{requests: [{ratecenter, npa, quantity}]}` |
| `/api/did/order/:id/status` | GET | Order status (`Processing`/`Approved`/`Completed`/…) |
| `/api/did/order/:id/details` | GET | Ranges + expanded individual numbers (Completed orders only) |

## Order flow

1. **numberSelection** — customer picks rate center / NPA / quantity per trunk
2. **sipReview** submit — MIND account → one DID order covering all trunks
3. **provisioningStatus** — polls the DID order; on `Completed`, distributes the
   assigned numbers across trunks and starts UbossRobot trunk provisioning,
   then polls that job as before
