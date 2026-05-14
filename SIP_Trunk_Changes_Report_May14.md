# Online Ordering Portal - SIP Trunk Module Update Report

**Date:** May 14, 2026
**Module:** SIP Trunk Ordering Flow (`/Sip Trunk/`)
**Status:** Development complete, API integration in test mode

---

## Summary

The SIP Trunk ordering flow has been updated with full API integration for provisioning trunks via the **Broadworks Connector API** and account/service management via the **MIND (Iristel-X) API**. A new number source selection page was added, and the user flow was restructured to support both new number acquisition and number porting paths.

---

## Changes Made (May 13-14, 2026)

### 1. New Page: Number Source Selection (`numberSource.html`)
- **New page** added as Step 2 in the flow (between Business Setup and LOA/Number Selection)
- Presents two options:
  - **Get New Numbers** - Instant activation, skips the LOA page, goes directly to number selection
  - **Port Existing Numbers** - Routes to the Letter of Authorization (LOA) page first, then to number selection with temporary numbers
- Saves the user's choice to cookies (`sip_numberSource`, `sip_isPorting`) for downstream pages

### 2. Updated: Business Setup (`businessSetup.html`)
- **Navigation fix:** "Next" button now correctly links to `numberSource.html` (previously pointed to a broken link `sipTrunkLOA.html` - case mismatch on Linux)
- **Auto-prefill enhancement:** Technical contact fields (first name, last name, email, phone) now auto-populate from the signup cookies (`iristel_user_*`) when the SIP-specific fields are empty, matching the billing contact prefill behavior

### 3. Updated: Number Selection (`numberSelection.html`)
- **Main Number (Primary Number) designation added:**
  - The first selected number is automatically set as the main/primary number
  - Users can change the main number by clicking "Set as main" on any selected number
  - The main number is highlighted with a blue border and "MAIN NUMBER" label
  - A hint explains that the main number maps to `primaryNumber` in the trunk configuration
- The primary number is saved to `sip_primaryNumber` cookie
- In the API payload: main number = `primaryNumber` field, all numbers = `phoneNumbers[]` array

### 4. Updated: LOA Page (`siptrunkLOA.html`)
- **Back button fix:** Now correctly navigates to `numberSource.html` (previously pointed to non-existent `sip-trunk-number-source.html`)

### 5. Updated: Review & Submit (`sipReview.html`) - Major Update
The submit flow now executes a **3-step API integration**:

#### Step 1: Create Business Account in MIND
- **API:** `POST https://api.iristelx.com/accounts`
- **Auth:** `iristelx-api-key` header
- Creates a business account with contact information from the form
- Reuses existing account if `iristel_account_id` cookie already exists (from main signup flow)

#### Step 2: Assign SIP Trunk Service in MIND
- **API:** `POST https://api.iristelx.com/accounts/{accountId}/services`
- **Auth:** `iristelx-api-key` header
- **Plan Code:** `EXLNP_EXTRUNK`
- Links the SIP Trunk service to the customer account in the billing system

#### Step 3: Provision Trunk in Broadworks
- **API:** `POST http://100.67.14.26:8099/api/trunk/provision`
- **Auth:** `X-Api-Key` header
- Sends the provisioning payload:
  ```json
  {
    "enterpriseId": "<sanitized business name>",
    "phoneNumbers": ["+14168001185", "+14168001186"],
    "actualMaxCalls": 2,
    "primaryNumber": "+14168001186"
  }
  ```
- The Broadworks API executes a 14-step provisioning process (enterprise creation, DN assignment, user creation, trunk group setup, pilot user configuration, etc.)

#### Additional Submit Page Changes
- Progressive status indicators during submission: "Creating account..." -> "Assigning SIP Trunk service..." -> "Provisioning trunk..."
- Error handling with retry capability for each step
- Success modal updated to display the **Trunk Group Password** returned by Broadworks
- Review page shows "(Main)" badge next to the primary number
- Phone numbers are converted from display format `(416) 555-1001` to E.164 format `+14165551001` before sending to APIs

#### Test Mode
- A `TEST_MODE = true` flag is enabled at the top of the script
- When enabled, all 3 API calls are simulated with mock responses and console logging
- Full request payloads are logged to the browser console for verification
- **Set `TEST_MODE = false` to enable real API calls**

---

## Updated User Flow

```
Step 1: Business Setup (businessSetup.html)
   |
Step 2: Number Source Choice (numberSource.html)  <-- NEW
   |
   +-- "Get New Numbers" --> Step 3: Number Selection (numberSelection.html)
   |
   +-- "Port Existing" ----> Step 3: LOA (siptrunkLOA.html)
                                |
                             Step 4: Number Selection (numberSelection.html)
                                       (temporary numbers mode)
   |
Step 5: User Assignment (userAssignment.html)
   |
Step 6: Review & Submit (sipReview.html)
           |
           +--> MIND: Create Account
           +--> MIND: Assign EXLNP_EXTRUNK Service
           +--> Broadworks: Provision Trunk
           |
         Success -> Trunk Group Password displayed
```

---

## Files Modified

| File | Status | Description |
|------|--------|-------------|
| `Sip Trunk/numberSource.html` | **NEW** | Number source choice page (new vs. port) |
| `Sip Trunk/businessSetup.html` | Modified | Navigation fix, tech contact auto-prefill |
| `Sip Trunk/numberSelection.html` | Modified | Primary/main number selection |
| `Sip Trunk/siptrunkLOA.html` | Modified | Back button navigation fix |
| `Sip Trunk/sipReview.html` | Modified | Full 3-step API integration (MIND + Broadworks) |
| `Sip Trunk/userAssignment.html` | Unchanged | No changes |

---

## API Endpoints Used

| API | Endpoint | Purpose |
|-----|----------|---------|
| Iristel-X (MIND) | `POST /accounts` | Create business account |
| Iristel-X (MIND) | `POST /accounts/{id}/services` | Assign SIP Trunk service (EXLNP_EXTRUNK) |
| Broadworks Connector | `POST /api/trunk/provision` | Provision trunk group, users, DNs |

---

## Next Steps / Notes
- `TEST_MODE` is currently **enabled** - set to `false` in `sipReview.html` before going live
- The portal is static HTML/JS with no build step required - can be served from any web server or opened directly in a browser
- All state is managed via browser cookies (7-day expiry)
