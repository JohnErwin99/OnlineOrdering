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
                            const numberChips = trunk.numbers.map(n =>
                                n === trunk.primaryNumber
                                    ? `<span class="number-chip pilot">${n} (Main)</span>`
                                    : `<span class="number-chip">${n}</span>`
                            ).join('');
                            return `<div style="margin-bottom:12px;"><strong style="font-size:13px;color:#004a9f;">${trunk.name}</strong><div style="margin-top:6px;">${numberChips}</div></div>`;
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

        function sanitizeEnterpriseId(name) {
            // Remove special chars, replace spaces with underscores, lowercase
            return name.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_').toLowerCase();
        }

        // ============================================
        // MIND / Iristel-X API Configuration
        // ============================================
        const MIND_API_URL = 'https://api.iristelx.com';
        const MIND_API_KEY = 'HRT88y2qywc6fwX779zG2D8fJtJQJbvz';
        const SIP_TRUNK_PLAN_CODE = 'EXLNP_EXTRUNK';

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
        const UBOSS_POLL_INTERVAL = 3000; // ms between status checks
        const UBOSS_MAX_POLLS = 60;       // max polls (~3 min timeout)

        // ============================================
        // Payment Status (already collected before business setup)
        // ============================================
        // Pricing constants
        const CHANNEL_PRICE = 25.00;  // $25/mo per channel

        function loadPaymentStatus() {
            const ref = getCookie('iristel_payment_reference');
            const amount = parseFloat(getCookie('iristel_payment_amount') || '0');
            const token = getCookie('iristel_payment_token');
            const cardLast4 = getCookie('iristel_payment_card_last4') || '';
            const statusEl = document.getElementById('paymentStatus');

            if (amount > 0 && ref) {
                // Payment has been charged
                document.getElementById('payRefDisplay').textContent = ref;
                document.getElementById('payAmountDisplay').textContent = `$${amount.toFixed(2)} charged`;
                statusEl.style.background = '#f0fdf4';
                statusEl.style.borderColor = '#86efac';
            } else if (token) {
                // Card saved but not yet charged
                document.getElementById('payRefDisplay').textContent = cardLast4 ? `Card ending in ${cardLast4}` : 'Card on file';
                document.getElementById('payAmountDisplay').textContent = 'Not yet charged';
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

            // Calculate remaining balance vs what was already paid
            const paidAmount = parseFloat(getCookie('iristel_payment_amount') || '0');
            const tax = +(totalMonthly * 0.13).toFixed(2);
            const totalWithTax = +(totalMonthly + tax).toFixed(2);
            const remaining = +(totalWithTax - paidAmount).toFixed(2);

            const tfoot = document.getElementById('pricingTable').querySelector('tfoot');
            const totalRow = tfoot.querySelector('.pricing-total-row');

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

            if (remaining > 0) {
                footerRows += `
                    <tr>
                        <td colspan="3" style="text-align:right;font-weight:700;">Remaining Balance</td>
                        <td style="text-align:right;font-weight:700;font-size:16px;color:var(--magenta-glow);">$${remaining.toFixed(2)}</td>
                    </tr>
                    <tr>
                        <td colspan="4" style="text-align:right;padding-top:12px;">
                            <button class="btn-edit" id="chargeBalanceBtn" onclick="chargeRemainingBalance(${remaining})" style="background:var(--tufts-blue);color:#fff;padding:8px 20px;">
                                Charge $${remaining.toFixed(2)} to card on file
                            </button>
                        </td>
                    </tr>`;
            } else {
                footerRows += `
                    <tr>
                        <td colspan="3" style="text-align:right;font-weight:600;color:var(--success-green);">Fully Paid</td>
                        <td style="text-align:right;font-weight:600;color:var(--success-green);">$0.00</td>
                    </tr>`;
            }

            totalRow.insertAdjacentHTML('afterend', footerRows);

            // Store remaining for submitOrder check
            window._remainingBalance = remaining;
        }

        // Charge remaining balance using saved card token
        async function chargeRemainingBalance(amount) {
            const btn = document.getElementById('chargeBalanceBtn');
            const token = getCookie('iristel_payment_token');
            const accountCode = getCookie('iristel_account_id') || '7142292';

            if (!token) {
                alert('No saved card found. Please go back to the payment step.');
                if (window.IrisBridge) window.IrisBridge.error('No saved card found. Please go back to the payment step.');
                return;
            }

            btn.disabled = true;
            btn.textContent = 'Processing...';

            try {
                const reference = 'IRS-BAL-' + Date.now().toString(36).toUpperCase();
                const requestBody = {
                    amount: amount.toFixed(2),
                    creditCard: {
                        token: token
                    },
                    reference: reference
                };

                console.log('[CHARGE BALANCE] POST', `${MIND_API_URL.replace('iristelx.com', 'iristelx.com')}/bot/${accountCode}/payment`);
                console.log('Request:', JSON.stringify(requestBody, null, 2));

                const response = await fetch(`https://api.iristelx.com/bot/${accountCode}/payment`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-api-key': 'b1582d78d369685683e090ad37489937'
                    },
                    body: JSON.stringify(requestBody)
                });

                const data = await response.json();
                if (!response.ok) {
                    throw new Error(data.message || `Payment failed (HTTP ${response.status})`);
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
                    // Reload pricing to reflect updated payment
                    document.getElementById('pricingBody').innerHTML = '';
                    const tfoot = document.getElementById('pricingTable').querySelector('tfoot');
                    // Remove all rows after the total row
                    const totalRow = tfoot.querySelector('.pricing-total-row');
                    while (totalRow.nextElementSibling) {
                        totalRow.nextElementSibling.remove();
                    }
                    loadPricingBreakdown();
                    loadPaymentStatus();
                    window._remainingBalance = 0;
                }, 1500);

            } catch (err) {
                console.error('Balance charge failed:', err);
                btn.disabled = false;
                btn.textContent = `Charge $${amount.toFixed(2)} to card on file`;
                btn.style.background = '';
                alert('Payment failed: ' + err.message);
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
                throw new Error(data.message || `MIND account creation failed (HTTP ${response.status})`);
            }

            return data.accountId || data.id || data.accountcode;
        }

        // ============================================
        // STEP 2: Assign SIP Trunk service in MIND
        // ============================================
        async function assignSipTrunkService(accountId, contactData) {
            const requestBody = {
                accountId: accountId,
                planCode: SIP_TRUNK_PLAN_CODE,
                contact: {
                    fname: contactData.fname,
                    lname: contactData.lname,
                    address1: contactData.address1,
                    city: contactData.city,
                    province: contactData.province,
                    country: contactData.country,
                    postalCode: formatPostalCode(contactData.postalCode),
                    emailAddress: contactData.emailAddress,
                    // MIND stores phone as an object — a bare string makes the account
                    // update leg of this call fail with "Update Account failed."
                    phone: {
                        mobile: contactData.phone
                    }
                }
            };

            console.log('[STEP 2] MIND Assign Service — POST', `${MIND_API_URL}/accounts/${accountId}/services`);
            console.log('Request Body:', JSON.stringify(requestBody, null, 2));

            const response = await fetch(`${MIND_API_URL}/accounts/${accountId}/services`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'iristelx-api-key': MIND_API_KEY
                },
                body: JSON.stringify(requestBody)
            });

            const data = await response.json();
            console.log('MIND Assign Service Response:', data);

            if (!response.ok) {
                throw new Error(data.message || `Service assignment failed (HTTP ${response.status})`);
            }

            return data;
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

        async function startUbossProvisioning(contactData, primaryNumber, accountId, channelCount) {
            // Field order/names must match the UbossRobot trunk-provisioning contract
            const requestBody = {
                phoneNumber: formatUbossPhone(primaryNumber),
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
                const errorMsg = data && data.message ? data.message
                               : `UbossRobot provisioning failed to start (HTTP ${response.status})`;
                throw new Error(errorMsg);
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

        // ============================================
        // STEP 3b: Poll UbossRobot provisioning status
        // ============================================
        // Status is returned as a STRING by the UbossRobot API, e.g.
        // "Queued" / "Running" / "Completed" / "PartiallyCompleted" / "Failed"
        const UBOSS_STATUS = {
            QUEUED: 'Queued',
            RUNNING: 'Running',
            COMPLETED: 'Completed',
            PARTIAL: 'PartiallyCompleted',
            FAILED: 'Failed'
        };

        // Compare case-insensitively so casing changes on the API side don't break the flow
        function statusIs(data, expected) {
            return String(data && data.status || '').toLowerCase() === expected.toLowerCase();
        }

        async function checkProvisioningStatus(jobId) {
            console.log('[Status Check] UbossRobot job:', jobId);

            const response = await fetch(`${UBOSS_API_URL}/trunk-provisioning/${encodeURIComponent(jobId)}/status`, {
                headers: { 'x-api-key': UBOSS_API_KEY }
            });
            const data = await response.json().catch(() => null);
            console.log('Status response:', data);

            if (!response.ok) {
                throw new Error(data?.message || `Failed to check provisioning status (HTTP ${response.status})`);
            }

            return data;
        }

        // Note: the welcome letter (POST /uboss-robot/email/{id}) is fired from
        // provisioningStatus.html once the job reports Completed. It carries the SIP
        // credentials, so it is the customer's only route to the trunk password.

        async function pollProvisioningStatus(jobId) {
            console.log('[STEP 3b] Polling UbossRobot job status:', jobId);

            for (let i = 0; i < UBOSS_MAX_POLLS; i++) {
                const data = await checkProvisioningStatus(jobId);

                // PartiallyCompleted means the trunk is up but a later step failed —
                // hand off to the status page, which surfaces the detail and a retry.
                if (statusIs(data, UBOSS_STATUS.COMPLETED) || statusIs(data, UBOSS_STATUS.PARTIAL)) {
                    return data;
                }

                if (statusIs(data, UBOSS_STATUS.FAILED)) {
                    throw new Error(data.errorMessage || 'Trunk provisioning failed');
                }

                // Still queued or running — wait and poll again
                updateStatusMessage(`Provisioning trunk... (${i + 1})`);
                await new Promise(r => setTimeout(r, UBOSS_POLL_INTERVAL));
            }

            // Timed out waiting — don't error, redirect to status page instead
            return null;
        }

        // ============================================
        // SUBMIT ORDER — Full 3-step flow
        // (Payment already collected before business setup)
        // 1. Create business account in MIND
        // 2. Assign EXLNP_EXTRUNK service to account
        // 3. Provision trunk via UbossRobot (async + poll)
        // ============================================
        async function submitOrder() {
            if (!document.getElementById('agreeTerms').checked) {
                alert('Please agree to the Terms of Service before submitting.');
                if (window.IrisBridge) window.IrisBridge.error('Please agree to the Terms of Service before submitting.', 'agreeTerms');
                return;
            }

            // Verify card was saved
            if (!getCookie('iristel_payment_token')) {
                alert('No payment card on file. Please go back and save a card first.');
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

                // ---- STEP 2: Assign SIP Trunk Service ----
                updateStatusMessage('Assigning SIP Trunk service...');
                let serviceResult;
                try {
                    serviceResult = await assignSipTrunkService(accountId, contactData);
                    console.log('Service assigned:', serviceResult);
                } catch (err) {
                    setOrderStepResult('service', 'error', err.message);
                    throw err;
                }

                if (serviceResult && (serviceResult.serviceId || serviceResult.id)) {
                    setCookie('sip_serviceId', serviceResult.serviceId || serviceResult.id);
                }
                setOrderStepResult('service', 'done',
                    serviceResult && (serviceResult.serviceId || serviceResult.id)
                        ? SIP_TRUNK_PLAN_CODE + ' activated (service ' + (serviceResult.serviceId || serviceResult.id) + ')'
                        : SIP_TRUNK_PLAN_CODE + ' activated on your account');

                // Check remaining balance
                if (window._remainingBalance > 0) {
                    alert('Please pay the remaining balance of $' + window._remainingBalance.toFixed(2) + ' before submitting.');
                    if (window.IrisBridge) window.IrisBridge.error('Remaining balance of $' + window._remainingBalance.toFixed(2) + ' must be paid before submitting.');
                    resetSubmitButton();
                    return;
                }

                // ---- STEP 3: Provision trunk via UbossRobot ----
                // Channel count from the first trunk's channel setting
                let channelCount = 1;
                const trunksData = getCookie('sip_trunks');
                if (trunksData) {
                    try {
                        const trunksList = JSON.parse(trunksData);
                        if (Array.isArray(trunksList) && trunksList.length > 0) {
                            channelCount = trunksList[0].channels || 1;
                        }
                    } catch (e) {}
                }

                updateStatusMessage('Starting trunk provisioning...');
                const ubossResult = await startUbossProvisioning(contactData, primaryNumber, accountId, channelCount);
                const jobId = ubossResult.id;
                console.log('UbossRobot job started:', jobId);

                // Save job ID for status tracking
                setCookie('sip_provisionJobId', jobId);

                // Brief poll — try a few times before redirecting to status page
                updateStatusMessage('Provisioning trunk...');
                const finalResult = await pollProvisioningStatus(jobId);

                // The status page owns the welcome email, the SIP password lookup and
                // the PartiallyCompleted case — it only needs the result to render from.
                if (finalResult && statusIs(finalResult, UBOSS_STATUS.COMPLETED)) {
                    setCookie('sip_provisionResult', JSON.stringify(finalResult));
                }

                if (window.IrisBridge) window.IrisBridge.orderComplete(jobId);

                // Redirect to provisioning status page
                window.location.href = 'provisioningStatus.html';

            } catch (err) {
                console.error('Order submission failed:', err);
                alert('Order submission failed:\n\n' + err.message);
                if (window.IrisBridge) window.IrisBridge.error('Order submission failed: ' + err.message);
                resetSubmitButton();
            }
        }

        document.addEventListener('DOMContentLoaded', function() {
            loadUserInfoBar();
            loadReviewData();
            loadPaymentStatus();
            loadPricingBreakdown();
        });
