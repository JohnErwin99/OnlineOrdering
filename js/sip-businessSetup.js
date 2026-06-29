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

        function saveAndContinue() {
            const form = document.getElementById('businessSetupForm');
            if (!form.checkValidity()) { form.reportValidity(); return; }

            const fields = ['businessName', 'siteName', 'address1', 'address2', 'city', 'province', 'postalCode', 'country',
                           'billingFirstName', 'billingLastName', 'billingEmail', 'billingPhone',
                           'techFirstName', 'techLastName', 'techEmail', 'techPhone'];
            fields.forEach(field => setCookie('sip_' + field, document.getElementById(field).value));

            window.location.href = 'numberSource.html';
        }

        function prefillTestDefaults() {
            const defaults = {
                businessName: 'Erwin Test Corp',
                siteName: 'Main Office HQ'
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
        });
