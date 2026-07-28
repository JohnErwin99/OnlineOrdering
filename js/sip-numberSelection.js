        // Multi-trunk data structure
        // Each trunk: { id, name, channels, numbers: [], primaryNumber: '' }
        let trunks = [{ id: 1, name: 'Trunk 1', channels: 1, numbers: [], primaryNumber: '' }];
        let activeTrunkId = 1;
        let nextTrunkId = 2;
        let isPorting = false;

        // Rate centers data (simplified)
        const rateCenters = {
            'ON': ['Toronto', 'Ottawa', 'Mississauga', 'Hamilton', 'London', 'Markham', 'Vaughan', 'Kitchener', 'Windsor', 'Burlington'],
            'QC': ['Montreal', 'Quebec City', 'Laval', 'Gatineau', 'Longueuil', 'Sherbrooke', 'Trois-Rivières'],
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

        // --- Trunk helpers ---
        function getActiveTrunk() {
            return trunks.find(t => t.id === activeTrunkId);
        }

        function getAllSelectedNumbers() {
            const all = [];
            trunks.forEach(t => all.push(...t.numbers));
            return all;
        }

        function isNumberTaken(number) {
            // Check if number is assigned to ANY trunk (other than active)
            for (const t of trunks) {
                if (t.id !== activeTrunkId && t.numbers.includes(number)) return t.name;
            }
            return false;
        }

        // --- Trunk management ---
        function addTrunk() {
            const newTrunk = { id: nextTrunkId, name: 'Trunk ' + nextTrunkId, channels: 1, numbers: [], primaryNumber: '' };
            trunks.push(newTrunk);
            nextTrunkId++;
            activeTrunkId = newTrunk.id;
            renderTrunkTabs();
            updateTrunkBody();
            updateSelectedDisplay();
            refreshNumberGrids();
            updateSummaryBar();
        }

        function removeTrunk(trunkId, event) {
            event.stopPropagation();
            if (trunks.length <= 1) {
                alert('You must have at least one trunk.');
                return;
            }
            const trunk = trunks.find(t => t.id === trunkId);
            if (trunk && trunk.numbers.length > 0) {
                if (!confirm('Remove "' + trunk.name + '" and unassign its ' + trunk.numbers.length + ' number(s)?')) return;
            }
            trunks = trunks.filter(t => t.id !== trunkId);
            if (activeTrunkId === trunkId) {
                activeTrunkId = trunks[0].id;
            }
            renderTrunkTabs();
            updateTrunkBody();
            updateSelectedDisplay();
            refreshNumberGrids();
            updateSummaryBar();
        }

        function switchTrunk(trunkId) {
            activeTrunkId = trunkId;
            renderTrunkTabs();
            updateTrunkBody();
            updateSelectedDisplay();
            refreshNumberGrids();
            updateSummaryBar();
        }

        function updateTrunkName(name) {
            const trunk = getActiveTrunk();
            if (trunk) {
                trunk.name = name || ('Trunk ' + trunk.id);
                renderTrunkTabs();
            }
        }

        function updateTrunkChannels(value) {
            const trunk = getActiveTrunk();
            if (trunk) {
                trunk.channels = Math.max(1, parseInt(value) || 1);
                updateSummaryBar();
            }
        }

        function renderTrunkTabs() {
            const container = document.getElementById('trunkTabs');
            container.innerHTML = trunks.map(t => {
                const isActive = t.id === activeTrunkId;
                const removeBtn = trunks.length > 1
                    ? `<button class="trunk-tab-remove" onclick="removeTrunk(${t.id}, event)" title="Remove trunk">
                         <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/></svg>
                       </button>`
                    : '';
                return `<button class="trunk-tab ${isActive ? 'active' : ''}" onclick="switchTrunk(${t.id})">
                    ${t.name}
                    <span class="trunk-tab-count">${t.numbers.length}</span>
                    ${removeBtn}
                </button>`;
            }).join('');
        }

        function updateTrunkBody() {
            const trunk = getActiveTrunk();
            document.getElementById('trunkNameInput').value = trunk.name;
            document.getElementById('trunkChannelInput').value = trunk.channels || 1;
            document.getElementById('selectedTrunkLabel').textContent = trunk.name;
        }

        function updateSummaryBar() {
            document.getElementById('totalTrunksCount').textContent = trunks.length;
            const trunk = getActiveTrunk();
            document.getElementById('currentTrunkChannelCount').textContent = trunk ? trunk.channels : 1;
            document.getElementById('currentTrunkNumberCount').textContent = trunk ? trunk.numbers.length : 0;
            // Estimate: $25/channel across all trunks
            const totalChannels = trunks.reduce((sum, t) => sum + (t.channels || 1), 0);
            document.getElementById('estMonthlyCost').textContent = '$' + (totalChannels * 25).toFixed(2);
        }

        // --- Filter functions ---
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

        // Province abbreviation to location name mapping for filtering
        const provinceNames = {
            'ON': 'ON', 'QC': 'QC', 'BC': 'BC', 'AB': 'AB',
            'MB': 'MB', 'SK': 'SK', 'NS': 'NS', 'NB': 'NB'
        };

        // --- Number search & selection ---
        function searchNumbers() {
            const grid = document.getElementById('numbersGrid');
            grid.innerHTML = '';
            const trunk = getActiveTrunk();

            const province = document.getElementById('provinceFilter').value;
            const rateCenter = document.getElementById('rateCenterFilter').value;
            const npa = document.getElementById('npaFilter').value;

            let filtered = sampleNumbers.filter(num => {
                // Filter by province (match the abbreviation in location e.g. "Toronto, ON")
                if (province && !num.location.endsWith(', ' + province)) return false;
                // Filter by rate center (match city name in location)
                if (rateCenter && !num.location.startsWith(rateCenter + ',')) return false;
                // Filter by area code (match NPA in the number string)
                if (npa && !num.number.includes('(' + npa + ')')) return false;
                return true;
            });

            if (filtered.length === 0) {
                grid.innerHTML = '<p style="grid-column:1/-1;color:var(--text-gray);font-size:14px;padding:20px;text-align:center;">No numbers found matching your filters. Try broadening your search.</p>';
                return;
            }

            filtered.forEach(num => {
                const isSelected = trunk && trunk.numbers.includes(num.number);
                const takenBy = isNumberTaken(num.number);
                const takenClass = takenBy ? ' taken' : '';
                const takenLabel = takenBy ? `<div class="number-taken-label">On: ${takenBy}</div>` : '';
                grid.innerHTML += `
                    <div class="number-card ${isSelected ? 'selected' : ''}${takenClass}" onclick="toggleNumber('${num.number}', '${num.location}')">
                        <div class="number-value">${num.number}</div>
                        <div class="number-location">${num.location}</div>
                        ${takenLabel}
                    </div>
                `;
            });
        }

        function searchVanityNumbers() {
            const grid = document.getElementById('vanityNumbersGrid');
            grid.innerHTML = '';
            const trunk = getActiveTrunk();

            vanityNumbers.forEach(num => {
                const isSelected = trunk && trunk.numbers.includes(num.number);
                const takenBy = isNumberTaken(num.number);
                const takenClass = takenBy ? ' taken' : '';
                const takenLabel = takenBy ? `<div class="number-taken-label">On: ${takenBy}</div>` : '';
                grid.innerHTML += `
                    <div class="number-card ${isSelected ? 'selected' : ''}${takenClass}" onclick="toggleNumber('${num.number}', '${num.location}')">
                        <div class="number-value">${num.number}</div>
                        <div class="number-location">${num.location}</div>
                        ${takenLabel}
                    </div>
                `;
            });
        }

        function refreshNumberGrids() {
            searchNumbers();
            // Only refresh vanity grid if the vanity tab has been used
            if (document.getElementById('vanityNumbersGrid').children.length > 0) {
                searchVanityNumbers();
            }
        }

        function toggleNumber(number, location) {
            const trunk = getActiveTrunk();
            if (!trunk) return;

            const index = trunk.numbers.indexOf(number);
            if (index > -1) {
                // Remove from this trunk
                trunk.numbers.splice(index, 1);
                if (trunk.primaryNumber === number) {
                    trunk.primaryNumber = trunk.numbers.length > 0 ? trunk.numbers[0] : '';
                }
            } else {
                // Check channel limit
                if (trunk.numbers.length >= (trunk.channels || 1)) {
                    alert('You have reached the channel limit (' + (trunk.channels || 1) + ') for "' + trunk.name + '". Increase the channel count to add more numbers.');
                    return;
                }
                // Check if already on another trunk
                const takenBy = isNumberTaken(number);
                if (takenBy) {
                    alert('This number is already assigned to "' + takenBy + '". Remove it there first.');
                    return;
                }
                trunk.numbers.push(number);
                if (!trunk.primaryNumber) {
                    trunk.primaryNumber = number;
                }
            }
            updateSelectedDisplay();
            refreshNumberGrids();
            renderTrunkTabs();
            updateSummaryBar();
        }

        function removeNumber(number) {
            const trunk = getActiveTrunk();
            if (!trunk) return;

            const index = trunk.numbers.indexOf(number);
            if (index > -1) {
                trunk.numbers.splice(index, 1);
            }
            if (trunk.primaryNumber === number) {
                trunk.primaryNumber = trunk.numbers.length > 0 ? trunk.numbers[0] : '';
            }
            updateSelectedDisplay();
            refreshNumberGrids();
            renderTrunkTabs();
            updateSummaryBar();
        }

        function setPrimary(number) {
            const trunk = getActiveTrunk();
            if (trunk) {
                trunk.primaryNumber = number;
            }
            updateSelectedDisplay();
        }

        function updateSelectedDisplay() {
            const list = document.getElementById('selectedList');
            const count = document.getElementById('selectedCount');
            const nextBtn = document.getElementById('nextBtn');

            const trunk = getActiveTrunk();
            const numbers = trunk ? trunk.numbers : [];
            const primary = trunk ? trunk.primaryNumber : '';

            count.textContent = numbers.length;

            // Enable "Next" only if every trunk has at least one number
            const allTrunksHaveNumbers = trunks.every(t => t.numbers.length > 0);
            nextBtn.disabled = !allTrunksHaveNumbers;

            if (numbers.length === 0) {
                list.innerHTML = '<span class="no-selection">No numbers selected for this trunk yet</span>';
            } else {
                list.innerHTML = numbers.map(num => {
                    const isPrimary = num === primary;
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

                list.innerHTML += '<p class="primary-hint">The <strong>Main Number</strong> is the primary number for this trunk. Each trunk can have its own main number.</p>';
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
            // Validate all trunks have numbers
            for (const trunk of trunks) {
                if (trunk.numbers.length === 0) {
                    alert('"' + trunk.name + '" has no numbers assigned. Please add at least one number to each trunk.');
                    switchTrunk(trunk.id);
                    return;
                }
                if (!trunk.primaryNumber) {
                    trunk.primaryNumber = trunk.numbers[0];
                }
            }

            // Save multi-trunk data
            setCookie('sip_trunks', JSON.stringify(trunks));

            // Backward compatibility: flatten all numbers and use first trunk's primary
            const allNumbers = getAllSelectedNumbers();
            setCookie('sip_selectedNumbers', JSON.stringify(allNumbers));
            setCookie('sip_primaryNumber', trunks[0].primaryNumber);

            window.location.href = 'userAssignment.html';
        }

        // Initialize
        document.addEventListener('DOMContentLoaded', function() {
            loadUserInfoBar();
            isPorting = isPortingOrder();

            if (isPorting) {
                document.getElementById('tempNotice').style.display = 'block';
                document.getElementById('newNumbersInfo').style.display = 'none';
                document.getElementById('pageTitle').textContent = 'Select Temporary Numbers';
                document.getElementById('pageSubtitle').textContent = 'Choose temporary numbers to test your service while your existing numbers are being ported.';

                // Default channel count to match the number of ported numbers
                const portData = getCookie('sip_portNumbers');
                if (portData) {
                    try {
                        const portedCount = JSON.parse(portData).length;
                        if (portedCount > 0) {
                            trunks[0].channels = portedCount;
                        }
                    } catch (e) {}
                }
            }

            // Load saved trunk data (new format)
            const savedTrunks = getCookie('sip_trunks');
            if (savedTrunks) {
                try {
                    const parsed = JSON.parse(savedTrunks);
                    if (Array.isArray(parsed) && parsed.length > 0) {
                        trunks = parsed;
                        activeTrunkId = trunks[0].id;
                        nextTrunkId = Math.max(...trunks.map(t => t.id)) + 1;
                    }
                } catch (e) {}
            } else {
                // Migrate from old single-trunk format
                const savedNumbers = getCookie('sip_selectedNumbers');
                const savedPrimary = getCookie('sip_primaryNumber');
                if (savedNumbers) {
                    try {
                        const nums = JSON.parse(savedNumbers);
                        if (nums.length > 0) {
                            trunks[0].numbers = nums;
                            trunks[0].primaryNumber = savedPrimary && nums.includes(savedPrimary) ? savedPrimary : nums[0];
                        }
                    } catch (e) {}
                }
            }

            renderTrunkTabs();
            updateTrunkBody();
            updateSelectedDisplay();
            updateSummaryBar();

            // Initial search
            searchNumbers();
        });
