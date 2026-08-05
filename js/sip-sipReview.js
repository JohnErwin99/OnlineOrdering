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

        // Ported orders are flagged to the provisioning team by suffixing the business name
        // (isPortingOrder() lives in common.js so every page agrees on what a port is)
        const PORTING_SUFFIX = ' - PI';

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

                setText('revLoaFile', getCookie('sip_loaFileName'));
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

        // MIND stores Canadian postal codes as "A1A 1A1" — send them back in that shape
        function formatPostalCode(postalCode) {
            const raw = (postalCode || '').toUpperCase().replace(/\s/g, '');
            if (/^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(raw)) {
                return raw.slice(0, 3) + ' ' + raw.slice(3);
            }
            return postalCode || '';
        }

        // MIND wraps the real reason in errors[] and puts a generic sentence in
        // message — "Update Account failed." for a plan code it will not accept. The
        // detail is what tells you which field to fix, so it goes in the thrown error.
        function describeApiError(data, fallback) {
            if (!data) return fallback;
            const details = Array.isArray(data.errors)
                ? data.errors.map(e => e && e.message).filter(Boolean)
                : [];
            if (!details.length) return data.message || fallback;
            if (!data.message) return details.join(' ');
            return data.message + ' — ' + details.join(' ');
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
        // The payment route authenticates on x-api-key, not the iristelx-api-key the
        // rest of MIND takes — same pair sipTrunkPayment.js uses to tokenize the card.
        const PAYMENT_API_KEY = 'b1582d78d369685683e090ad37489937';

        // ============================================
        // TRUNK (Broadworks) API Configuration — DEPRECATED
        // Replaced by UbossRobot API below
        // ============================================
        // const TRUNK_API_URL = 'http://100.67.14.26:8099/api/trunk/provision';
        // const TRUNK_API_KEY = '3c901f55e7864d2aae31b08c9746f9132d8847f1acb94c65b0897e3624f1edc6';

        // ============================================
        // UbossRobot API Configuration
        // ============================================
        const UBOSS_API_URL = 'https://api.iristelx.com/uboss-robot';
        const UBOSS_API_KEY = 'b1582d78d369685683e090ad37489937';
        const UBOSS_RESELLER_NAME = 'Iristel';

        // ============================================
        // Payment Status (already collected before business setup)
        // ============================================
        // Pricing constants
        const CHANNEL_PRICE = 25.00;  // $25/mo per channel

        // ============================================
        // PROMO CODE
        // Entered on this page because this is where the card is charged. It waives
        // the whole balance, so applying or clearing it re-prices straight away.
        // ============================================
        function getAppliedPromo() {
            return getCookie('iristel_promo_code') === 'TEST' ? 'TEST' : null;
        }

        function applyPromo() {
            const code = (document.getElementById('promoCode').value || '').trim().toUpperCase();
            const msg = document.getElementById('promoMessage');

            if (code === 'TEST') {
                setCookie('iristel_promo_code', 'TEST');
                msg.textContent = 'Promo applied — $0.00 charge';
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
                    ? `No charge — promo ${promo} applied`
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
            const promoDiscount = promo ? totalWithTax : 0;
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
        const GATEWAY_ERRORS = [502, 503, 504];
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

                console.log('[CHARGE BALANCE] POST', `${MIND_API_URL}/bot/${accountCode}/payment`);
                console.log('Request:', JSON.stringify(requestBody, null, 2));

                let response;
                try {
                    response = await fetch(`${MIND_API_URL}/bot/${accountCode}/payment`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'x-api-key': PAYMENT_API_KEY
                        },
                        body: JSON.stringify(requestBody)
                    });
                } catch (networkErr) {
                    // fetch() only rejects before a response is readable: the connection
                    // failed, or the browser refused what came back. The API's gateway
                    // serves its own error pages without CORS headers, so an upstream
                    // failure surfaces here as "Failed to fetch" rather than as a status.
                    throw unknownOutcome(networkErr.message);
                }

                // Read as text first. A gateway error page is HTML, and parsing it as
                // JSON reports a syntax error instead of the failure that happened.
                const raw = await response.text();
                let data = null;
                try {
                    data = JSON.parse(raw);
                } catch (_) {
                    // Left null — handled below as an unreadable response.
                }

                // The payment service answers in JSON, successes and errors alike.
                // Anything else came from in front of it and says nothing about
                // whether the charge ran.
                if (!data || GATEWAY_ERRORS.includes(response.status)) {
                    console.error('Unreadable payment response:', response.status, raw.slice(0, 200));
                    throw unknownOutcome(`HTTP ${response.status}`);
                }

                if (!response.ok) {
                    throw new Error(describeApiError(data, `Payment failed (HTTP ${response.status})`));
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

        // Override common.js version — SIP Review checks sip_ cookies first
        function getContactDataFromCookies() {
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
        async function createMindAccount(contactData) {
            const requestBody = {
                contact: {
                    fname: contactData.fname,
                    lname: contactData.lname,
                    address1: contactData.address1,
                    city: contactData.city,
                    province: contactData.province,
                    country: contactData.country,
                    postalCode: contactData.postalCode,
                    emailAddress: contactData.emailAddress,
                    phone: {
                        mobile: contactData.phone
                    }
                },
                language: getCookie('iristel_user_language') || 'en',
                businessUnit: '1'
            };

            console.log('[STEP 1] MIND Create Account — POST', MIND_API_URL + '/accounts');
            console.log('Request Body:', JSON.stringify(requestBody, null, 2));

            const response = await fetch(`${MIND_API_URL}/accounts`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'iristelx-api-key': MIND_API_KEY
                },
                body: JSON.stringify(requestBody)
            });

            const data = await response.json();
            console.log('MIND Create Account Response:', data);

            if (!response.ok) {
                throw new Error(describeApiError(data, `MIND account creation failed (HTTP ${response.status})`));
            }

            return data.accountId || data.id || data.accountcode;
        }

        // ============================================
        // STEP 3: Start UbossRobot trunk provisioning
        // ============================================
        // Porting orders go to UbossRobot as "<Business Name> - PI"
        function getProvisioningBusinessName() {
            const name = (getCookie('sip_businessName') || '').trim();
            if (!isPortingOrder() || !name || name.endsWith(PORTING_SUFFIX)) {
                return name;
            }
            return name + PORTING_SUFFIX;
        }

        async function startUbossProvisioning(contactData, phoneNumbers, accountId, channelCount) {
            // Field order/names must match the UbossRobot trunk-provisioning contract.
            // phoneNumbers: the first entry is the trunk number; any further entries
            // are provisioned as channel numbers on the same trunk (bulk).
            const requestBody = {
                phoneNumbers: phoneNumbers.map(formatUbossPhone),
                resellerName: UBOSS_RESELLER_NAME,
                address: contactData.address1,
                city: contactData.city,
                postcode: contactData.postalCode,
                notificationEmail: getCookie('sip_techEmail') || contactData.emailAddress,
                invoiceEmail: contactData.emailAddress,
                accountRef: accountId,
                businessName: getProvisioningBusinessName(),
                channelCount: channelCount
            };

            console.log('[STEP 3] UbossRobot Start Provisioning — POST', `${UBOSS_API_URL}/trunk-provisioning`);
            console.log('Request Body:', JSON.stringify(requestBody, null, 2));

            const response = await fetch(`${UBOSS_API_URL}/trunk-provisioning`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': UBOSS_API_KEY
                },
                body: JSON.stringify(requestBody)
            });

            const data = await response.json().catch(() => null);
            console.log('UbossRobot Start Response:', data);

            if (!response.ok) {
                throw new Error(describeApiError(data,
                    `UbossRobot provisioning failed to start (HTTP ${response.status})`));
            }

            return data;
        }

        // UbossRobot expects the number as +1-XXXXXXXXXX (country code, dash, subscriber digits)
        function formatUbossPhone(number) {
            const e164 = formatToE164(number || '');
            const digits = e164.replace(/\D/g, '');
            if (digits.length === 11) {
                return `+${digits.charAt(0)}-${digits.slice(1)}`;
            }
            return e164;
        }

        // Note: this page does not poll the provisioning job. It starts the job and
        // hands the id to provisioningStatus.html, which owns every status the API
        // can report — including Failed and PartiallyCompleted, which it shows with
        // the error detail and a retry — plus the welcome letter
        // (POST /uboss-robot/email/{id}) that carries the SIP credentials.

        // ============================================
        // SUBMIT ORDER — Full 3-step flow
        // (Payment already collected before business setup)
        // 1. Create business account in MIND
        // 2. Record the SIP Trunk service (already assigned at plan selection)
        // 3. Start trunk provisioning via UbossRobot, then hand the job id to the
        //    status page — it reports the real progress, so waiting here would only
        //    hold the customer on a spinner
        // ============================================
        async function submitOrder() {
            if (!document.getElementById('agreeTerms').checked) {
                showAlert('Please agree to the Terms of Service before submitting.', 'info', 'Almost there');
                if (window.IrisBridge) window.IrisBridge.error('Please agree to the Terms of Service before submitting.', 'agreeTerms');
                return;
            }

            // Verify card was saved — unless the TEST promo is applied, which
            // zeroes the charge and bypasses payment entirely (no card needed).
            const promoApplied = getAppliedPromo();
            if (!promoApplied && !getCookie('iristel_payment_token')) {
                showAlert('No payment card on file. Please go back and save a card first.', 'error', 'No card on file');
                if (window.IrisBridge) window.IrisBridge.error('No payment card on file. Please go back and save a card first.');
                return;
            }

            const submitBtn = document.getElementById('submitBtn');
            submitBtn.disabled = true;

            const contactData = getContactDataFromCookies();

            // Get primary number
            const savedPrimary = getCookie('sip_primaryNumber') || getCookie('sip_billingPhone') || '';
            const primaryNumber = savedPrimary ? formatToE164(savedPrimary) : '';

            // The status page renders steps 1 and 2 from these — never assume success
            clearOrderStepResults();

            try {
                // ---- STEP 1: Create MIND Account ----
                let accountId = getCookie('iristel_account_id');

                try {
                    if (!accountId) {
                        updateStatusMessage('Creating account...');
                        accountId = await createMindAccount(contactData);
                        setCookie('iristel_account_id', accountId);
                        console.log('MIND Account created:', accountId);
                        setOrderStepResult('account', 'done', 'Business account ' + accountId + ' created');
                    } else {
                        console.log('Using existing MIND account:', accountId);
                        setOrderStepResult('account', 'done', 'Using existing account ' + accountId);
                    }
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

                // ---- STEP 3: Order the numbers (espresso DID order) ----
                // espresso is ONLY the number source: rate center + NPA +
                // quantity go in, concrete numbers come out once Iristel
                // completes the order. Submit places one order covering every
                // trunk's requests, waits here for it to complete, fills the
                // trunks with the assigned numbers, and then provisioning
                // starts via UbossRobot exactly as before.
                let trunksList = [];
                const trunksData = getCookie('sip_trunks');
                if (trunksData) {
                    try {
                        const parsed = JSON.parse(trunksData);
                        if (Array.isArray(parsed)) trunksList = parsed;
                    } catch (e) {}
                }
                if (trunksList.length === 0) {
                    trunksList = [{ name: 'Trunk 1', channels: 1, requests: [], numbers: primaryNumber ? [primaryNumber] : [], primaryNumber: primaryNumber }];
                }

                const needsNumbers = trunksList.some(t => (!t.numbers || !t.numbers.length) && (t.requests || []).length);
                if (needsNumbers) {
                    // Re-use an order placed by an earlier submit attempt (e.g. the
                    // wait below timed out) instead of ordering the numbers twice.
                    let didOrderNumber = getCookie('sip_didOrderNumber');
                    if (!didOrderNumber) {
                        updateStatusMessage('Placing your number order...');
                        const allRequests = trunksList.flatMap(t => t.requests || []);
                        const orderResponse = await fetch('/api/did/order', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ requests: allRequests })
                        });
                        const orderData = await orderResponse.json().catch(() => null);
                        if (!orderResponse.ok || !orderData || !orderData.orderNumber) {
                            throw new Error('Number order failed: ' + ((orderData && orderData.error) || ('HTTP ' + orderResponse.status)));
                        }
                        didOrderNumber = orderData.orderNumber;
                        setCookie('sip_didOrderNumber', didOrderNumber);
                        console.log('DID order placed:', didOrderNumber);
                    } else {
                        console.log('Resuming DID order:', didOrderNumber);
                    }

                    // Wait for the order to complete (poll every 10s, ~3 min per
                    // attempt). The order number is saved, so if this times out the
                    // customer just clicks Submit again to keep waiting.
                    let orderStatus = '';
                    for (let attempt = 0; attempt < 18; attempt++) {
                        const sr = await fetch(`/api/did/order/${encodeURIComponent(didOrderNumber)}/status`);
                        const sd = await sr.json().catch(() => null);
                        if (!sr.ok) throw new Error('Number order status failed: ' + ((sd && sd.error) || ('HTTP ' + sr.status)));
                        orderStatus = String(sd.status || '');
                        console.log('DID order', didOrderNumber, 'status:', orderStatus);
                        if (/^completed$/i.test(orderStatus)) break;
                        if (/rejected|canceled/i.test(orderStatus)) {
                            deleteCookie('sip_didOrderNumber');
                            throw new Error('Number order ' + didOrderNumber + ' was ' + orderStatus.toLowerCase() + '. Please adjust your number requests and try again.');
                        }
                        updateStatusMessage('Waiting for your numbers (' + (orderStatus || 'Processing') + ')...');
                        await new Promise(r => setTimeout(r, 10000));
                    }
                    if (!/^completed$/i.test(orderStatus)) {
                        throw new Error('Your number order (' + didOrderNumber + ') is still being processed by Iristel. Click Submit Order again in a few minutes to continue — the order will not be placed twice.');
                    }

                    // Completed: fetch the assigned numbers and distribute them
                    // across the trunks in request order
                    updateStatusMessage('Retrieving your new numbers...');
                    const dr = await fetch(`/api/did/order/${encodeURIComponent(didOrderNumber)}/details`);
                    const dd = await dr.json().catch(() => null);
                    if (!dr.ok || !dd) throw new Error('Could not retrieve the ordered numbers: ' + ((dd && dd.error) || ('HTTP ' + dr.status)));
                    const numbers = dd.numbers || [];
                    if (!numbers.length) throw new Error('Number order completed but returned no numbers. Please contact support with order ' + didOrderNumber + '.');
                    console.log('DID order delivered', numbers.length, 'numbers');

                    let cursor = 0;
                    trunksList.forEach(trunk => {
                        if (trunk.numbers && trunk.numbers.length) return;
                        const wanted = (trunk.requests || []).reduce((s, r) => s + (parseInt(r.quantity, 10) || 0), 0) || 1;
                        trunk.numbers = numbers.slice(cursor, cursor + wanted);
                        trunk.primaryNumber = trunk.numbers[0] || '';
                        cursor += wanted;
                    });
                    setCookie('sip_trunks', JSON.stringify(trunksList));
                    if (trunksList[0] && trunksList[0].primaryNumber) {
                        setCookie('sip_primaryNumber', trunksList[0].primaryNumber);
                    }
                    deleteCookie('sip_didOrderNumber');
                }

                // ---- STEP 4: Provision each trunk via UbossRobot (unchanged) ----
                const provisionJobs = [];
                for (let i = 0; i < trunksList.length; i++) {
                    const trunk = trunksList[i];
                    const primary = trunk.primaryNumber || '';
                    const trunkNumbers = (trunk.numbers || []).filter(n => n && n !== primary);
                    if (primary) trunkNumbers.unshift(primary);
                    if (trunkNumbers.length === 0) continue;

                    updateStatusMessage('Starting provisioning for ' + (trunk.name || ('Trunk ' + (i + 1))) + ' (' + (i + 1) + '/' + trunksList.length + ')...');
                    try {
                        const ubossResult = await startUbossProvisioning(contactData, trunkNumbers, accountId, trunk.channels || 1);
                        console.log('UbossRobot job started for', trunk.name, ':', ubossResult.id);
                        provisionJobs.push({ trunkName: trunk.name || ('Trunk ' + (i + 1)), jobId: ubossResult.id });
                    } catch (err) {
                        // Report which trunks already went through so support can reconcile
                        const started = provisionJobs.map(j => j.trunkName + ' (job ' + j.jobId + ')').join(', ');
                        throw new Error('Provisioning failed for "' + (trunk.name || ('Trunk ' + (i + 1))) + '": ' + err.message
                            + (started ? '\n\nAlready started: ' + started : ''));
                    }
                }

                if (provisionJobs.length === 0) {
                    throw new Error('No trunk has number requests or numbers to provision.');
                }

                setCookie('sip_provisionJobId', provisionJobs[0].jobId);
                setCookie('sip_provisionJobs', JSON.stringify(provisionJobs));
                deleteCookie('sip_provisionResult');

                if (window.IrisBridge) window.IrisBridge.orderComplete(provisionJobs[0].jobId);

                updateStatusMessage('Provisioning started — opening status...');
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
                msg.textContent = 'Promo applied — $0.00 charge';
                msg.style.color = 'var(--success-green)';
            }
        });
