        const provinceNames = {
            'AB': 'Alberta', 'BC': 'British Columbia', 'MB': 'Manitoba',
            'NB': 'New Brunswick', 'NL': 'Newfoundland and Labrador',
            'NS': 'Nova Scotia', 'ON': 'Ontario', 'PE': 'Prince Edward Island',
            'QC': 'Quebec', 'SK': 'Saskatchewan'
        };

        const packageNames = {
            'business-trunk': 'Business Trunk',
            'standard': 'Standard',
            'premium': 'Premium'
        };

        // UBoss config / formatToE164 / describeApiError now live
        // in sip-provisioning-common.js, shared with provisioningStatus.html.

        function setText(id, value) {
            const el = document.getElementById(id);
            if (value && value.trim()) {
                el.textContent = value;
                el.classList.remove('empty');
            } else {
                el.textContent = '--';
                el.classList.add('empty');
            }
        }

        function loadReviewData() {
            // Business Information
            setText('revBusinessName', getCookie('sip_businessName'));
            setText('revSiteName', getCookie('sip_siteName'));

            const addr1 = getCookie('sip_address1') || '';
            const addr2 = getCookie('sip_address2') || '';
            setText('revAddress', addr2 ? `${addr1}, ${addr2}` : addr1);

            const city = getCookie('sip_city') || '';
            const province = getCookie('sip_province') || '';
            setText('revCityProvince', `${city}${province ? ', ' + (provinceNames[province] || province) : ''}`);
            setText('revPostalCode', getCookie('sip_postalCode'));

            const country = getCookie('sip_country');
            setText('revCountry', country === 'CA' ? 'Canada' : country === 'US' ? 'United States' : country);

            // Contacts
            const billingFirst = getCookie('sip_billingFirstName') || '';
            const billingLast = getCookie('sip_billingLastName') || '';
            setText('revBillingName', `${billingFirst} ${billingLast}`.trim());
            setText('revBillingEmail', getCookie('sip_billingEmail'));
            setText('revBillingPhone', getCookie('sip_billingPhone'));

            const techFirst = getCookie('sip_techFirstName') || '';
            const techLast = getCookie('sip_techLastName') || '';
            setText('revTechName', `${techFirst} ${techLast}`.trim());
            setText('revTechEmail', getCookie('sip_techEmail'));
            setText('revTechPhone', getCookie('sip_techPhone'));

            // Port Information
            if (isPortingOrder()) {
                document.getElementById('portCard').style.display = 'block';
                document.getElementById('numbersTitle').textContent = 'Temporary Numbers';

                const portNumbers = getCookie('sip_portNumbers');
                if (portNumbers) {
                    try {
                        const nums = JSON.parse(portNumbers);
                        document.getElementById('revPortNumbers').innerHTML = nums.map(n =>
                            `<span class="number-chip">${n}</span>`
                        ).join('');
                    } catch (e) {}
                }

                // Port request (PON) details collected on the port-in page
                let ponData = null;
                try { ponData = JSON.parse(getCookie('sip_ponData') || 'null'); } catch (e) {}
                if (ponData) {
                    setText('revPonEndUser', ponData.end_user_name);
                    setText('revPonAccount', ponData.existing_account_number);
                    setText('revPonAuthDate', ponData.auth_date);
                    setText('revPonDueDate', ponData.desired_due_date);
                    const addr = [ponData.house_number, ponData.street_name, ponData.street_type].filter(Boolean).join(' ');
                    setText('revPonAddress', [addr, ponData.city, ponData.province_state, ponData.zip_code].filter(Boolean).join(', '));
                }
            }

            // Selected Numbers — multi-trunk aware
            const trunksData = getCookie('sip_trunks');
            if (trunksData) {
                try {
                    const trunksList = JSON.parse(trunksData);
                    if (Array.isArray(trunksList) && trunksList.length > 0) {
                        document.getElementById('revSelectedNumbers').innerHTML = trunksList.map(trunk => {
                            // Concrete numbers when they exist; otherwise the
                            // rate-center requests this order will place
                            let chips;
                            if (trunk.numbers && trunk.numbers.length > 0) {
                                chips = trunk.numbers.map(n =>
                                    n === trunk.primaryNumber
                                        ? `<span class="number-chip pilot">${n} (Main)</span>`
                                        : `<span class="number-chip">${n}</span>`
                                ).join('');
                            } else {
                                chips = (trunk.requests || []).map(r =>
                                    `<span class="number-chip">${r.ratecenter} (${r.npa}) &times; ${r.quantity}</span>`
                                ).join('') || '<span class="number-chip">No numbers requested</span>';
                                chips += '<div style="font-size:12px;color:var(--text-gray);margin-top:6px;">Numbers are assigned when your order is processed.</div>';
                            }
                            return `<div style="margin-bottom:12px;"><strong style="font-size:13px;color:#004a9f;">${trunk.name}</strong><div style="margin-top:6px;">${chips}</div></div>`;
                        }).join('');
                    }
                } catch (e) {}
            } else {
                // Fallback: old single-trunk format
                const selectedNumbers = getCookie('sip_selectedNumbers');
                const revPrimary = getCookie('sip_primaryNumber') || '';
                if (selectedNumbers) {
                    try {
                        const nums = JSON.parse(selectedNumbers);
                        if (nums.length > 0) {
                            document.getElementById('revSelectedNumbers').innerHTML = nums.map(n =>
                                n === revPrimary
                                    ? `<span class="number-chip pilot">${n} (Main)</span>`
                                    : `<span class="number-chip">${n}</span>`
                            ).join('');
                        }
                    } catch (e) {}
                }
            }

            // Users
            const usersData = getCookie('sip_users');
            const pilotUserId = getCookie('sip_pilotUser');
            if (usersData) {
                try {
                    const users = JSON.parse(usersData);
                    if (users.length > 0) {
                        document.getElementById('usersReviewBody').innerHTML = users.map(user => {
                            const isPilot = String(user.id) === String(pilotUserId);
                            return `<tr>
                                <td>${user.firstName} ${user.lastName}${isPilot ? '<span class="pilot-badge">Pilot User</span>' : ''}</td>
                                <td style="font-family: 'Courier New', monospace;">${user.number || '--'}</td>
                                <td>${packageNames[user.package] || user.package}</td>
                            </tr>`;
                        }).join('');
                    }
                } catch (e) {}
            }
        }

        function updateSubmitButton() {
            document.getElementById('submitBtn').disabled = !document.getElementById('agreeTerms').checked;
        }

        // MIND stores Canadian postal codes as "A1A 1A1" — send them back in that shape
        function formatPostalCode(postalCode) {
            const raw = (postalCode || '').toUpperCase().replace(/\s/g, '');
            if (/^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(raw)) {
                return raw.slice(0, 3) + ' ' + raw.slice(3);
            }
            return postalCode || '';
        }

        function sanitizeEnterpriseId(name) {
            // Remove special chars, replace spaces with underscores, lowercase
            return name.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_').toLowerCase();
        }

        // ============================================
        // MIND / Iristel-X API Configuration
        // ============================================
        const MIND_API_URL = 'https://api.iristelx.com';
        const MIND_API_KEY = 'HRT88y2qywc6fwX779zG2D8fJtJQJbvz';
        // The payment key is deliberately NOT here — charges go through
        // /api/payment/charge so the credential never reaches the browser.

        // ============================================
        // TRUNK (Broadworks) API Configuration — DEPRECATED
        // Replaced by UbossRobot API below
        // ============================================
        // const TRUNK_API_URL = 'http://100.67.14.26:8099/api/trunk/provision';
        // const TRUNK_API_KEY = '3c901f55e7864d2aae31b08c9746f9132d8847f1acb94c65b0897e3624f1edc6';

        // ============================================
        // Payment Status (already collected before business setup)
        // ============================================
        // Pricing constants
        const CHANNEL_PRICE = 25.00;  // $25/mo per channel

        // ============================================
        // PROMO CODE
        // Entered on this page because this is where the card is charged. It
        // discounts the balance down to $0.01 — NOT to zero: the remaining
        // cent still has to be charged to the card before submitting, so
        // every promo order exercises the real payment path end to end.
        // ============================================
        const PROMO_CHARGE = 0.01;
        function getAppliedPromo() {
            return getCookie('iristel_promo_code') === 'TEST' ? 'TEST' : null;
        }

        function applyPromo() {
            const code = (document.getElementById('promoCode').value || '').trim().toUpperCase();
            const msg = document.getElementById('promoMessage');

            if (code === 'TEST') {
                setCookie('iristel_promo_code', 'TEST');
                msg.textContent = 'Promo applied — $0.01 card verification charge';
                msg.style.color = 'var(--success-green)';
            } else {
                deleteCookie('iristel_promo_code');
                msg.textContent = code.length > 0 ? 'Invalid promo code' : '';
                msg.style.color = '#EF4444';
            }

            // Re-price against the new promo state
            loadPaymentStatus();
            loadPricingBreakdown();
        }

        function loadPaymentStatus() {
            const ref = getCookie('iristel_payment_reference');
            const amount = parseFloat(getCookie('iristel_payment_amount') || '0');
            const token = getCookie('iristel_payment_token');
            const cardLast4 = getCookie('iristel_payment_card_last4') || '';
            const promo = getAppliedPromo();
            const statusEl = document.getElementById('paymentStatus');

            if (amount > 0 && ref) {
                // Payment has been charged
                document.getElementById('payRefDisplay').textContent = ref;
                document.getElementById('payAmountDisplay').textContent = `$${amount.toFixed(2)} charged`;
                statusEl.querySelector('strong').textContent = 'Payment confirmed';
                statusEl.style.background = '#f0fdf4';
                statusEl.style.borderColor = '#86efac';
                statusEl.querySelector('.check-icon').style.background = '#22c55e';
            } else if (token) {
                // Card saved but not yet charged
                document.getElementById('payRefDisplay').textContent = cardLast4 ? `Card ending in ${cardLast4}` : 'Card on file';
                document.getElementById('payAmountDisplay').textContent = promo
                    ? `$0.01 verification charge due — promo ${promo} applied`
                    : 'Not yet charged';
                statusEl.querySelector('strong').textContent = 'Card saved';
                statusEl.style.background = '#eff6ff';
                statusEl.style.borderColor = '#93c5fd';
                statusEl.querySelector('.check-icon').style.background = '#3b82f6';
            } else {
                document.getElementById('payRefDisplay').textContent = '--';
                document.getElementById('payAmountDisplay').textContent = 'No card on file';
                statusEl.querySelector('strong').textContent = 'Payment required';
                statusEl.style.background = '#fef2f2';
                statusEl.style.borderColor = '#fca5a5';
                statusEl.querySelector('.check-icon').style.background = '#ef4444';
            }
        }

        function loadPricingBreakdown() {
            // Applying a promo re-runs this, so drop the footer rows a previous
            // render appended — otherwise every keystroke stacks another set.
            const tfoot = document.getElementById('pricingTable').querySelector('tfoot');
            const totalRow = tfoot.querySelector('.pricing-total-row');
            while (totalRow.nextElementSibling) {
                totalRow.nextElementSibling.remove();
            }

            const body = document.getElementById('pricingBody');
            const trunksData = getCookie('sip_trunks');
            let totalMonthly = 0;
            let trunkCount = 1;
            let rows = '';

            if (trunksData) {
                try {
                    const trunksList = JSON.parse(trunksData);
                    if (Array.isArray(trunksList) && trunksList.length > 0) {
                        trunkCount = trunksList.length;

                        trunksList.forEach((trunk) => {
                            const channels = trunk.channels || 1;
                            const channelCost = channels * CHANNEL_PRICE;

                            rows += `<tr>
                                <td class="pricing-trunk-label">${trunk.name}</td>
                                <td style="text-align:center;">${channels} ch</td>
                                <td style="text-align:right;">$${CHANNEL_PRICE.toFixed(2)}/ch/mo</td>
                                <td style="text-align:right;">$${channelCost.toFixed(2)}</td>
                            </tr>`;

                            totalMonthly += channelCost;
                        });

                        if (trunkCount > 1) {
                            document.getElementById('additionalTrunkNotice').style.display = 'block';
                        }
                    }
                } catch (e) {}
            }

            // Fallback: single trunk from old cookie format
            if (!rows) {
                const channels = 1;
                const channelCost = channels * CHANNEL_PRICE;

                rows = `<tr>
                    <td class="pricing-trunk-label">SIP Trunk</td>
                    <td style="text-align:center;">${channels} ch</td>
                    <td style="text-align:right;">$${CHANNEL_PRICE.toFixed(2)}/ch/mo</td>
                    <td style="text-align:right;">$${channelCost.toFixed(2)}</td>
                </tr>`;

                totalMonthly = channelCost;
            }

            body.innerHTML = rows;
            document.getElementById('pricingTotal').textContent = '$' + totalMonthly.toFixed(2) + '/mo';

            // Calculate remaining balance vs the promo and what was already paid
            const paidAmount = parseFloat(getCookie('iristel_payment_amount') || '0');
            const promo = getAppliedPromo();
            const tax = +(totalMonthly * 0.13).toFixed(2);
            const totalWithTax = +(totalMonthly + tax).toFixed(2);
            // The promo leaves one cent to charge — the card must still be
            // exercised for real before the order can be submitted.
            const promoDiscount = promo ? Math.max(0, +(totalWithTax - PROMO_CHARGE).toFixed(2)) : 0;
            const remaining = +(totalWithTax - promoDiscount - paidAmount).toFixed(2);

            // Always show tax and total with tax
            let footerRows = `
                <tr>
                    <td colspan="3" style="text-align:right;font-size:13px;color:var(--text-gray);">Tax (13%)</td>
                    <td style="text-align:right;font-size:13px;color:var(--text-gray);">$${tax.toFixed(2)}</td>
                </tr>
                <tr>
                    <td colspan="3" style="text-align:right;font-size:13px;color:var(--text-gray);">Total with tax</td>
                    <td style="text-align:right;font-size:13px;color:var(--text-gray);">$${totalWithTax.toFixed(2)}</td>
                </tr>
                <tr>
                    <td colspan="3" style="text-align:right;font-size:13px;color:var(--text-gray);">Already paid</td>
                    <td style="text-align:right;font-size:13px;color:var(--success-green);">-$${paidAmount.toFixed(2)}</td>
                </tr>`;

            if (promoDiscount > 0) {
                footerRows += `
                    <tr>
                        <td colspan="3" style="text-align:right;font-size:13px;color:var(--text-gray);">Promo code (${promo})</td>
                        <td style="text-align:right;font-size:13px;color:var(--success-green);">-$${promoDiscount.toFixed(2)}</td>
                    </tr>`;
            }

            if (remaining > 0) {
                footerRows += `
                    <tr>
                        <td colspan="3" style="text-align:right;font-weight:700;">Remaining Balance</td>
                        <td style="text-align:right;font-weight:700;font-size:16px;color:var(--magenta-glow);">$${remaining.toFixed(2)}</td>
                    </tr>`;

                if (!unreconciledCharge) {
                    footerRows += `
                    <tr>
                        <td colspan="4" style="text-align:right;padding-top:12px;">
                            <button class="btn-edit" id="chargeBalanceBtn" onclick="chargeRemainingBalance(${remaining})" style="background:var(--tufts-blue);color:#fff;padding:8px 20px;">
                                Charge $${remaining.toFixed(2)} to card on file
                            </button>
                        </td>
                    </tr>`;
                }
            } else {
                footerRows += `
                    <tr>
                        <td colspan="3" style="text-align:right;font-weight:600;color:var(--success-green);">${promoDiscount > 0 ? 'No Payment Due' : 'Fully Paid'}</td>
                        <td style="text-align:right;font-weight:600;color:var(--success-green);">$0.00</td>
                    </tr>`;
            }

            // A charge whose outcome we never learned outlives the balance it was for:
            // a promo can take the balance to $0.00, but the card may still have been
            // charged, so the reference stays on screen either way.
            if (unreconciledCharge) {
                footerRows += `
                    <tr>
                        <td colspan="4" style="text-align:right;padding-top:12px;font-size:13px;color:#EF4444;line-height:1.6;">
                            ${UNRECONCILED_NOTICE}<br>Reference: ${unreconciledCharge.reference}
                        </td>
                    </tr>`;
            }

            totalRow.insertAdjacentHTML('afterend', footerRows);

            // Store remaining for submitOrder check
            window._remainingBalance = remaining;
        }

        // ============================================
        // BALANCE CHARGE
        // ============================================
        // An attempt that ends without a readable response leaves the outcome unknown —
        // the card may already have been charged. Recorded here so every later render
        // honours it: re-pricing rebuilds the footer, and a fresh button would invite
        // exactly the second charge we can't rule out.
        const UNRECONCILED_NOTICE = 'Payment service unavailable — do not retry, contact support.';
        let unreconciledCharge = null;

        function unknownOutcome(detail) {
            const err = new Error(detail);
            err.outcomeUnknown = true;
            return err;
        }

        // Charge remaining balance using saved card token
        async function chargeRemainingBalance(amount) {
            const btn = document.getElementById('chargeBalanceBtn');
            const token = getCookie('iristel_payment_token');
            const accountCode = getCookie('iristel_account_id') || '7142292';

            if (!token) {
                showAlert('No saved card found. Please go back to the payment step.', 'error', 'No card on file');
                if (window.IrisBridge) window.IrisBridge.error('No saved card found. Please go back to the payment step.');
                return;
            }

            // A card saved before the full-payload change has only the token. Sending
            // the API a half-filled creditCard is what it cannot handle, so stop here
            // rather than repeat the call that fails.
            const cardDetailsMissing = ['iristel_payment_card_code', 'iristel_payment_card_masked',
                                        'iristel_payment_card_expmonth', 'iristel_payment_card_expyear',
                                        'iristel_payment_card_holder'].some(c => !getCookie(c));
            if (cardDetailsMissing) {
                const msg = 'Your saved card is missing details this payment needs. Please go back to the payment step and re-enter the card.';
                showAlert(msg, 'error', 'Card details incomplete');
                if (window.IrisBridge) window.IrisBridge.error(msg);
                return;
            }

            btn.disabled = true;
            btn.textContent = 'Processing...';

            // Outside the try: the catch reports it, because it is the only handle
            // support has on a charge that may have gone through.
            const reference = 'IRS-BAL-' + Date.now().toString(36).toUpperCase();

            try {
                // The payment API expects the full creditCard object — code, masked
                // number, token, expDate and holder. Sending the token alone is not
                // enough; the fields are saved at tokenization on the payment page.
                const requestBody = {
                    amount: amount.toFixed(2),
                    creditCard: {
                        code: getCookie('iristel_payment_card_code') || '',
                        number: getCookie('iristel_payment_card_masked') || '',
                        token: token,
                        expDate: {
                            expMonth: getCookie('iristel_payment_card_expmonth') || '',
                            expYear: getCookie('iristel_payment_card_expyear') || ''
                        },
                        holder: getCookie('iristel_payment_card_holder') || ''
                    },
                    reference: reference
                };

                // Charged through our server, not straight to the billing API: it
                // de-duplicates the charge, keeps the payment key off the client,
                // and can read the real HTTP status (a gateway 502 reaches the
                // browser without CORS headers, so from here it was unreadable).
                console.log('[CHARGE BALANCE] POST /api/payment/charge');

                let response;
                try {
                    response = await fetch('/api/payment/charge', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            accountCode: accountCode,
                            amount: amount.toFixed(2),
                            creditCard: requestBody.creditCard,
                            idempotencyKey: accountCode + '::' + amount.toFixed(2),
                            // Lets the server tell a duplicate from a genuine
                            // second purchase: once an order is provisioned the
                            // guard is released, so buying again is charged.
                            email: customerEmail(getContactDataFromCookies())
                        })
                    });
                } catch (networkErr) {
                    // Our own server is unreachable — the charge never left here
                    throw new Error('Could not reach the payment service: ' + networkErr.message);
                }

                const data = await response.json().catch(() => null);

                if (!response.ok) {
                    // 502 = the server tried but could not learn the outcome, so the
                    // card may have been charged. 409 = a previous attempt already
                    // ended that way. Both must not be retried.
                    if (response.status === 502 || response.status === 409) {
                        throw unknownOutcome((data && data.error) || `HTTP ${response.status}`);
                    }
                    throw new Error((data && data.error) || `Payment failed (HTTP ${response.status})`);
                }

                if (data && data.duplicate) {
                    console.log('Balance already charged under reference', data.reference, '— not charged again');
                }

                // Update the paid amount cookie
                const previousPaid = parseFloat(getCookie('iristel_payment_amount') || '0');
                const newTotal = +(previousPaid + amount).toFixed(2);
                setCookie('iristel_payment_amount', newTotal.toString());
                setCookie('iristel_payment_reference_balance', reference);

                if (window.IrisBridge) window.IrisBridge.paymentSuccess(reference, amount.toFixed(2));

                // Update UI
                btn.textContent = 'Charged successfully';
                btn.style.background = 'var(--success-green)';
                document.getElementById('payAmountDisplay').textContent = `$${newTotal.toFixed(2)} charged`;

                // Replace remaining balance row with "Fully Paid"
                setTimeout(() => {
                    loadPricingBreakdown();
                    loadPaymentStatus();
                    window._remainingBalance = 0;
                }, 1500);

            } catch (err) {
                console.error('Balance charge failed:', err);

                if (err.outcomeUnknown) {
                    // Whether the card was charged is unknowable from here, so the
                    // button does not come back — re-rendering replaces it with the
                    // reference support needs to reconcile the attempt.
                    unreconciledCharge = { reference };
                    loadPricingBreakdown();

                    const message = `${UNRECONCILED_NOTICE} Reference: ${reference}`;
                    showAlert(message, 'error', 'Payment outcome unknown');
                    if (window.IrisBridge) window.IrisBridge.paymentFailed(message);
                    return;
                }

                btn.disabled = false;
                btn.textContent = `Charge $${amount.toFixed(2)} to card on file`;
                btn.style.background = '';
                showAlert(err.message, 'error', 'Payment failed');
                if (window.IrisBridge) window.IrisBridge.paymentFailed(err.message);
            }
        }

        function updateStatusMessage(message) {
            const submitBtn = document.getElementById('submitBtn');
            submitBtn.innerHTML = `
                <svg viewBox="0 0 20 20" fill="currentColor" style="animation: spin 1s linear infinite;">
                    <path fill-rule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clip-rule="evenodd"/>
                </svg>
                ${message}
            `;
        }

        function resetSubmitButton() {
            const submitBtn = document.getElementById('submitBtn');
            submitBtn.disabled = false;
            submitBtn.innerHTML = `
                <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg>
                Submit Order
            `;
        }

        // ============================================
        // STEP 1: Create business account in MIND
        // ============================================
        // Created through our server so it is guarded by email: a customer
        // returning on another device would otherwise sign up again, get a
        // second MIND account, and — because the order guard keys off the
        // account — be billed for a second set of numbers.
        async function createMindAccount(contactData, knownAccountId) {
            console.log('[STEP 1] Create account — POST /api/account');
            const response = await fetch('/api/account', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: customerEmail(contactData),
                    contact: { ...contactData, language: getCookie('iristel_user_language') || 'en' },
                    // Hand over an id the browser already has so the server can
                    // record the mapping instead of creating a second account
                    accountId: knownAccountId || undefined
                })
            });

            const data = await response.json().catch(() => null);
            console.log('Create Account Response:', data);

            if (!response.ok || !data || !data.accountId) {
                throw new Error((data && data.error) || `Account creation failed (HTTP ${response.status})`);
            }
            if (data.reused) console.log('Existing account reused — no duplicate created');
            return data.accountId;
        }

        // ============================================
        // STEP 3b: Submit the porting request (PON) via the LNP API
        // ============================================
        // Creation is quick; the STATUS page owns tracking it afterwards.
        // The email is what every server-side guard keys on — it is the only
        // identifier that survives a new device or a cleared browser.
        function customerEmail(contactData) {
            return (contactData && contactData.emailAddress)
                || getCookie('sip_billingEmail')
                || getCookie('iristel_user_email')
                || '';
        }

        // sip_ponNumber makes this idempotent across submit retries.
        async function submitPortRequest() {
            const existing = getCookie('sip_ponNumber');
            if (existing) {
                console.log('Re-using existing PON:', existing);
                return existing;
            }

            let ponData = null;
            try { ponData = JSON.parse(getCookie('sip_ponData') || 'null'); } catch (e) {}
            if (!ponData || !Array.isArray(ponData.numbers) || !ponData.numbers.length) {
                throw new Error('Port request details are missing. Please go back to the Port Request step and fill them in.');
            }

            console.log('[STEP 3b] LNP Create PON — POST /api/lnp/pon');
            const response = await fetch('/api/lnp/pon', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...ponData, email: customerEmail(getContactDataFromCookies()) })
            });
            const data = await response.json().catch(() => null);
            console.log('LNP Create PON Response:', data);
            if (!response.ok || !data || !data.pon) {
                throw new Error('Port request failed: ' + ((data && data.error) || ('HTTP ' + response.status)));
            }

            setCookie('sip_ponNumber', data.pon);
            return data.pon;
        }

        // ============================================
        // SUBMIT ORDER
        // (Payment already collected before business setup)
        // 1. Create business account in MIND
        // 2. Record the SIP Trunk service (already assigned at plan selection)
        // 3. Place the espresso DID order for the (temporary) numbers — do NOT
        //    wait for it here; the status page polls it, distributes the numbers
        //    and starts UBoss provisioning once they arrive
        // 3b. Porting orders: create the PON via the LNP API
        // Then redirect to provisioningStatus.html, where the customer waits.
        // ============================================
        async function submitOrder() {
            if (!document.getElementById('agreeTerms').checked) {
                showAlert('Please agree to the Terms of Service before submitting.', 'info', 'Almost there');
                if (window.IrisBridge) window.IrisBridge.error('Please agree to the Terms of Service before submitting.', 'agreeTerms');
                return;
            }

            // Verify card was saved. A promo zeroes the CHARGE, never the card
            // requirement — every order must have a payment method on file,
            // even when $0 is charged.
            if (!getCookie('iristel_payment_token')) {
                showAlert('No payment card on file. Please go back and save a card first.', 'error', 'No card on file');
                if (window.IrisBridge) window.IrisBridge.error('No payment card on file. Please go back and save a card first.');
                return;
            }

            const submitBtn = document.getElementById('submitBtn');
            submitBtn.disabled = true;

            const contactData = getProvisioningContactData();

            // Get primary number
            const savedPrimary = getCookie('sip_primaryNumber') || getCookie('sip_billingPhone') || '';
            const primaryNumber = savedPrimary ? formatToE164(savedPrimary) : '';

            // The status page renders steps 1 and 2 from these — never assume success
            clearOrderStepResults();

            try {
                // ---- STEP 1: Create MIND Account ----
                let accountId = getCookie('iristel_account_id');

                try {
                    // Always go through the server, even when the browser
                    // already knows the account. Skipping the call meant the
                    // email-to-account mapping was never recorded, so a resume
                    // on a fresh browser showed the account step as pending
                    // work that had in fact been done long ago.
                    const hadAccount = !!accountId;
                    updateStatusMessage(hadAccount ? 'Checking your account...' : 'Creating account...');
                    accountId = await createMindAccount(contactData, accountId);
                    setCookie('iristel_account_id', accountId);
                    console.log(hadAccount ? 'Using existing MIND account:' : 'MIND Account created:', accountId);
                    setOrderStepResult('account', 'done', hadAccount
                        ? 'Using existing account ' + accountId
                        : 'Business account ' + accountId + ' created');
                } catch (err) {
                    setOrderStepResult('account', 'error', err.message);
                    throw err;
                }

                // ---- STEP 2: SIP Trunk service ----
                // Already assigned at plan selection (sipTrunkSelection.js), so there
                // is nothing to call here — assigning a second time only asks MIND to
                // add a package the account already has. The step is still recorded
                // because the status page renders it.
                const assignedPlan = getCookie('iristel_selected_plan_name')
                    || getCookie('iristel_selected_plan') || 'SIP Trunk';
                setOrderStepResult('service', 'done', assignedPlan + ' active on your account');

                // Check remaining balance
                if (window._remainingBalance > 0) {
                    showAlert('Please pay the remaining balance of $' + window._remainingBalance.toFixed(2) + ' before submitting.', 'info', 'Balance outstanding');
                    if (window.IrisBridge) window.IrisBridge.error('Remaining balance of $' + window._remainingBalance.toFixed(2) + ' must be paid before submitting.');
                    resetSubmitButton();
                    return;
                }

                // ---- STEP 3: Place the number order (espresso DID) ----
                // espresso is ONLY the number source: rate center + NPA + quantity
                // go in. The order is only PLACED here — the status page polls it,
                // distributes the numbers and starts UBoss provisioning; the
                // customer waits there, not on this button.
                let trunksList = loadTrunksFromCookie();
                if (trunksList.length === 0) {
                    trunksList = [{ name: 'Trunk 1', channels: 1, requests: [], numbers: primaryNumber ? [primaryNumber] : [], primaryNumber: primaryNumber }];
                    setCookie('sip_trunks', JSON.stringify(trunksList));
                }

                if (trunksNeedNumbers(trunksList)) {
                    // Re-use an order placed by an earlier submit attempt
                    // instead of ordering the numbers twice.
                    let didOrderNumber = getCookie('sip_didOrderNumber');
                    if (!didOrderNumber) {
                        updateStatusMessage('Placing your number order...');
                        const allRequests = trunksList.flatMap(t => t.requests || []);
                        // The account and a stable key let the server recognise a
                        // repeat of THIS order and return the original instead of
                        // billing a second one — protection that survives the
                        // browser losing its state entirely.
                        const orderResponse = await fetch('/api/did/order', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                requests: allRequests,
                                email: customerEmail(contactData),
                                accountRef: accountId || getCookie('iristel_account_id') || null,
                                // Snapshot so another device can rebuild the
                                // order rather than the customer redoing it
                                trunks: trunksList,
                                businessName: getCookie('sip_businessName') || null
                            })
                        });
                        const orderData = await orderResponse.json().catch(() => null);
                        if (!orderResponse.ok || !orderData || !orderData.orderNumber) {
                            throw new Error('Number order failed: ' + ((orderData && orderData.error) || ('HTTP ' + orderResponse.status)));
                        }
                        didOrderNumber = orderData.orderNumber;
                        setCookie('sip_didOrderNumber', didOrderNumber);
                        console.log('DID order placed:', didOrderNumber,
                            orderData.duplicate ? '(existing order re-used — not billed again)' : '');
                    } else {
                        console.log('Resuming DID order:', didOrderNumber);
                    }
                } else if (!trunksList.some(t => t.numbers && t.numbers.length)) {
                    throw new Error('No trunk has number requests or numbers to provision.');
                }

                // ---- STEP 3b: Porting orders — create the PON (LNP API) ----
                if (isPortingOrder()) {
                    updateStatusMessage('Submitting your port request...');
                    try {
                        const pon = await submitPortRequest();
                        setOrderStepResult('port', 'done', 'Port request ' + pon + ' submitted to the losing carrier');
                    } catch (err) {
                        setOrderStepResult('port', 'error', err.message);
                        throw err;
                    }
                }

                // The status page starts UBoss once the numbers exist — clear any
                // job state left over from a previous order.
                deleteCookie('sip_provisionJobId');
                deleteCookie('sip_provisionJobs');
                deleteCookie('sip_provisionResult');

                if (window.IrisBridge) window.IrisBridge.orderComplete(getCookie('sip_didOrderNumber') || getCookie('sip_ponNumber') || accountId);

                updateStatusMessage('Order submitted — opening status...');
                window.location.href = 'provisioningStatus.html';

            } catch (err) {
                console.error('Order submission failed:', err);
                showAlert(err.message, 'error', 'Order submission failed');
                if (window.IrisBridge) window.IrisBridge.error('Order submission failed: ' + err.message);
                resetSubmitButton();
            }
        }

        document.addEventListener('DOMContentLoaded', function() {
            loadUserInfoBar();
            loadReviewData();

            // Show a promo already applied — e.g. after stepping back into an edit
            const savedPromo = getAppliedPromo();
            if (savedPromo) {
                document.getElementById('promoCode').value = savedPromo;
            }

            loadPaymentStatus();
            loadPricingBreakdown();
            if (savedPromo) {
                const msg = document.getElementById('promoMessage');
                msg.textContent = 'Promo applied — $0.01 card verification charge';
                msg.style.color = 'var(--success-green)';
            }
        });
