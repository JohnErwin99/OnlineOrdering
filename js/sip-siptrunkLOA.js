        function formatPhoneNumber(input) {
            let digits = input.value.replace(/\D/g, '').substring(0, 10);
            if (digits.length > 6) {
                input.value = '(' + digits.substring(0, 3) + ') ' + digits.substring(3, 6) + ' ' + digits.substring(6);
            } else if (digits.length > 3) {
                input.value = '(' + digits.substring(0, 3) + ') ' + digits.substring(3);
            } else if (digits.length > 0) {
                input.value = '(' + digits;
            } else {
                input.value = '';
            }
        }

        const NUMBER_ROW_HTML = `
                <input type="tel" placeholder="(514) 866 3425" class="port-number" maxlength="14" oninput="formatPhoneNumber(this)" onblur="checkPortability(this)" required>
                <span class="port-badge" style="display:none;"></span>
                <button type="button" class="btn-remove" onclick="removeNumber(this)">
                    <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/></svg>
                </button>
            `;

        function addNumber() {
            const container = document.getElementById('numbersContainer');
            const row = document.createElement('div');
            row.className = 'number-input-row';
            row.innerHTML = NUMBER_ROW_HTML;
            container.appendChild(row);
            updateRemoveButtons();
            return row;
        }

        function removeNumber(btn) {
            btn.parentElement.remove();
            updateRemoveButtons();
        }

        function updateRemoveButtons() {
            const rows = document.querySelectorAll('.number-input-row');
            rows.forEach((row) => {
                const btn = row.querySelector('.btn-remove');
                btn.style.visibility = rows.length > 1 ? 'visible' : 'hidden';
            });
        }

        // ============================================
        // NPA-NXX portability check (LNP API via server proxy)
        // ============================================
        // input.dataset.portable: '1' portable, '0' not yet open, '-1' not portable,
        // '' / undefined = not checked (e.g. server unreachable — don't block on that)
        const portabilityCache = {};

        function setBadge(row, cls, text) {
            const badge = row.querySelector('.port-badge');
            if (!text) { badge.style.display = 'none'; return; }
            badge.className = 'port-badge ' + cls;
            badge.textContent = text;
            badge.style.display = 'inline-block';
        }

        async function checkPortability(input) {
            const row = input.parentElement;
            const digits = input.value.replace(/\D/g, '');
            if (digits.length !== 10) {
                input.dataset.portable = '';
                setBadge(row, '', '');
                return;
            }
            const npanxx = digits.substring(0, 6);

            if (!(npanxx in portabilityCache)) {
                setBadge(row, 'checking', 'Checking...');
                try {
                    const resp = await fetch('/api/lnp/portability/' + npanxx);
                    const data = await resp.json();
                    if (!resp.ok) throw new Error(data.error || 'HTTP ' + resp.status);
                    portabilityCache[npanxx] = data.portable;
                } catch (err) {
                    console.error('Portability check failed:', err);
                    // Unknown — don't block the customer on a lookup failure
                    input.dataset.portable = '';
                    setBadge(row, '', '');
                    return;
                }
            }

            const portable = portabilityCache[npanxx];
            input.dataset.portable = String(portable);
            if (portable === 1) {
                setBadge(row, 'ok', 'Portable');
            } else if (portable === 0) {
                setBadge(row, 'warn', 'Not yet open for porting');
            } else {
                setBadge(row, 'bad', 'Not portable');
            }
        }

        function validatePortNumber(value) {
            const digits = value.replace(/\D/g, '');
            return digits.length === 10;
        }

        function toISODate(d) {
            return d.toISOString().split('T')[0];
        }

        function saveAndContinue() {
            const form = document.getElementById('loaForm');
            if (!form.checkValidity()) {
                form.reportValidity();
                return;
            }

            // Collect numbers to port
            const numbers = [];
            let hasInvalid = false;
            let hasNonPortable = false;
            document.querySelectorAll('.port-number').forEach(input => {
                const val = input.value.trim();
                if (val) {
                    if (!validatePortNumber(val)) {
                        hasInvalid = true;
                        input.style.borderColor = '#ef4444';
                    } else if (input.dataset.portable === '-1') {
                        hasNonPortable = true;
                        input.style.borderColor = '#ef4444';
                    } else {
                        input.style.borderColor = '';
                        numbers.push(val);
                    }
                }
            });

            if (hasInvalid) {
                showAlert('All phone numbers must be exactly 10 digits.', 'error', 'Invalid number');
                return;
            }
            if (hasNonPortable) {
                showAlert('One or more numbers are not portable to Iristel. Please remove them or contact support.', 'error', 'Number not portable');
                return;
            }
            if (numbers.length === 0) {
                showAlert('Please enter at least one phone number to port.', 'info', 'No numbers');
                return;
            }

            // Due date sanity: must be in the future
            const dueDate = document.getElementById('ponDueDate').value;
            const authDate = document.getElementById('ponAuthDate').value;
            if (dueDate <= toISODate(new Date())) {
                showAlert('The desired due date must be in the future (porting takes 5+ business days).', 'error', 'Invalid due date');
                return;
            }

            // Everything the LNP API needs to create the PON at order submit
            const ponData = {
                numbers: numbers.map(n => n.replace(/\D/g, '')),
                end_user_name: document.getElementById('ponEndUserName').value.trim(),
                existing_account_number: document.getElementById('ponAccountNumber').value.trim(),
                auth_date: authDate,
                desired_due_date: dueDate,
                house_number: document.getElementById('ponHouseNumber').value.trim(),
                street_name: document.getElementById('ponStreetName').value.trim(),
                street_type: document.getElementById('ponStreetType').value.trim(),
                city: document.getElementById('ponCity').value.trim(),
                province_state: document.getElementById('ponProvince').value,
                zip_code: document.getElementById('ponZipCode').value.trim(),
                losing_carrier_comments: document.getElementById('ponCarrierComments').value.trim(),
                service_type: 'Wireline'
            };
            setCookie('sip_ponData', JSON.stringify(ponData));

            // Kept for the pages that count/display port numbers (numberSelection, review)
            setCookie('sip_portNumbers', JSON.stringify(numbers));
            setCookie('sip_isPorting', 'true');

            window.location.href = 'numberSelection.html';
        }

        // Load saved data / prefill
        document.addEventListener('DOMContentLoaded', function() {
            loadUserInfoBar();

            // Date defaults: auth today, due in 7 days (min 5 business days)
            const today = new Date();
            const due = new Date(today.getTime() + 7 * 24 * 3600 * 1000);
            const authInput = document.getElementById('ponAuthDate');
            const dueInput = document.getElementById('ponDueDate');
            authInput.value = toISODate(today);
            dueInput.value = toISODate(due);
            dueInput.min = toISODate(due);

            // Prefill from the business-setup cookies; the customer corrects to
            // whatever the losing carrier actually has on file.
            let saved = null;
            try { saved = JSON.parse(getCookie('sip_ponData') || 'null'); } catch (e) {}

            const setVal = (id, v) => { if (v) document.getElementById(id).value = v; };
            if (saved) {
                setVal('ponEndUserName', saved.end_user_name);
                setVal('ponAccountNumber', saved.existing_account_number);
                setVal('ponAuthDate', saved.auth_date);
                setVal('ponDueDate', saved.desired_due_date);
                setVal('ponHouseNumber', saved.house_number);
                setVal('ponStreetName', saved.street_name);
                setVal('ponStreetType', saved.street_type);
                setVal('ponCity', saved.city);
                setVal('ponProvince', saved.province_state);
                setVal('ponZipCode', saved.zip_code);
                setVal('ponCarrierComments', saved.losing_carrier_comments);
            } else {
                setVal('ponEndUserName', getCookie('sip_businessName'));
                setVal('ponCity', getCookie('sip_city'));
                setVal('ponProvince', getCookie('sip_province'));
                setVal('ponZipCode', getCookie('sip_postalCode'));
                // Best-effort split of "123 Main" into number + street
                const addr1 = (getCookie('sip_address1') || '').trim();
                const m = addr1.match(/^(\d+[a-zA-Z]?)\s+(.*)$/);
                if (m) {
                    setVal('ponHouseNumber', m[1]);
                    setVal('ponStreetName', m[2]);
                } else {
                    setVal('ponStreetName', addr1);
                }
            }

            // Restore the number rows
            const savedNumbers = getCookie('sip_portNumbers');
            if (savedNumbers) {
                try {
                    const numbers = JSON.parse(savedNumbers);
                    const container = document.getElementById('numbersContainer');
                    container.innerHTML = '';
                    numbers.forEach((num) => {
                        const row = addNumber();
                        const input = row.querySelector('.port-number');
                        input.value = num;
                        formatPhoneNumber(input);
                        checkPortability(input);
                    });
                    updateRemoveButtons();
                } catch (e) {}
            }
        });
