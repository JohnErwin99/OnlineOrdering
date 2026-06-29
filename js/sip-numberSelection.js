        let selectedNumbers = [];
        let primaryNumber = '';
        let isPorting = false;

        // Rate centers data (simplified)
        const rateCenters = {
            'ON': ['Toronto', 'Ottawa', 'Mississauga', 'Hamilton', 'London', 'Markham', 'Vaughan', 'Kitchener', 'Windsor', 'Burlington'],
            'QC': ['Montreal', 'Quebec City', 'Laval', 'Gatineau', 'Longueuil', 'Sherbrooke', 'Trois-Rivi\u00e8res'],
            'BC': ['Vancouver', 'Victoria', 'Burnaby', 'Surrey', 'Richmond', 'Kelowna'],
            'AB': ['Calgary', 'Edmonton', 'Red Deer', 'Lethbridge', 'Medicine Hat'],
            'MB': ['Winnipeg', 'Brandon', 'Steinbach'],
            'SK': ['Saskatoon', 'Regina', 'Moose Jaw'],
            'NS': ['Halifax', 'Dartmouth', 'Sydney'],
            'NB': ['Moncton', 'Saint John', 'Fredericton']
        };

        const npaCodes = {
            'Toronto': ['416', '647', '437'],
            'Ottawa': ['613', '343'],
            'Montreal': ['514', '438'],
            'Vancouver': ['604', '778', '236'],
            'Calgary': ['403', '587'],
            'Edmonton': ['780', '587'],
            'default': ['825', '306', '204', '902']
        };

        // Sample available numbers
        const sampleNumbers = [
            { number: '(416) 555-1001', location: 'Toronto, ON' },
            { number: '(416) 555-1002', location: 'Toronto, ON' },
            { number: '(416) 555-1003', location: 'Toronto, ON' },
            { number: '(647) 555-2001', location: 'Toronto, ON' },
            { number: '(647) 555-2002', location: 'Toronto, ON' },
            { number: '(905) 555-3001', location: 'Mississauga, ON' },
            { number: '(514) 555-4001', location: 'Montreal, QC' },
            { number: '(514) 555-4002', location: 'Montreal, QC' },
            { number: '(604) 555-5001', location: 'Vancouver, BC' },
            { number: '(604) 555-5002', location: 'Vancouver, BC' },
            { number: '(403) 555-6001', location: 'Calgary, AB' },
            { number: '(780) 555-7001', location: 'Edmonton, AB' }
        ];

        const vanityNumbers = [
            { number: '1-800-MY-BRAND', location: 'Toll-Free' },
            { number: '(416) 00Y-BRAND', location: 'Toronto, ON' },
            { number: '(800) 555-0000', location: 'Toll-Free' },
            { number: '(416) 200-2000', location: 'Toronto, ON' },
            { number: '(647) 600-6000', location: 'Toronto, ON' },
            { number: '(514) 888-8888', location: 'Montreal, QC' }
        ];

        function updateRateCenters() {
            const province = document.getElementById('provinceFilter').value;
            const rateCenterSelect = document.getElementById('rateCenterFilter');
            rateCenterSelect.innerHTML = '<option value="">Select Rate Center</option>';

            if (province && rateCenters[province]) {
                rateCenters[province].forEach(rc => {
                    rateCenterSelect.innerHTML += `<option value="${rc}">${rc}</option>`;
                });
            }
        }

        function updateNpaNxx() {
            const rateCenter = document.getElementById('rateCenterFilter').value;
            const npaSelect = document.getElementById('npaFilter');
            npaSelect.innerHTML = '<option value="">All Area Codes</option>';

            const codes = npaCodes[rateCenter] || npaCodes['default'];
            codes.forEach(npa => {
                npaSelect.innerHTML += `<option value="${npa}">${npa}</option>`;
            });
        }

        function searchNumbers() {
            const grid = document.getElementById('numbersGrid');
            grid.innerHTML = '';

            sampleNumbers.forEach(num => {
                const isSelected = selectedNumbers.includes(num.number);
                grid.innerHTML += `
                    <div class="number-card ${isSelected ? 'selected' : ''}" onclick="toggleNumber('${num.number}', '${num.location}')">
                        <div class="number-value">${num.number}</div>
                        <div class="number-location">${num.location}</div>
                    </div>
                `;
            });
        }

        function searchVanityNumbers() {
            const grid = document.getElementById('vanityNumbersGrid');
            grid.innerHTML = '';

            vanityNumbers.forEach(num => {
                const isSelected = selectedNumbers.includes(num.number);
                grid.innerHTML += `
                    <div class="number-card ${isSelected ? 'selected' : ''}" onclick="toggleNumber('${num.number}', '${num.location}')">
                        <div class="number-value">${num.number}</div>
                        <div class="number-location">${num.location}</div>
                    </div>
                `;
            });
        }

        function toggleNumber(number, location) {
            const index = selectedNumbers.indexOf(number);
            if (index > -1) {
                selectedNumbers.splice(index, 1);
                if (primaryNumber === number) {
                    primaryNumber = selectedNumbers.length > 0 ? selectedNumbers[0] : '';
                }
            } else {
                selectedNumbers.push(number);
                // Auto-set first selected number as primary
                if (!primaryNumber) {
                    primaryNumber = number;
                }
            }
            updateSelectedDisplay();
            searchNumbers();
            searchVanityNumbers();
        }

        function removeNumber(number) {
            const index = selectedNumbers.indexOf(number);
            if (index > -1) {
                selectedNumbers.splice(index, 1);
            }
            // If we removed the primary, auto-assign to first remaining
            if (primaryNumber === number) {
                primaryNumber = selectedNumbers.length > 0 ? selectedNumbers[0] : '';
            }
            updateSelectedDisplay();
            searchNumbers();
            searchVanityNumbers();
        }

        function setPrimary(number) {
            primaryNumber = number;
            updateSelectedDisplay();
        }

        function updateSelectedDisplay() {
            const list = document.getElementById('selectedList');
            const count = document.getElementById('selectedCount');
            const nextBtn = document.getElementById('nextBtn');

            count.textContent = selectedNumbers.length;
            nextBtn.disabled = selectedNumbers.length === 0;

            if (selectedNumbers.length === 0) {
                list.innerHTML = '<span class="no-selection">No numbers selected yet</span>';
            } else {
                list.innerHTML = selectedNumbers.map(num => {
                    const isPrimary = num === primaryNumber;
                    return `
                    <div class="selected-chip ${isPrimary ? 'primary' : ''}">
                        <div>
                            ${num}
                            ${isPrimary
                                ? '<span class="primary-label">Main Number</span>'
                                : '<button class="btn-set-primary" onclick="setPrimary(\'' + num + '\')">Set as main</button>'
                            }
                        </div>
                        <button onclick="removeNumber('${num}')">
                            <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/></svg>
                        </button>
                    </div>`;
                }).join('');

                list.innerHTML += '<p class="primary-hint">The <strong>Main Number</strong> is used as the primary trunk number (<code>primaryNumber</code>). All numbers are included in the trunk.</p>';
            }
        }

        function switchTab(tab) {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

            if (tab === 'standard') {
                document.querySelector('.tab:first-child').classList.add('active');
                document.getElementById('standardTab').classList.add('active');
            } else {
                document.querySelector('.tab:last-child').classList.add('active');
                document.getElementById('vanityTab').classList.add('active');
            }
        }

        function goBack() {
            if (isPorting) {
                window.location.href = 'siptrunkLOA.html';
            } else {
                window.location.href = 'numberSource.html';
            }
        }

        function saveAndContinue() {
            if (selectedNumbers.length === 0) {
                alert('Please select at least one phone number.');
                return;
            }

            if (!primaryNumber) {
                primaryNumber = selectedNumbers[0];
            }

            setCookie('sip_selectedNumbers', JSON.stringify(selectedNumbers));
            setCookie('sip_primaryNumber', primaryNumber);
            window.location.href = 'userAssignment.html';
        }

        // Initialize
        document.addEventListener('DOMContentLoaded', function() {
            loadUserInfoBar();
            isPorting = getCookie('sip_isPorting') === 'true' || getCookie('sip_numberSource') === 'port';

            if (isPorting) {
                document.getElementById('tempNotice').style.display = 'block';
                document.getElementById('newNumbersInfo').style.display = 'none';
                document.getElementById('pageTitle').textContent = 'Select Temporary Numbers';
                document.getElementById('pageSubtitle').textContent = 'Choose temporary numbers to test your service while your existing numbers are being ported.';
            }

            // Load saved numbers
            const saved = getCookie('sip_selectedNumbers');
            if (saved) {
                try {
                    selectedNumbers = JSON.parse(saved);
                } catch (e) {}
            }

            // Load saved primary number
            const savedPrimary = getCookie('sip_primaryNumber');
            if (savedPrimary && selectedNumbers.includes(savedPrimary)) {
                primaryNumber = savedPrimary;
            } else if (selectedNumbers.length > 0) {
                primaryNumber = selectedNumbers[0];
            }

            updateSelectedDisplay();

            // Initial search
            searchNumbers();
        });
