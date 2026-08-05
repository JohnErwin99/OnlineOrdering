        // ============================================
        // NUMBER REQUESTS — espresso DID Ordering
        // ============================================
        // Numbers are ORDERED from the Iristel espresso catalog (rate center +
        // NPA + quantity), not picked from a stock list. The concrete numbers
        // are assigned when the DID order completes; the order status page
        // shows them. The catalog comes through our server proxy because the
        // espresso API is SOAP-only, has no CORS, and holds credentials.
        const DID_API_BASE = '/api/did';

        // Multi-trunk data structure.
        // Each trunk: { id, name, channels, requests: [{ratecenter, npa, quantity}],
        //               numbers: [], primaryNumber: '' }
        // numbers/primaryNumber stay in the shape — they are filled in when the
        // DID order completes, and downstream pages read them.
        let trunks = [{ id: 1, name: 'Trunk 1', channels: 1, requests: [], numbers: [], primaryNumber: '' }];
        let activeTrunkId = 1;
        let nextTrunkId = 2;
        let isPorting = false;

        // Catalog loaded from the proxy: [{ratecenter, npa}]
        let catalog = [];
        let catalogLoaded = false;

        async function loadCatalog() {
            const status = document.getElementById('catalogStatus');
            status.innerHTML = '<p style="color:var(--text-gray);font-size:14px;padding:8px 0;">Loading available rate centers…</p>';
            try {
                const response = await fetch(DID_API_BASE + '/catalog');
                const data = await response.json();
                if (!response.ok) throw new Error(data.error || ('HTTP ' + response.status));
                catalog = data.catalog || [];
                catalogLoaded = true;
                populateRateCenterList();
                const rcCount = new Set(catalog.map(c => c.ratecenter)).size;
                status.innerHTML = '<p style="color:var(--text-gray);font-size:13px;padding:8px 0;">' +
                    rcCount + ' rate centers available. Type a city above to begin.</p>';
            } catch (err) {
                console.error('Catalog load failed:', err);
                status.innerHTML = '<p style="color:var(--text-gray);font-size:14px;padding:8px 0;">Could not load the rate center catalog: '
                    + err.message + ' <a href="#" onclick="loadCatalog();return false;">Retry</a></p>';
            }
        }

        function populateRateCenterList() {
            const list = document.getElementById('rateCenterList');
            const rcs = [...new Set(catalog.map(c => c.ratecenter))].sort();
            list.innerHTML = rcs.map(rc => `<option value="${rc}">`).join('');
        }

        function updateNpaOptions() {
            const rc = document.getElementById('rateCenterFilter').value.trim().toUpperCase();
            const npaSelect = document.getElementById('npaFilter');
            const npas = [...new Set(catalog.filter(c => c.ratecenter === rc).map(c => c.npa))].sort();
            if (!npas.length) {
                npaSelect.innerHTML = '<option value="">Pick rate center first</option>';
                return;
            }
            npaSelect.innerHTML = npas.map(n => `<option value="${n}">${n}</option>`).join('');
        }

        // --- Trunk helpers ---
        function getActiveTrunk() {
            return trunks.find(t => t.id === activeTrunkId);
        }

        function trunkRequestedCount(trunk) {
            return (trunk.requests || []).reduce((sum, r) => sum + (parseInt(r.quantity, 10) || 0), 0);
        }

        // --- Trunk management ---
        function addTrunk() {
            const newTrunk = { id: nextTrunkId, name: 'Trunk ' + nextTrunkId, channels: 1, requests: [], numbers: [], primaryNumber: '' };
            trunks.push(newTrunk);
            nextTrunkId++;
            activeTrunkId = newTrunk.id;
            refreshAll();
        }

        function removeTrunk(trunkId, event) {
            event.stopPropagation();
            if (trunks.length <= 1) {
                showAlert('You must have at least one trunk.', 'info', 'Cannot remove');
                return;
            }
            const trunk = trunks.find(t => t.id === trunkId);
            if (trunk && trunk.requests.length > 0) {
                showConfirm('Remove "' + trunk.name + '" and its ' + trunk.requests.length + ' number request(s)?',
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
            refreshAll();
        }

        function switchTrunk(trunkId) {
            activeTrunkId = trunkId;
            refreshAll();
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
                trunk.channels = Math.max(1, parseInt(value, 10) || 1);
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
                    <span class="trunk-tab-count">${trunkRequestedCount(t)}</span>
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
            document.getElementById('currentTrunkNumberCount').textContent = trunk ? trunkRequestedCount(trunk) : 0;
            // Estimate: $25/channel across all trunks
            const totalChannels = trunks.reduce((sum, t) => sum + (t.channels || 1), 0);
            document.getElementById('estMonthlyCost').textContent = '$' + (totalChannels * 25).toFixed(2);
        }

        function refreshAll() {
            renderTrunkTabs();
            updateTrunkBody();
            updateSelectedDisplay();
            updateSummaryBar();
        }

        // --- Number requests ---
        function addNumberRequest() {
            const trunk = getActiveTrunk();
            if (!trunk) return;
            if (!catalogLoaded) {
                showAlert('The rate center catalog has not loaded yet. Please wait or retry.', 'info', 'Catalog loading');
                return;
            }

            const rc = document.getElementById('rateCenterFilter').value.trim().toUpperCase();
            const npa = document.getElementById('npaFilter').value;
            const quantity = Math.max(1, parseInt(document.getElementById('quantityInput').value, 10) || 1);

            if (!rc || !catalog.some(c => c.ratecenter === rc)) {
                showAlert('Please pick a rate center from the list.', 'info', 'Rate center needed');
                return;
            }
            if (!npa || !catalog.some(c => c.ratecenter === rc && c.npa === npa)) {
                showAlert('Please pick an area code for ' + rc + '.', 'info', 'Area code needed');
                return;
            }

            // Channel rule (same as before): numbers on a trunk cannot exceed channels
            const limit = trunk.channels || 1;
            if (trunkRequestedCount(trunk) + quantity > limit) {
                showAlert('This request would exceed the channel limit (' + limit + ') for "' + trunk.name +
                    '". Increase the channel count to request more numbers.', 'info', 'Channel limit');
                return;
            }

            // Merge with an existing request for the same rate center + NPA
            const existing = trunk.requests.find(r => r.ratecenter === rc && r.npa === npa);
            if (existing) {
                existing.quantity = (parseInt(existing.quantity, 10) || 0) + quantity;
            } else {
                trunk.requests.push({ ratecenter: rc, npa: npa, quantity: quantity });
            }
            refreshAll();
        }

        function removeNumberRequest(index) {
            const trunk = getActiveTrunk();
            if (!trunk) return;
            trunk.requests.splice(index, 1);
            refreshAll();
        }

        function updateSelectedDisplay() {
            const list = document.getElementById('selectedList');
            const count = document.getElementById('selectedCount');
            const nextBtn = document.getElementById('nextBtn');

            const trunk = getActiveTrunk();
            const requests = trunk ? (trunk.requests || []) : [];

            count.textContent = trunkRequestedCount(trunk || { requests: [] });

            // Enable "Next" only if every trunk has at least one request
            const allTrunksHaveRequests = trunks.every(t => (t.requests || []).length > 0);
            nextBtn.disabled = !allTrunksHaveRequests;

            if (requests.length === 0) {
                list.innerHTML = '<span class="no-selection">No numbers requested for this trunk yet</span>';
            } else {
                list.innerHTML = requests.map((r, i) => `
                    <div class="selected-chip">
                        <div>
                            ${r.ratecenter} (${r.npa}) &times; ${r.quantity}
                        </div>
                        <button onclick="removeNumberRequest(${i})">
                            <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/></svg>
                        </button>
                    </div>`).join('');

                list.innerHTML += '<p class="primary-hint">Your numbers are assigned when the order is processed. The first number of this trunk\'s order becomes its main number.</p>';
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
            // Validate all trunks have requests
            for (const trunk of trunks) {
                if (!trunk.requests || trunk.requests.length === 0) {
                    showAlert('"' + trunk.name + '" has no number requests. Please add at least one to each trunk.', 'info', 'Requests needed');
                    switchTrunk(trunk.id);
                    return;
                }
            }

            // Save multi-trunk data
            setCookie('sip_trunks', JSON.stringify(trunks));

            // Numbers are not known until the DID order completes — clear any
            // stale picks from the old inventory flow so downstream pages
            // don't show numbers this order will not contain.
            deleteCookie('sip_selectedNumbers');
            deleteCookie('sip_primaryNumber');
            deleteCookie('sip_didOrderNumber');

            window.location.href = 'userAssignment.html';
        }

        // Initialize
        document.addEventListener('DOMContentLoaded', function() {
            loadUserInfoBar();
            isPorting = isPortingOrder();

            if (isPorting) {
                document.getElementById('tempNotice').style.display = 'block';
                document.getElementById('newNumbersInfo').style.display = 'none';
                document.getElementById('pageTitle').textContent = 'Request Temporary Numbers';
                document.getElementById('pageSubtitle').textContent = 'Request temporary numbers to test your service while your existing numbers are being ported.';

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

            // Load saved trunk data
            const savedTrunks = getCookie('sip_trunks');
            if (savedTrunks) {
                try {
                    const parsed = JSON.parse(savedTrunks);
                    if (Array.isArray(parsed) && parsed.length > 0) {
                        trunks = parsed.map(t => ({ requests: [], numbers: [], primaryNumber: '', ...t }));
                        activeTrunkId = trunks[0].id;
                        nextTrunkId = Math.max(...trunks.map(t => t.id)) + 1;
                    }
                } catch (e) {}
            }

            refreshAll();
            loadCatalog();
        });
