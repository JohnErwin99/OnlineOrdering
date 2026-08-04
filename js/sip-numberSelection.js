        // Multi-trunk data structure
        // Each trunk: { id, name, channels, numbers: [], primaryNumber: '' }
        let trunks = [{ id: 1, name: 'Trunk 1', channels: 1, numbers: [], primaryNumber: '' }];
        let activeTrunkId = 1;
        let nextTrunkId = 2;
        let isPorting = false;

        // ============================================
        // TELEPHONE NUMBERS API (live inventory)
        // https://iristel-x.readme.io/reference/reserved
        // ============================================
        const TN_API_URL = 'https://api.iristelx.com/telephone-numbers/reserved';
        const TN_API_KEY = 'OB0VcACMyxxXVbjp0UQnDFsTuScpT4seDR1t';
        const TN_PAGE_LIMIT = 100000; // pull full available inventory in one call
        const MAX_RESULTS_SHOWN = 60; // cards rendered per search

        // Live inventory loaded from the API
        let availableNumbers = [];
        let numbersLoaded = false;
        let numbersLoadError = null;

        function titleCase(str) {
            return (str || '').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
        }

        function formatTn(tn) {
            // "14169005507" -> "(416) 900-5507"
            const d = String(tn).replace(/\D/g, '').replace(/^1/, '');
            if (d.length !== 10) return String(tn);
            return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
        }

        async function loadAvailableNumbers() {
            const grid = document.getElementById('numbersGrid');
            grid.innerHTML = '<p style="grid-column:1/-1;color:var(--text-gray);font-size:14px;padding:20px;text-align:center;">Loading available numbers…</p>';
            try {
                const response = await fetch(`${TN_API_URL}?inUse=false&page=1&pageLimit=${TN_PAGE_LIMIT}`, {
                    headers: {
                        'accept': 'application/json',
                        'iristelx-api-key': TN_API_KEY
                    }
                });
                if (!response.ok) throw new Error('API returned ' + response.status);
                const data = await response.json();
                availableNumbers = (data.telephoneNumbers || [])
                    .filter(tn => tn.inUse === false)
                    .map(tn => ({
                        number: formatTn(tn.telephoneNumber),
                        raw: tn.telephoneNumber,
                        city: titleCase(tn.city),
                        province: tn.province || '',
                        country: tn.country || '',
                        areaCode: tn.areaCode || '',
                        location: titleCase(tn.city) + ', ' + (tn.province || '')
                    }));
                numbersLoaded = true;
                numbersLoadError = null;
                populateCountryFilter();
                updateProvinces();
            } catch (err) {
                console.error('Failed to load telephone numbers:', err);
                numbersLoadError = err;
                grid.innerHTML = '<p style="grid-column:1/-1;color:var(--text-gray);font-size:14px;padding:20px;text-align:center;">Could not load available numbers. <a href="#" onclick="loadAvailableNumbers();return false;">Retry</a></p>';
            }
            if (numbersLoaded) searchNumbers();
        }

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
                showAlert('You must have at least one trunk.', 'info', 'Cannot remove');
                return;
            }
            const trunk = trunks.find(t => t.id === trunkId);
            if (trunk && trunk.numbers.length > 0) {
                showConfirm('Remove "' + trunk.name + '" and unassign its ' + trunk.numbers.length + ' number(s)?',
                    () => applyRemoveTrunk(trunkId),
                    { title: 'Remove trunk', confirmText: 'Remove', type: 'error' });
                return;
            }
            applyRemoveTrunk(trunkId);
        }

        function applyRemoveTrunk(trunkId) {
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

        // --- Filter functions (options built from live inventory) ---
        function getFilterValue(id) {
            const el = document.getElementById(id);
            return el ? el.value : '';
        }

        function fillSelect(selectId, values, allLabel, keepValue) {
            const select = document.getElementById(selectId);
            if (!select) return;
            const previous = keepValue ? select.value : '';
            select.innerHTML = `<option value="">${allLabel}</option>` +
                values.map(v => `<option value="${v}">${v}</option>`).join('');
            if (previous && values.includes(previous)) select.value = previous;
        }

        function populateCountryFilter() {
            const countries = [...new Set(availableNumbers.map(n => n.country).filter(Boolean))].sort();
            fillSelect('countryFilter', countries, 'All Countries', true);
        }

        function updateProvinces() {
            const country = getFilterValue('countryFilter');
            const pool = availableNumbers.filter(n => !country || n.country === country);
            const provinces = [...new Set(pool.map(n => n.province).filter(Boolean))].sort();
            fillSelect('provinceFilter', provinces, 'All Provinces', true);
            updateRateCenters();
        }

        function updateRateCenters() {
            const country = getFilterValue('countryFilter');
            const province = getFilterValue('provinceFilter');
            const pool = availableNumbers.filter(n =>
                (!country || n.country === country) &&
                (!province || n.province === province));
            const cities = [...new Set(pool.map(n => n.city).filter(Boolean))].sort();
            fillSelect('rateCenterFilter', cities, 'All Rate Centers', true);
            updateNpaNxx();
        }

        function updateNpaNxx() {
            const country = getFilterValue('countryFilter');
            const province = getFilterValue('provinceFilter');
            const rateCenter = getFilterValue('rateCenterFilter');
            const pool = availableNumbers.filter(n =>
                (!country || n.country === country) &&
                (!province || n.province === province) &&
                (!rateCenter || n.city === rateCenter));
            const npas = [...new Set(pool.map(n => n.areaCode).filter(Boolean))].sort();
            fillSelect('npaFilter', npas, 'All Area Codes', true);
        }

        // --- Number search & selection ---
        function searchNumbers() {
            const grid = document.getElementById('numbersGrid');
            grid.innerHTML = '';
            const trunk = getActiveTrunk();

            if (!numbersLoaded) {
                grid.innerHTML = '<p style="grid-column:1/-1;color:var(--text-gray);font-size:14px;padding:20px;text-align:center;">Loading available numbers…</p>';
                return;
            }

            const country = getFilterValue('countryFilter');
            const province = getFilterValue('provinceFilter');
            const rateCenter = getFilterValue('rateCenterFilter');
            const npa = getFilterValue('npaFilter');

            const filtered = availableNumbers.filter(num => {
                if (country && num.country !== country) return false;
                if (province && num.province !== province) return false;
                if (rateCenter && num.city !== rateCenter) return false;
                if (npa && num.areaCode !== npa) return false;
                return true;
            });

            if (filtered.length === 0) {
                grid.innerHTML = '<p style="grid-column:1/-1;color:var(--text-gray);font-size:14px;padding:20px;text-align:center;">No numbers found matching your filters. Try broadening your search.</p>';
                return;
            }

            const shown = filtered.slice(0, MAX_RESULTS_SHOWN);
            if (filtered.length > shown.length) {
                grid.innerHTML += `<p style="grid-column:1/-1;color:var(--text-gray);font-size:13px;padding:4px 0;">Showing ${shown.length} of ${filtered.length.toLocaleString()} available numbers. Use the filters to narrow your search.</p>`;
            }

            shown.forEach(num => {
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

            // Load live inventory from the API, then render the grid
            loadAvailableNumbers();
        });
