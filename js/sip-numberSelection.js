        // ============================================
        // NUMBER SELECTION — espresso live inventory
        // ============================================
        // The customer PICKS specific numbers. After choosing a rate center
        // and area code, "Show available numbers" asks our server for numbers
        // that are free in espresso's inventory AND unknown to MIND — each one
        // is checked, so the call takes a few seconds. Nothing is held: the
        // server checks the picks again before payment and when the order is
        // placed. Catalog and inventory both come through our server proxy
        // because espresso has no CORS and holds credentials.
        const DID_API_BASE = '/api/did';

        // Multi-trunk data structure.
        // Each trunk: { id, name, channels, requests: [{ratecenter, npa, quantity, dids}],
        //               numbers: [], primaryNumber: '' }
        // channels is USER-CHOSEN (concurrent call capacity, billed per
        // channel) and independent of the DID quantity (billed per number).
        // Picks live ONLY in requests[].dids (raw 10-digit strings). A picked
        // request is complete when dids.length === quantity; one left short
        // (picked numbers that became unavailable) keeps its wanted quantity
        // until the customer picks the rest. A request without dids is an
        // older auto-pick request — the server chooses those numbers itself.
        // numbers/primaryNumber stay empty until the DID order completes; the
        // status page fills them and downstream pages read them.
        let trunks = [{ id: 1, name: 'Trunk 1', channels: 1, requests: [], numbers: [], primaryNumber: '' }];
        let activeTrunkId = 1;
        let nextTrunkId = 2;
        let isPorting = false;

        // Catalog loaded from the proxy: [{ratecenter, npa}]
        let catalog = [];
        let catalogLoaded = false;

        // The live picker: the last inventory answer for one rate center +
        // NPA. status is 'loading' | 'error' | 'ready'; checked holds the
        // ticked numbers. pickerToken discards an answer that arrives after
        // the customer moved on to another city.
        let picker = null;
        let pickerToken = 0;
        // From /api/config — false while espresso's inventory can't be read
        let pickReady = true;
        // Numbers the review or status page reported gone — never offered again
        const goneNumbers = new Set();

        const REMOVE_ICON = '<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/></svg>';

        function escapeHtml(value) {
            return String(value == null ? '' : value).replace(/[&<>"']/g, ch =>
                ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
        }

        // (204) 555-0001 for display; the raw 10 digits are what is stored
        function formatPhone(number) {
            const d = tenDigits(number);
            return d.length === 10 ? '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6) : String(number || '');
        }

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
                    + escapeHtml(err.message) + ' <a href="#" onclick="loadCatalog();return false;">Retry</a></p>';
            }
        }

        function populateRateCenterList() {
            const list = document.getElementById('rateCenterList');
            const rcs = [...new Set(catalog.map(c => c.ratecenter))].sort();
            list.innerHTML = rcs.map(rc => `<option value="${escapeHtml(rc)}">`).join('');
        }

        function updateNpaOptions() {
            const rc = document.getElementById('rateCenterFilter').value.trim().toUpperCase();
            const npaSelect = document.getElementById('npaFilter');
            const npas = [...new Set(catalog.filter(c => c.ratecenter === rc).map(c => c.npa))].sort();
            if (!npas.length) {
                npaSelect.innerHTML = '<option value="">Pick rate center first</option>';
                return;
            }
            npaSelect.innerHTML = npas.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
        }

        // The city or area code changed — the numbers shown are for the old one
        function onRateCenterInput() {
            updateNpaOptions();
            resetPicker();
        }

        // --- Trunk helpers ---
        function getActiveTrunk() {
            return trunks.find(t => t.id === activeTrunkId);
        }

        function isPickedRequest(r) {
            return Array.isArray(r.dids);
        }

        function requestWanted(r) {
            return parseInt(r.quantity, 10) || 0;
        }

        // Numbers a request holds now: its picks, or the auto-picked quantity
        function requestPickedCount(r) {
            return isPickedRequest(r) ? r.dids.length : requestWanted(r);
        }

        function isRequestIncomplete(r) {
            return isPickedRequest(r) && r.dids.length < requestWanted(r);
        }

        // Wanted quantity — what billing (getTrunkBilling) counts
        function trunkRequestedCount(trunk) {
            return (trunk.requests || []).reduce((sum, r) => sum + requestWanted(r), 0);
        }

        function trunkPickedCount(trunk) {
            return (trunk.requests || []).reduce((sum, r) => sum + requestPickedCount(r), 0);
        }

        function trunkIsIncomplete(trunk) {
            return (trunk.requests || []).some(isRequestIncomplete);
        }

        // "3", or "1/3" while picks are still owed
        function trunkCountLabel(trunk) {
            const picked = trunkPickedCount(trunk);
            return trunkIsIncomplete(trunk) ? picked + '/' + trunkRequestedCount(trunk) : String(picked);
        }

        function allPickedNumbers() {
            return trunks.flatMap(t => (t.requests || []).flatMap(r => isPickedRequest(r) ? r.dids : []));
        }

        // The trunk that already holds a picked number, else null
        function trunkHoldingNumber(number) {
            return trunks.find(t => (t.requests || []).some(r => isPickedRequest(r) && r.dids.includes(number))) || null;
        }

        // The first picked number (request order, then pick order) becomes
        // the trunk's main number
        function mainNumberOf(trunk) {
            return (trunk.requests || []).flatMap(r => isPickedRequest(r) ? r.dids : [])[0] || '';
        }

        // Picks from storage: raw 10-digit strings in the request's area code,
        // each number once across all trunks, gone numbers dropped. A request
        // that loses picks here keeps its wanted quantity, so the customer is
        // asked to pick the rest. One with nothing wanted is dropped.
        function normalizeTrunkRequests() {
            const seen = new Set();
            trunks.forEach(trunk => {
                trunk.requests = (trunk.requests || [])
                    .filter(r => r && r.ratecenter && r.npa)
                    .map(r => {
                        if (!isPickedRequest(r)) return r;
                        const dids = r.dids.map(tenDigits).filter(d => {
                            if (!/^\d{10}$/.test(d) || d.slice(0, 3) !== String(r.npa)) return false;
                            if (seen.has(d) || goneNumbers.has(d)) return false;
                            seen.add(d);
                            return true;
                        });
                        return Object.assign({}, r, { dids: dids, quantity: Math.max(requestWanted(r), dids.length) });
                    })
                    .filter(r => requestWanted(r) > 0);
            });
        }

        // --- Trunk management ---
        // Numbers already ordered — an order placed, or its numbers delivered
        // — can't be changed here: a new pick would be charged but never
        // ordered, or buy a second set. Set on load; null when editable.
        let orderLock = null;

        function lockedOut() {
            if (!orderLock) return false;
            showAlert('The numbers for ' + (orderLock.orderNumber ? 'order ' + orderLock.orderNumber : 'this order')
                + ' have already been ordered, so they can\'t be changed here. Use Next to follow your order.',
                'info', 'Numbers already ordered');
            return true;
        }

        function addTrunk() {
            if (lockedOut()) return;
            const newTrunk = { id: nextTrunkId, name: 'Trunk ' + nextTrunkId, channels: 1, requests: [], numbers: [], primaryNumber: '' };
            trunks.push(newTrunk);
            nextTrunkId++;
            activeTrunkId = newTrunk.id;
            refreshAll();
        }

        function removeTrunk(trunkId, event) {
            event.stopPropagation();
            if (lockedOut()) return;
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
            if (orderLock) {
                // Channels are priced — keep what was ordered
                document.getElementById('channelsInput').value = (trunk && trunk.channels) || 1;
                lockedOut();
                return;
            }
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
                         ${REMOVE_ICON}
                       </button>`
                    : '';
                return `<button class="trunk-tab ${isActive ? 'active' : ''}" onclick="switchTrunk(${t.id})">
                    ${escapeHtml(t.name)}
                    <span class="trunk-tab-count">${trunkCountLabel(t)}</span>
                    ${removeBtn}
                </button>`;
            }).join('');
        }

        function updateTrunkBody() {
            const trunk = getActiveTrunk();
            document.getElementById('trunkNameInput').value = trunk.name;
            document.getElementById('channelsInput').value = trunk.channels || 1;
            document.getElementById('selectedTrunkLabel').textContent = trunk.name;
        }

        function updateSummaryBar() {
            document.getElementById('totalTrunksCount').textContent = trunks.length;
            const trunk = getActiveTrunk();
            document.getElementById('currentChannelCount').textContent = trunk ? (trunk.channels || 1) : 1;
            document.getElementById('currentTrunkNumberCount').textContent = !trunk ? 0
                : trunkIsIncomplete(trunk) ? trunkPickedCount(trunk) + ' of ' + trunkRequestedCount(trunk) + ' picked'
                : trunkPickedCount(trunk);
            // Same rule as the review page and MIND: every DID is billed.
            // Billing counts the wanted quantity, picked or not.
            const estimate = trunks.reduce((sum, t) => sum + getTrunkBilling(t).monthly, 0);
            document.getElementById('estMonthlyCost').textContent = '$' + estimate.toFixed(2);
        }

        function refreshAll() {
            renderTrunkTabs();
            updateTrunkBody();
            updateSelectedDisplay();
            updateSummaryBar();
            renderPicker();
        }

        // --- Picker availability (/api/config) ---
        async function loadPickerConfig() {
            try {
                const response = await fetch('/api/config');
                const data = await response.json();
                if (!response.ok) throw new Error('HTTP ' + response.status);
                // 'reserve': espresso sets numbers aside for the customer to
                // pick from (stands in until inventory search is available)
                pickSource = data.pickSource || 'inventory';
                setPickReady(data.pickReady !== false);
            } catch (err) {
                // Can't tell — leave the picker on; it reports its own errors
                console.warn('Config check failed:', err.message);
            }
            // The server re-checks espresso every minute while it is down
            if (!pickReady) setTimeout(loadPickerConfig, 60000);
        }

        let pickSource = 'inventory';

        function setPickReady(ready) {
            pickReady = ready;
            document.getElementById('pickerBanner').style.display = ready ? 'none' : 'block';
            updatePickerButton();
        }

        function updatePickerButton() {
            const loading = !!picker && picker.status === 'loading';
            document.getElementById('showNumbersBtn').disabled = !pickReady || loading;
            document.getElementById('showNumbersLabel').textContent = !loading ? 'Show available numbers'
                : pickSource === 'reserve' ? 'Reserving numbers…' : 'Checking numbers…';
        }

        // --- Live number picker ---
        function resetPicker() {
            pickerToken++;
            picker = null;
            renderPicker();
        }

        // Fill the rate center, area code and quantity inputs
        function prefillPicker(rc, npa, quantity) {
            document.getElementById('rateCenterFilter').value = rc;
            updateNpaOptions();
            document.getElementById('npaFilter').value = npa;
            document.getElementById('quantityInput').value = quantity;
            resetPicker();
        }

        async function showAvailableNumbers() {
            if (lockedOut()) return;
            if (!pickReady) {
                showAlert('Number selection is temporarily unavailable — please try again in a few minutes.', 'info', 'Please try again shortly');
                return;
            }
            if (!catalogLoaded) {
                showAlert('The rate center catalog has not loaded yet. Please wait or retry.', 'info', 'Catalog loading');
                return;
            }

            const rc = document.getElementById('rateCenterFilter').value.trim().toUpperCase();
            const npa = document.getElementById('npaFilter').value;
            const quantity = Math.min(100, Math.max(1, parseInt(document.getElementById('quantityInput').value, 10) || 1));

            if (!rc || !catalog.some(c => c.ratecenter === rc)) {
                showAlert('Please pick a rate center from the list.', 'info', 'Rate center needed');
                return;
            }
            if (!npa || !catalog.some(c => c.ratecenter === rc && c.npa === npa)) {
                showAlert('Please pick an area code for ' + rc + '.', 'info', 'Area code needed');
                return;
            }

            const token = ++pickerToken;
            picker = { ratecenter: rc, npa: npa, quantity: quantity, status: 'loading',
                numbers: [], exhausted: false, error: '', checked: new Set() };
            renderPicker();

            // Never offer a number already picked on any trunk, or one that
            // was just reported gone
            const exclude = [...new Set(allPickedNumbers().concat([...goneNumbers]))];
            const params = new URLSearchParams({
                ratecenter: rc,
                npa: npa,
                quantity: String(quantity),
                email: getCookie('sip_billingEmail') || getCookie('iristel_user_email') || '',
                exclude: exclude.join(',')
            });

            let response = null;
            let data = null;
            try {
                response = await fetch(DID_API_BASE + '/available?' + params.toString());
                data = await response.json().catch(() => null);
            } catch (err) {
                console.error('Available numbers lookup failed:', err);
            }
            if (token !== pickerToken) return; // the customer moved on

            if (!response || !response.ok || !data) {
                console.warn('Available numbers:', response && response.status, data);
                picker.status = 'error';
                picker.error = pickerErrorMessage(response, data);
                picker.retry = !(data && data.code === 'NO_MIND_CITY');
                renderPicker();
                return;
            }

            picker.numbers = [...new Set((data.numbers || []).map(tenDigits))]
                .filter(d => /^\d{10}$/.test(d) && !goneNumbers.has(d));
            picker.exhausted = !!data.exhausted;
            picker.reservation = data.reservation || null;
            // The hold timer counts down the reservation holding the picks
            if (picker.reservation && picker.reservation.expiresAt) setCookie('sip_holdExpiresAt', picker.reservation.expiresAt);
            picker.status = 'ready';
            // Pre-tick as many as were asked for
            picker.numbers.filter(d => !trunkHoldingNumber(d)).slice(0, quantity).forEach(d => picker.checked.add(d));
            renderPicker();
        }

        function pickerErrorMessage(response, data) {
            const code = data && data.code;
            if (code === 'MIND_UNAVAILABLE') return 'We can\'t verify numbers right now — please try again in a few minutes.';
            if (code === 'NO_MIND_CITY') return 'Numbers in this city can\'t be offered right now — please choose another city.';
            if (response && response.status === 400) return 'Please pick a rate center and area code from the lists, then try again.';
            return 'Number inventory is temporarily unavailable — please try again shortly.';
        }

        function renderPicker() {
            updatePickerButton();
            const panel = document.getElementById('pickerPanel');
            if (!picker) {
                panel.style.display = 'none';
                return;
            }
            panel.style.display = 'block';

            const where = picker.ratecenter + ' (' + picker.npa + ')';
            const message = document.getElementById('pickerMessage');
            const list = document.getElementById('pickerList');
            const actions = document.getElementById('pickerActions');
            document.getElementById('pickerTitle').textContent = 'Available numbers — ' + where;

            if (picker.status === 'loading') {
                message.className = 'picker-message';
                message.innerHTML = '<span class="picker-spinner"></span><span>' + (pickSource === 'reserve'
                    ? 'Setting aside numbers for you in ' + escapeHtml(where) + '… This takes about half a minute, and each number is checked before it is offered.'
                    : 'Finding available numbers in ' + escapeHtml(where) + '… Each number is checked before it is offered, so this can take a few seconds.')
                    + '</span>';
                list.innerHTML = '';
                actions.style.display = 'none';
                document.getElementById('pickerSelectedCount').textContent = '';
                return;
            }

            if (picker.status === 'error') {
                message.className = 'picker-message error';
                message.innerHTML = '<span>' + escapeHtml(picker.error) + '</span>'
                    + (picker.retry ? ' <button class="btn-pick-more" onclick="showAvailableNumbers()">Try again</button>' : '');
                list.innerHTML = '';
                actions.style.display = 'none';
                document.getElementById('pickerSelectedCount').textContent = '';
                return;
            }

            // Fewer than asked for: espresso ran out (exhausted), or not
            // enough could be confirmed free this time round
            const found = picker.numbers.length;
            let note = '';
            let noteClass = 'picker-message';
            if (!found) {
                noteClass += ' warning';
                note = picker.exhausted
                    ? 'No numbers are available in ' + where + ' right now — please choose another city or area code.'
                    : 'We couldn\'t confirm any free numbers in ' + where + ' right now — please try again or choose another city.';
            } else if (found < picker.quantity) {
                noteClass += ' warning';
                note = picker.exhausted
                    ? 'Only ' + found + ' available in ' + where + '.'
                    : 'Only ' + found + ' could be confirmed in ' + where + ' right now. Add these, then show available numbers again to look for more.';
            } else {
                note = (picker.exhausted ? 'These are all the numbers available in ' + where + ' right now. ' : '')
                    + 'Tick the numbers you want, then add them to ' + (getActiveTrunk() ? getActiveTrunk().name : 'your trunk') + '.';
            }
            // Reserved numbers are held for this customer for about an hour
            const until = picker.reservation && picker.reservation.expiresAt && new Date(picker.reservation.expiresAt);
            if (found && until && !isNaN(until)) {
                note += ' Reserved for you until ' + until.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + '.';
            }
            message.className = noteClass;
            message.textContent = note;

            // A number picked on any trunk is shown but can't be picked again
            const active = getActiveTrunk();
            list.innerHTML = picker.numbers.map(d => {
                const holder = trunkHoldingNumber(d);
                if (holder) {
                    return `<label class="picker-item unavailable">
                        <input type="checkbox" disabled>
                        <span class="number-value">${formatPhone(d)}</span>
                        <span class="picker-item-note">${holder === active ? 'Added' : 'On ' + escapeHtml(holder.name)}</span>
                    </label>`;
                }
                return `<label class="picker-item">
                    <input type="checkbox" value="${d}" onchange="togglePickerNumber('${d}', this.checked)" ${picker.checked.has(d) ? 'checked' : ''}>
                    <span class="number-value">${formatPhone(d)}</span>
                </label>`;
            }).join('');

            actions.style.display = found ? 'flex' : 'none';
            updatePickerSelection();
        }

        function togglePickerNumber(number, checked) {
            if (!picker) return;
            if (checked) picker.checked.add(number);
            else picker.checked.delete(number);
            updatePickerSelection();
        }

        // Ticked numbers nobody has picked yet
        function pickerSelection() {
            return picker ? picker.numbers.filter(d => picker.checked.has(d) && !trunkHoldingNumber(d)) : [];
        }

        function updatePickerSelection() {
            const count = pickerSelection().length;
            document.getElementById('pickerSelectedCount').textContent = count + ' selected';
            document.getElementById('addSelectedBtn').disabled = count === 0;
        }

        // Merge the ticked numbers into the active trunk's picked request for
        // this rate center + NPA. No channel cap: numbers (DIDs) and channels
        // are billed independently, so any quantity is fine.
        function addSelectedNumbers() {
            if (lockedOut()) return;
            const trunk = getActiveTrunk();
            if (!trunk || !picker || picker.status !== 'ready') return;
            const picks = pickerSelection();
            if (!picks.length) {
                showAlert('Tick at least one number to add.', 'info', 'No numbers selected');
                return;
            }

            const existing = trunk.requests.find(r => isPickedRequest(r)
                && r.ratecenter === picker.ratecenter && r.npa === picker.npa);
            if (existing) {
                const dids = existing.dids.concat(picks.filter(d => !existing.dids.includes(d)));
                // A short request keeps what it still owes; a complete one
                // grows to exactly what is picked
                existing.quantity = Math.max(requestWanted(existing), dids.length);
                existing.dids = dids;
            } else {
                trunk.requests.push({ ratecenter: picker.ratecenter, npa: picker.npa, quantity: picks.length, dids: picks });
            }
            picker.checked.clear();
            refreshAll();
        }

        // --- Picked numbers ---
        function removePickedNumber(index, number) {
            if (lockedOut()) return;
            const trunk = getActiveTrunk();
            const r = trunk && trunk.requests[index];
            if (!r || !isPickedRequest(r)) return;
            const at = r.dids.indexOf(number);
            if (at === -1) return;
            r.dids.splice(at, 1);
            if (!r.dids.length) {
                // The last number goes, and the request with it
                trunk.requests.splice(index, 1);
            } else {
                // One fewer wanted; a short request stays exactly as short
                r.quantity = Math.max(r.dids.length, requestWanted(r) - 1);
            }
            refreshAll();
        }

        function removeNumberRequest(index) {
            if (lockedOut()) return;
            const trunk = getActiveTrunk();
            const r = trunk && trunk.requests[index];
            if (!r) return;
            const apply = () => {
                trunk.requests.splice(index, 1);
                refreshAll();
            };
            if (isPickedRequest(r) && r.dids.length > 1) {
                showConfirm('Remove ' + r.ratecenter + ' (' + r.npa + ') and its ' + r.dids.length + ' picked numbers?',
                    apply, { title: 'Remove numbers', confirmText: 'Remove', type: 'error' });
                return;
            }
            apply();
        }

        // Open the picker on a short request's rate center for what it still owes
        function pickMoreFor(index) {
            const trunk = getActiveTrunk();
            const r = trunk && trunk.requests[index];
            if (!r || !isRequestIncomplete(r)) return;
            prefillPicker(r.ratecenter, r.npa, requestWanted(r) - r.dids.length);
            document.getElementById('standardTab').scrollIntoView({ behavior: 'smooth', block: 'start' });
            showAvailableNumbers();
        }

        function renderRequestGroup(r, index, mainNumber) {
            const where = escapeHtml(r.ratecenter) + ' (' + escapeHtml(r.npa) + ')';
            const removeBtn = `<button class="request-group-remove" onclick="removeNumberRequest(${index})" title="Remove ${where}">${REMOVE_ICON}</button>`;

            // Older auto-pick request: the server chooses the numbers
            if (!isPickedRequest(r)) {
                return `<div class="request-group legacy">
                    <div class="request-group-header">
                        <span class="request-group-title">${where} &times; ${requestWanted(r)}</span>
                        <span class="request-group-status">— numbers assigned automatically</span>
                        ${removeBtn}
                    </div>
                </div>`;
            }

            const wanted = requestWanted(r);
            const short = wanted - r.dids.length;
            const status = short > 0
                ? `<span class="request-group-status">${r.dids.length} of ${wanted} picked — pick ${short} more</span>
                   <button class="btn-pick-more" onclick="pickMoreFor(${index})">Pick ${short} more</button>`
                : `<span class="request-group-status">${r.dids.length} number${r.dids.length === 1 ? '' : 's'}</span>`;
            const chips = r.dids.map(d => {
                const isMain = d === mainNumber;
                return `<div class="selected-chip${isMain ? ' primary' : ''}">
                    <span>${formatPhone(d)}</span>
                    ${isMain ? '<span class="primary-label">Main</span>' : ''}
                    <button onclick="removePickedNumber(${index}, '${d}')" title="Remove ${formatPhone(d)}">${REMOVE_ICON}</button>
                </div>`;
            }).join('');

            return `<div class="request-group${short > 0 ? ' incomplete' : ''}">
                <div class="request-group-header">
                    <span class="request-group-title">${where}</span>
                    ${status}
                    ${removeBtn}
                </div>
                ${chips ? '<div class="selected-list">' + chips + '</div>' : ''}
            </div>`;
        }

        function updateSelectedDisplay() {
            const list = document.getElementById('selectedList');
            const count = document.getElementById('selectedCount');
            const nextBtn = document.getElementById('nextBtn');

            const trunk = getActiveTrunk();
            const requests = trunk ? (trunk.requests || []) : [];

            count.textContent = trunk ? trunkPickedCount(trunk) : 0;

            // "Next" only when every trunk has a request and every pick is complete
            const allTrunksHaveRequests = trunks.every(t => (t.requests || []).length > 0);
            nextBtn.disabled = !allTrunksHaveRequests || trunks.some(trunkIsIncomplete);

            if (requests.length === 0) {
                list.innerHTML = '<span class="no-selection">No numbers picked for this trunk yet — choose a city and area code above, then show available numbers.</span>';
                return;
            }

            const mainNumber = mainNumberOf(trunk);
            list.innerHTML = requests.map((r, i) => renderRequestGroup(r, i, mainNumber)).join('')
                + '<p class="primary-hint">The first number picked for this trunk becomes its <strong>main number</strong>.</p>';
        }

        // --- Sent back to re-pick ---
        // The review page (picks refused before or after payment) or the
        // status page (espresso rejected the order) already fixed the trunks
        // and left one sip_orderRejection entry per problem:
        //   { ratecenter, npa, numbers, reason, kind, paid }
        // kind says what happened:
        //   'gone'      — the numbers can't be had; they came off their
        //                 request, which is now short
        //   'duplicate' — picked twice; it stays on its first request and
        //                 came off the other, which is now short
        //   'no-city'   — no MIND city: the whole request was removed
        //   'shortfall' — a server-picked request came up short and was removed
        // paid: true when payment was already taken, false when not.
        // An older entry has no kind: 'gone' when it names numbers,
        // otherwise its rate center fell short and was removed.
        const REJECTION_KINDS = ['gone', 'duplicate', 'no-city', 'shortfall'];

        function rejectionNumbers(p) {
            return (Array.isArray(p.numbers) ? p.numbers : []).map(tenDigits).filter(d => /^\d{10}$/.test(d));
        }

        function rejectionKind(p) {
            if (REJECTION_KINDS.includes(p.kind)) return p.kind;
            return rejectionNumbers(p).length ? 'gone' : 'legacy';
        }

        // Only gone numbers are dropped from the picks and never offered
        // again — a duplicate stays on its first request
        function readOrderRejection() {
            const rejection = getCookie('sip_orderRejection');
            if (!rejection) return null;
            deleteCookie('sip_orderRejection');
            try {
                const parsed = JSON.parse(rejection);
                const problems = Array.isArray(parsed) ? parsed.filter(p => p && typeof p === 'object') : [];
                if (!problems.length) return null;
                problems.filter(p => rejectionKind(p) === 'gone')
                    .forEach(p => rejectionNumbers(p).forEach(d => goneNumbers.add(d)));
                return problems;
            } catch (e) {
                return null;
            }
        }

        // What happened, then what the customer still has to do. Runs after
        // the trunks are normalized, so the guidance matches what is shown.
        function showOrderRejection(problems) {
            const where = p => (p.ratecenter || '?') + (p.npa ? ' (' + p.npa + ')' : '');
            const ofKind = kind => problems.filter(p => rejectionKind(p) === kind);
            const listNumbers = list => list.map(p => {
                const numbers = rejectionNumbers(p);
                return '• ' + where(p) + ': ' + (numbers.length ? numbers.map(formatPhone).join(', ') : 'one or more numbers');
            }).join('\n');
            const cities = list => [...new Set(list.map(where))];
            const parts = [];

            const gone = ofKind('gone');
            if (gone.length) {
                parts.push('Some of the numbers you picked are no longer available:\n' + listNumbers(gone));
            }
            const duplicate = ofKind('duplicate');
            if (duplicate.length) {
                parts.push('Each number can be ordered only once. These were picked more than once, '
                    + 'so each was kept only where you first picked it:\n' + listNumbers(duplicate));
            }
            const noCity = cities(ofKind('no-city'));
            if (noCity.length) {
                parts.push('Numbers in ' + noCity.join(', ') + ' can\'t be offered right now, so '
                    + (noCity.length === 1 ? 'that city was' : 'those cities were')
                    + ' removed from your order. Please choose another city below.');
            }
            // Older entries without numbers fell short the same way
            const short = cities(ofKind('shortfall').concat(ofKind('legacy')));
            if (short.length) {
                parts.push('We could not get numbers in ' + short.join(', ') + ' — '
                    + (short.length === 1 ? 'that rate center does' : 'those rate centers do')
                    + ' not have enough available numbers right now. Please choose a different city or area code below.');
            }

            // What is missing now: picks owed on a short request, or a trunk
            // left with no numbers at all
            const names = list => list.map(t => '"' + t.name + '"').join(', ');
            const shortTrunks = trunks.filter(trunkIsIncomplete);
            const emptyTrunks = trunks.filter(t => !(t.requests || []).length);
            if (shortTrunks.length) {
                parts.push('Use "Pick more" next to each city' + (trunks.length > 1 ? ' on ' + names(shortTrunks) : '')
                    + ' to pick replacements.');
            }
            if (emptyTrunks.length) {
                parts.push(names(emptyTrunks) + (emptyTrunks.length === 1 ? ' has' : ' have')
                    + ' no numbers now — choose a city and area code, then add numbers to '
                    + (emptyTrunks.length === 1 ? 'it' : 'each') + '.');
            }

            // Left out when the writer didn't say. Entries from before kinds
            // existed were only ever written after payment.
            const paid = problems.map(p => typeof p.paid === 'boolean' ? p.paid : (p.kind ? null : true))
                .filter(v => typeof v === 'boolean');
            if (paid.includes(true)) parts.push('Your payment is unaffected — you won\'t be charged again.');
            else if (paid.length) parts.push('You have not been charged.');

            const title = duplicate.length === problems.length ? 'Numbers picked twice' : 'Numbers unavailable';
            showAlert(parts.join('\n\n'), 'error', title);
        }

        function goBack() {
            if (isPorting) {
                window.location.href = 'siptrunkLOA.html';
            } else {
                window.location.href = 'numberSource.html';
            }
        }

        function saveAndContinue() {
            // Already ordered: nothing to save — follow the order instead
            if (orderLock) {
                window.location.href = 'provisioningStatus.html';
                return;
            }
            // Validate all trunks have requests
            for (const trunk of trunks) {
                if (!trunk.requests || trunk.requests.length === 0) {
                    showAlert('"' + trunk.name + '" has no numbers. Please pick at least one for each trunk.', 'info', 'Numbers needed');
                    switchTrunk(trunk.id);
                    return;
                }
            }
            // A short request still owes numbers — they must be picked first
            for (const trunk of trunks) {
                const r = trunk.requests.find(isRequestIncomplete);
                if (r) {
                    const short = requestWanted(r) - r.dids.length;
                    showAlert('"' + trunk.name + '" still needs ' + short + ' more number' + (short === 1 ? '' : 's') + ' in '
                        + r.ratecenter + ' (' + r.npa + '). Please pick ' + (short === 1 ? 'it' : 'them') + ' before continuing.',
                        'info', 'Numbers needed');
                    switchTrunk(trunk.id);
                    return;
                }
            }
            // Picked requests order exactly what was picked
            trunks.forEach(t => t.requests.forEach(r => {
                if (isPickedRequest(r)) r.quantity = r.dids.length;
            }));

            // Save multi-trunk data
            setCookie('sip_trunks', JSON.stringify(trunks));

            // The numbers on the trunks are only filled in when the DID order
            // completes — clear stale state from an earlier attempt so
            // downstream pages don't show numbers this order will not contain.
            deleteCookie('sip_selectedNumbers');
            deleteCookie('sip_primaryNumber');
            deleteCookie('sip_didOrderNumber');
            deleteCookie('sip_didOrderId');

            window.location.href = 'userAssignment.html';
        }

        // Initialize
        document.addEventListener('DOMContentLoaded', function() {
            loadUserInfoBar();
            startHoldTimer({ hasPicks: () => allPickedNumbers().length > 0, onPicker: true });
            isPorting = isPortingOrder();

            if (isPorting) {
                document.getElementById('tempNotice').style.display = 'block';
                document.getElementById('newNumbersInfo').style.display = 'none';
                document.getElementById('pageTitle').textContent = 'Pick Temporary Numbers';
                document.getElementById('pageSubtitle').textContent = 'Pick temporary numbers to test your service while your existing numbers are being ported.';
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

            // Already ordered (Back or "Edit" after submitting)? Then the
            // picks are shown but can't change — see lockedOut()
            const placed = getCookie('sip_didOrderNumber') || getCookie('sip_didOrderId');
            if (placed || trunks.some(t => (t.numbers || []).length)) {
                orderLock = { orderNumber: getCookie('sip_didOrderNumber') || null };
                refreshAll();
                loadCatalog();
                lockedOut();
                return;
            }

            // Sent back to replace numbers that became unavailable: note them
            // first so they are dropped from the picks and never offered again
            const rejection = readOrderRejection();
            normalizeTrunkRequests();

            // Open the first trunk that still owes picks, else one a
            // rejection left with no numbers
            const needy = trunks.find(trunkIsIncomplete) || trunks.find(t => !t.requests.length);
            if (needy) activeTrunkId = needy.id;

            refreshAll();
            loadPickerConfig();
            loadCatalog().then(() => {
                // Point the picker at the first request still owing numbers
                const trunk = getActiveTrunk();
                const r = trunk && trunk.requests.find(isRequestIncomplete);
                if (r && catalogLoaded && !picker && !document.getElementById('rateCenterFilter').value.trim()) {
                    prefillPicker(r.ratecenter, r.npa, requestWanted(r) - r.dids.length);
                }
            });

            if (rejection) showOrderRejection(rejection);
        });
