        document.getElementById('copyBillingToTech').addEventListener('change', function() {
            if (this.checked) {
                document.getElementById('techFirstName').value = document.getElementById('billingFirstName').value;
                document.getElementById('techLastName').value = document.getElementById('billingLastName').value;
                document.getElementById('techEmail').value = document.getElementById('billingEmail').value;
                document.getElementById('techPhone').value = document.getElementById('billingPhone').value;
            }
        });

        ['billingFirstName', 'billingLastName', 'billingEmail', 'billingPhone'].forEach(id => {
            document.getElementById(id).addEventListener('input', function() {
                if (document.getElementById('copyBillingToTech').checked) {
                    document.getElementById(id.replace('billing', 'tech')).value = this.value;
                }
            });
        });

        function loadSavedData() {
            const fields = ['businessName', 'siteName', 'address1', 'address2', 'city', 'province', 'postalCode', 'country',
                           'billingFirstName', 'billingLastName', 'billingEmail', 'billingPhone',
                           'techFirstName', 'techLastName', 'techEmail', 'techPhone'];
            fields.forEach(field => {
                const saved = getCookie('sip_' + field);
                if (saved) document.getElementById(field).value = saved;
            });

            // Prefill from signup cookies if SIP fields are empty
            const signupMapping = {
                address1:         'iristel_user_address1',
                city:             'iristel_user_city',
                province:         'iristel_user_province',
                postalCode:       'iristel_user_postalCode',
                country:          'iristel_user_country',
                billingFirstName: 'iristel_user_fname',
                billingLastName:  'iristel_user_lname',
                billingEmail:     'iristel_user_email',
                billingPhone:     'iristel_user_phone',
                techFirstName:    'iristel_user_fname',
                techLastName:     'iristel_user_lname',
                techEmail:        'iristel_user_email',
                techPhone:        'iristel_user_phone'
            };

            for (const [fieldId, cookieName] of Object.entries(signupMapping)) {
                const el = document.getElementById(fieldId);
                if (el && !el.value) {
                    const val = getCookie(cookieName);
                    if (val) el.value = val;
                }
            }
        }

        // 5 MB — matches the Dynamics 365 attachment limit (org
        // maxuploadfilesize); a bigger file would upload here but fail to
        // attach in CRM, so it's rejected up front with a clear message.
        const MAX_DOC_BYTES = 5 * 1024 * 1024;
        const DOC_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

        // Instant feedback the moment a file is picked — size and type are
        // told to the customer right away, not at submit time.
        function validateDocInput() {
            const input = document.getElementById('bizRegDoc');
            const errEl = document.getElementById('bizRegDocError');
            const file = input.files && input.files[0];
            errEl.style.display = 'none';
            if (!file) return true;
            if (!DOC_TYPES.includes(file.type)) {
                errEl.textContent = 'This file type is not accepted — please upload a PDF, JPG or PNG.';
                errEl.style.display = 'block';
                input.value = '';
                return false;
            }
            if (file.size > MAX_DOC_BYTES) {
                errEl.textContent = 'This file is ' + (file.size / 1024 / 1024).toFixed(1) +
                    ' MB — the maximum is 5 MB. Try exporting the document at a smaller size.';
                errEl.style.display = 'block';
                input.value = '';
                return false;
            }
            return true;
        }

        // The business registration document is required for fraud screening.
        // It can't live in a cookie, so it's uploaded to the server (stored on
        // disk, pointer in the order store) and later attached to the Dynamics
        // 365 contact. Already-uploaded docs (back navigation) are not re-sent.
        async function uploadBusinessDoc(email) {
            const input = document.getElementById('bizRegDoc');
            const file = input.files && input.files[0];
            if (!file) {
                if (getCookie('sip_bizDocUploaded') === '1') return true; // uploaded on a previous visit
                showAlert('Please upload your business registration document.', 'error', 'Document required');
                return false;
            }
            if (!validateDocInput()) return false;
            const base64 = await new Promise((resolve, reject) => {
                const r = new FileReader();
                r.onload = () => resolve(String(r.result).split(',')[1] || '');
                r.onerror = () => reject(new Error('Could not read the file'));
                r.readAsDataURL(file);
            });
            const resp = await fetch('/api/business-doc', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: email,
                    filename: file.name,
                    mimeType: file.type || 'application/pdf',
                    data: base64
                })
            });
            const data = await resp.json().catch(() => null);
            if (!resp.ok) {
                showAlert('Document upload failed: ' + ((data && data.error) || ('HTTP ' + resp.status)), 'error', 'Upload failed');
                return false;
            }
            setCookie('sip_bizDocUploaded', '1');
            document.getElementById('bizRegDocStatus').style.display = 'block';
            return true;
        }

        async function saveAndContinue() {
            const form = document.getElementById('businessSetupForm');
            // A doc uploaded on a previous visit satisfies the required file input
            if (getCookie('sip_bizDocUploaded') === '1') {
                document.getElementById('bizRegDoc').removeAttribute('required');
            }
            if (!form.checkValidity()) { form.reportValidity(); return; }

            const fields = ['businessName', 'siteName', 'address1', 'address2', 'city', 'province', 'postalCode', 'country',
                           'billingFirstName', 'billingLastName', 'billingEmail', 'billingPhone',
                           'techFirstName', 'techLastName', 'techEmail', 'techPhone'];
            fields.forEach(field => setCookie('sip_' + field, document.getElementById(field).value));
            setCookie('sip_bizRegNumber', document.getElementById('bizRegNumber').value.trim());

            const email = document.getElementById('billingEmail').value.trim()
                || getCookie('iristel_user_email') || '';
            const uploaded = await uploadBusinessDoc(email);
            if (!uploaded) return;

            window.location.href = 'numberSource.html';
        }

        function prefillTestDefaults() {
            // Full test defaults so the flow can be exercised on a fresh
            // browser/domain without going through signup first. Saved cookies
            // and signup data always win — these only fill still-empty fields.
            const defaults = {
                businessName: 'Erwin Test Corp',
                siteName: 'Main Office HQ',
                address1: '625 President-Kennedy Ave',
                city: 'Montreal',
                province: 'QC',
                postalCode: 'H3A 1K2',
                country: 'CA',
                billingFirstName: 'John',
                billingLastName: 'Erwin',
                billingEmail: 'john.erwin.h@gmail.com',
                billingPhone: '4388663425',
                techFirstName: 'John',
                techLastName: 'Erwin',
                techEmail: 'john.erwin.h@gmail.com',
                techPhone: '4388663425'
            };
            for (const [id, val] of Object.entries(defaults)) {
                const el = document.getElementById(id);
                if (el && !el.value) el.value = val;
            }
        }

        document.addEventListener('DOMContentLoaded', function() {
            loadSavedData();
            loadUserInfoBar();
            prefillTestDefaults();
            document.getElementById('bizRegDoc').addEventListener('change', validateDocInput);
            const savedReg = getCookie('sip_bizRegNumber');
            if (savedReg) document.getElementById('bizRegNumber').value = savedReg;
            if (getCookie('sip_bizDocUploaded') === '1') {
                document.getElementById('bizRegDoc').removeAttribute('required');
                document.getElementById('bizRegDocStatus').style.display = 'block';
            }
        });
