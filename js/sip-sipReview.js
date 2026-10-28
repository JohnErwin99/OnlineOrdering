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

        // UBoss config / formatToE164 / describeApiError now live
        // in sip-provisioning-common.js, shared with provisioningStatus.html.

        // Text from cookies or the server going into innerHTML
        function escapeHtml(value) {
            return String(value == null ? '' : value).replace(/[&<>"']/g, c =>
                ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
        }

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
                            `<span class="number-chip">${escapeHtml(n)}</span>`
                        ).join('');
                    } catch (e) {}
                }

                // Port request (PON) details collected on the port-in page
                let ponData = null;
                try { ponData = JSON.parse(getCookie('sip_ponData') || 'null'); } catch (e) {}
                if (ponData) {
                    setText('revPonEndUser', ponData.end_user_name);
                    setText('revPonAccount', ponData.existing_account_number);
                    setText('revPonAuthDate', ponData.auth_date);
                    setText('revPonDueDate', ponData.desired_due_date);
                    const addr = [ponData.house_number, ponData.street_name, ponData.street_type].filter(Boolean).join(' ');
                    setText('revPonAddress', [addr, ponData.city, ponData.province_state, ponData.zip_code].filter(Boolean).join(', '));
                }
            }

            // Selected Numbers — multi-trunk aware
            const trunksData = getCookie('sip_trunks');
            if (trunksData) {
                try {
                    const trunksList = JSON.parse(trunksData);
                    if (Array.isArray(trunksList) && trunksList.length > 0) {
                        const chip = (n, main) => main
                            ? `<span class="number-chip pilot">${escapeHtml(n)} (Main)</span>`
                            : `<span class="number-chip">${escapeHtml(n)}</span>`;
                        document.getElementById('revSelectedNumbers').innerHTML = trunksList.map(trunk => {
                            // Delivered numbers when they exist; otherwise the
                            // numbers the customer picked (the first is the
                            // main one), and the rate-center request for
                            // anything the server will pick
                            let chips;
                            if (trunk.numbers && trunk.numbers.length > 0) {
                                chips = trunk.numbers.map(n => chip(n, n === trunk.primaryNumber)).join('');
                            } else {
                                const main = trunkFirstPick(trunk);
                                let serverPicks = false;
                                chips = (trunk.requests || []).map(r => {
                                    if (requestPickComplete(r)) {
                                        return r.dids.map(n => chip(n, tenDigits(n) === main)).join('');
                                    }
                                    // Short of its quantity — the page sends the
                                    // customer back to finish picking
                                    if (Array.isArray(r.dids)) {
                                        const short = (parseInt(r.quantity, 10) || 0) - r.dids.length;
                                        return r.dids.map(n => chip(n, tenDigits(n) === main)).join('')
                                            + `<span class="number-chip">${escapeHtml(r.ratecenter)} (${escapeHtml(r.npa)}): ${short} more to pick</span>`;
                                    }
                                    serverPicks = true;
                                    return `<span class="number-chip">${escapeHtml(r.ratecenter)} (${escapeHtml(r.npa)}) &times; ${escapeHtml(r.quantity)}</span>`;
                                }).join('') || '<span class="number-chip">No numbers requested</span>';
                                if (serverPicks) {
                                    chips += '<div style="font-size:12px;color:var(--text-gray);margin-top:6px;">Numbers are assigned when your order is processed.</div>';
                                }
                            }
                            return `<div style="margin-bottom:12px;"><strong style="font-size:13px;color:#004a9f;">${escapeHtml(trunk.name)}</strong><div style="margin-top:6px;">${chips}</div></div>`;
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
                                    ? `<span class="number-chip pilot">${escapeHtml(n)} (Main)</span>`
                                    : `<span class="number-chip">${escapeHtml(n)}</span>`
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
                                <td>${escapeHtml(user.firstName)} ${escapeHtml(user.lastName)}${isPilot ? '<span class="pilot-badge">Pilot User</span>' : ''}</td>
                                <td style="font-family: 'Courier New', monospace;">${escapeHtml(user.number || '--')}</td>
                                <td>${escapeHtml(packageNames[user.package] || user.package)}</td>
                            </tr>`;
                        }).join('');
                    }
                } catch (e) {}
            }
        }

        function updateSubmitButton() {
            document.getElementById('submitBtn').disabled = !document.getElementById('agreeTerms').checked
                || didOrderingBlocked || returningToPicker;
        }

        // ============================================
        // NUMBER ORDERING — readiness and refusals
        // The customer picked specific numbers. Before the card is charged
        // the server re-checks them (read-only), and the order checks them
        // again; numbers that are gone send the customer back to pick
        // replacements. Nothing taken is ever bought.
        // ============================================
        const DID_UNAVAILABLE_COPY = 'Number ordering is temporarily unavailable — please try again in a few minutes.';
        const PAYMENT_UNAFFECTED = ' Your payment is unaffected and you won’t be charged again.';
        const NOT_CHARGED = ' Your card has not been charged.';

        // Set while espresso can't take orders: paying or submitting would
        // charge for numbers we can't buy. Re-checked every minute so the
        // page unblocks itself once ordering is back.
        let didOrderingBlocked = false;
        let didReadyTimer = null;
        // Set once the customer is on their way back to number selection
        let returningToPicker = false;
        // A balance charge is under way — its button must not be re-enabled
        let chargeInFlight = false;
        // What the charge button says while a charge is under way, so a
        // re-render (each promo keystroke re-prices) keeps it
        let chargeButtonLabel = '';

        // The charge button is rebuilt whenever the price is, so it is looked
        // up fresh each time — one held across an await may be a detached
        // node. A null argument leaves that property alone.
        function updateChargeButton(label, disabled, background) {
            if (label != null) chargeButtonLabel = label;
            const btn = document.getElementById('chargeBalanceBtn');
            if (!btn) return;
            if (label != null) btn.textContent = label;
            if (disabled != null) btn.disabled = disabled;
            if (background != null) btn.style.background = background;
        }

        function chargeLabel(amount) {
            return `Charge $${amount.toFixed(2)} to card on file`;
        }

        // Does submitting this order still buy numbers? Not when an earlier
        // submit already placed the order, nor for a porting order with no
        // number requests.
        function orderBuysNumbers() {
            if (getCookie('sip_didOrderId') || getCookie('sip_didOrderNumber')) return false;
            const trunksList = loadTrunksFromCookie();
            return trunksNeedNumbers(trunksList) && orderRequestSlots(trunksList).length > 0;
        }

        // Placed by an earlier submit — the trunks then describe that order
        function orderAlreadyPlaced() {
            return !!(getCookie('sip_didOrderId') || getCookie('sip_didOrderNumber'));
        }

        function alreadyPaid() {
            return parseFloat(getCookie('iristel_payment_amount') || '0') > 0;
        }

        // What a refusal outside the charge says about money: a payment
        // already taken stands and isn't repeated
        function paymentNote() {
            return alreadyPaid() ? PAYMENT_UNAFFECTED : NOT_CHARGED;
        }

        // One notice above the Submit button for ordering problems — created
        // on first use, removed when the message is empty
        function showOrderNotice(message) {
            let el = document.getElementById('orderNotice');
            if (!message) {
                if (el) el.remove();
                return;
            }
            if (!el) {
                el = document.createElement('div');
                el.id = 'orderNotice';
                el.style.cssText = 'background:rgba(239,68,68,0.06);border-left:4px solid #EF4444;padding:12px 16px;' +
                    'border-radius:0 4px 4px 0;margin:16px 0;font-size:13px;line-height:1.5;color:var(--rich-black);';
                const nav = document.querySelector('.nav-buttons');
                nav.parentNode.insertBefore(el, nav);
            }
            el.textContent = message;
        }

        function setDidOrderingBlocked(blocked) {
            if (blocked && !didReadyTimer) didReadyTimer = setInterval(checkDidOrderingReady, 60000);
            if (!blocked && didReadyTimer) {
                clearInterval(didReadyTimer);
                didReadyTimer = null;
            }
            if (blocked === didOrderingBlocked) return;
            didOrderingBlocked = blocked;

            showOrderNotice(blocked
                ? DID_UNAVAILABLE_COPY + ' Payment and submission are paused until it is back, so you are never charged for numbers we can’t order.'
                : '');
            if (!chargeInFlight) updateChargeButton(null, blocked || returningToPicker);
            const chargeNote = document.getElementById('chargeBlockedNote');
            if (chargeNote) chargeNote.style.display = blocked ? 'block' : 'none';
            updateSubmitButton();
            if (blocked) {
                console.warn('[order] espresso is not ready for DID orders — payment and submit paused');
                if (window.IrisBridge) window.IrisBridge.error(DID_UNAVAILABLE_COPY);
            } else {
                console.log('[order] number ordering is available again');
            }
        }

        async function checkDidOrderingReady() {
            if (!orderBuysNumbers()) {
                setDidOrderingBlocked(false);
                return;
            }
            try {
                const r = await fetch('/api/config');
                if (!r.ok) return;
                const cfg = await r.json();
                setDidOrderingBlocked(cfg.didReady === false);
            } catch (e) {
                // Can't tell — leave it be: the order itself refuses safely
                console.warn('Ordering readiness check failed:', e.message);
            }
        }

        // Tell the customer, then take them back to number selection. The
        // picker repeats the details from sip_orderRejection, so the wait
        // here is short.
        function returnToNumberSelection(message, title) {
            returningToPicker = true;
            updateSubmitButton();
            updateChargeButton('Returning to number selection...', true);
            showAlert(message + ' Taking you back to number selection…', 'error', title);
            if (window.IrisBridge) window.IrisBridge.error(message);
            setTimeout(() => { window.location.href = 'numberSelection.html'; }, 3500);
        }

        // A picked request short of its quantity can't be ordered: sent as a
        // bare quantity, the server would pick random numbers and drop the
        // customer's own. It gets here by Back, a reload while the page was
        // on its way to the picker, or the status page's "Go to Review".
        // Nothing is charged or ordered — the customer goes back to finish
        // picking (the picker shows what each request still needs). Returns
        // true when they were sent back.
        function sendBackIfPicksIncomplete(trunksList, note) {
            const incomplete = findIncompletePicks(trunksList);
            // A trunk whose only request was dropped (no city, not enough
            // numbers) would be billed for its channels and never provisioned
            const empty = trunksList.filter(t => !(t.requests || []).length && !(t.numbers || []).length);
            if (!incomplete.length && !empty.length) return false;
            console.warn('[order] picks incomplete — back to number selection:', JSON.stringify(incomplete),
                empty.length ? '| trunks without numbers: ' + empty.map(t => t.name).join(', ') : '');
            const owed = incomplete.map(x => {
                const short = x.quantity - x.picked;
                return '"' + x.trunkName + '" still needs ' + short + ' more number' + (short === 1 ? '' : 's')
                    + ' in ' + x.ratecenter + ' (' + x.npa + ')';
            }).concat(empty.map(t => '"' + (t.name || 'A trunk') + '" has no numbers yet'));
            returnToNumberSelection(owed.join('; ') + '. Please finish picking before ordering — no numbers have been ordered.'
                + (note || ''), 'Numbers still to pick');
            return true;
        }

        function listNumbers(numbers) {
            return numbers.length === 1 ? 'The number ' + numbers[0] + ' is'
                : 'The numbers ' + numbers.slice(0, -1).join(', ') + ' and ' + numbers[numbers.length - 1] + ' are';
        }

        // Picked numbers that can't be had any more come off their requests —
        // the quantity stays, so the picker asks for replacements — and the
        // picker learns which through sip_orderRejection. A server-picked
        // request that came up short is dropped, as before, so the customer
        // chooses another city. A number picked twice stays on its first
        // request, once, and comes off the rest. Every entry carries its
        // kind and whether payment was already taken (`paid`).
        function sendBackToPickNumbers(trunksList, unavailable, shortfalls, paid, duplicateNumber) {
            const rejection = [];
            const gonePicked = [];
            const gone = (unavailable || []).map(u => tenDigits(u && u.number)).filter(Boolean);
            if (gone.length) {
                removePicksFromTrunks(trunksList, gone).forEach(x => {
                    gonePicked.push(...x.numbers);
                    rejection.push(Object.assign(x, { reason: 'No longer available', kind: 'gone', paid: !!paid }));
                });
            }

            const dup = duplicateNumber ? tenDigits(duplicateNumber) : '';
            if (dup) {
                const holders = [];
                orderRequestSlots(trunksList).forEach((s, i) => {
                    if ((s.source.dids || []).some(n => tenDigits(n) === dup)) holders.push({ s, i });
                });
                holders.forEach(({ s, i }, h) => {
                    const r = s.source;
                    if (h > 0) {
                        removePicksFromTrunks(trunksList, [dup], i).forEach(x =>
                            rejection.push(Object.assign(x, { reason: 'Picked more than once', kind: 'duplicate', paid: !!paid })));
                        return;
                    }
                    // The first request keeps it — once, if it holds it twice
                    const keep = r.dids.findIndex(n => tenDigits(n) === dup);
                    const before = r.dids.length;
                    r.dids = r.dids.filter((n, j) => j === keep || tenDigits(n) !== dup);
                    if (r.dids.length < before) {
                        rejection.push({ ratecenter: r.ratecenter, npa: r.npa, numbers: [dup],
                            reason: 'Picked more than once', kind: 'duplicate', paid: !!paid });
                    }
                });
            }

            const slots = orderRequestSlots(trunksList);
            const shortRequests = new Set();
            const shortCities = [];
            (shortfalls || []).forEach(s => {
                const slot = slots[s.index];
                if (!slot) return;
                shortRequests.add(slot.source);
                shortCities.push((s.ratecenter || slot.source.ratecenter) + ' (' + (s.npa || slot.source.npa) + ')');
                rejection.push({
                    ratecenter: s.ratecenter || slot.source.ratecenter, npa: s.npa || slot.source.npa, numbers: [],
                    reason: 'Only ' + (s.found || 0) + ' of ' + s.wanted + ' numbers available', kind: 'shortfall', paid: !!paid
                });
            });
            if (shortRequests.size) {
                trunksList.forEach(t => { t.requests = (t.requests || []).filter(r => !shortRequests.has(r)); });
            }
            setCookie('sip_trunks', JSON.stringify(trunksList));
            if (rejection.length) setCookie('sip_orderRejection', JSON.stringify(rejection));
            console.warn('[order] picked numbers unavailable — back to number selection:', JSON.stringify(rejection));

            let message = '';
            if (gonePicked.length) message += listNumbers(gonePicked) + ' no longer available. ';
            if (dup) message += dup + ' was picked more than once. ';
            if (shortCities.length) message += 'There aren’t enough numbers available in ' + shortCities.join(', ') + '. ';
            if (!message) message = 'Some of the numbers for this order are no longer available. ';
            message += (shortCities.length && !gonePicked.length && !dup
                ? 'Please choose another city.' : 'Please pick replacements.')
                + (paid ? PAYMENT_UNAFFECTED : NOT_CHARGED);
            returnToNumberSelection(message, 'Numbers no longer available');
        }

        // MIND has no city for a request's rate center, so no number there
        // can be stored and none can be offered. The request the server
        // names (index = position in orderRequestSlots) comes off its trunk,
        // with any other for the same rate center and area code — they'd be
        // refused the same way — and the picker asks for another city.
        function sendBackForNoCity(trunksList, data, paid) {
            const d = data || {};
            const slots = orderRequestSlots(trunksList);
            const slot = d.index != null ? slots[Number(d.index)] : null;
            const ratecenter = String(d.ratecenter || (slot && slot.source.ratecenter) || '').trim();
            const npa = String(d.npa || (slot && slot.source.npa) || '');
            const sameCity = r => String(r.ratecenter || '').trim().toUpperCase() === ratecenter.toUpperCase()
                && String(r.npa) === npa;
            // The indexed request, unless the trunks changed under it
            const named = slot && (!d.ratecenter || sameCity(slot.source)) ? slot.source : null;
            const drop = new Set(slots.map(s => s.source).filter(r => r === named || (ratecenter && sameCity(r))));

            // Its picks come off first, so a main number among them falls
            // back to the trunk's next pick
            const lost = [...drop].flatMap(r => (Array.isArray(r.dids) ? r.dids : []).map(tenDigits));
            if (lost.length) removePicksFromTrunks(trunksList, lost);
            trunksList.forEach(t => { t.requests = (t.requests || []).filter(r => !drop.has(r)); });
            setCookie('sip_trunks', JSON.stringify(trunksList));

            const where = ratecenter ? ratecenter + (npa ? ' (' + npa + ')' : '') : 'one of the cities you chose';
            if (ratecenter) {
                setCookie('sip_orderRejection', JSON.stringify([{
                    ratecenter, npa, numbers: lost, reason: 'Numbers in ' + where + ' can’t be offered right now',
                    kind: 'no-city', paid: !!paid
                }]));
            }
            console.warn('[order] no MIND city for', where, '— removed', drop.size, 'request(s):', d.error);
            returnToNumberSelection('Numbers in ' + where + ' can’t be offered right now' +
                (drop.size ? ', so that city has been taken off your order' : '') + '. Please choose another city.'
                + (paid ? PAYMENT_UNAFFECTED : NOT_CHARGED), 'Please choose another city');
        }

        // The customer's own order is still going (e.g. they came back and
        // changed their picks after it was placed): nothing new is ordered —
        // the trunks go back to that order's snapshot and the status page
        // follows it.
        async function followOrderInProgress(data, note) {
            returningToPicker = true;
            updateSubmitButton();
            updateChargeButton(null, true);
            const message = 'Number order ' + data.orderNumber + ' is already in progress for your account, '
                + 'so your numbers can’t be changed now.' + note + ' Taking you to its status…';
            showAlert(message, 'info', 'Order already in progress');
            if (window.IrisBridge) window.IrisBridge.error(message);
            const session = await fetchServerSession(customerEmail(getProvisioningContactData()));
            const order = session && session.order;
            if (order && order.orderNumber === data.orderNumber && Array.isArray(order.trunks) && order.trunks.length) {
                setCookie('sip_trunks', JSON.stringify(order.trunks));
            }
            if (data.orderId) setCookie('sip_didOrderId', data.orderId);
            else deleteCookie('sip_didOrderId');
            setCookie('sip_didOrderNumber', data.orderNumber);
            setTimeout(() => { window.location.href = 'provisioningStatus.html'; }, 3500);
        }

        // The number order — or its check before payment — was refused.
        // Handles what the customer can act on (or wait out) and returns
        // true; anything else returns false for the caller to report.
        // `paid`: the card was already charged, so say it is unaffected.
        function handleNumberOrderRefusal(status, data, trunksList, paid) {
            const code = data && data.code;
            const note = paid ? PAYMENT_UNAFFECTED : NOT_CHARGED;
            if (code === 'NUMBERS_UNAVAILABLE') {
                sendBackToPickNumbers(trunksList, data.unavailable, data.shortfalls, paid);
                return true;
            }
            // The server orders only picked numbers right now: a request
            // saved without picks (an older page) is turned into one still
            // to pick, and the customer goes back to the picker for it
            if (code === 'PICK_REQUIRED') {
                orderRequestSlots(trunksList).forEach(s => {
                    if (!Array.isArray(s.source.dids)) s.source.dids = [];
                });
                setCookie('sip_trunks', JSON.stringify(trunksList));
                if (!sendBackIfPicksIncomplete(trunksList, note)) {
                    returnToNumberSelection('Please pick your numbers before ordering.' + note, 'Numbers still to pick');
                }
                return true;
            }
            if (code === 'DUPLICATE_PICK') {
                sendBackToPickNumbers(trunksList, [], [], paid, data.number);
                return true;
            }
            if (code === 'NO_MIND_CITY') {
                sendBackForNoCity(trunksList, data, paid);
                return true;
            }
            // From the check before payment too: the card is not charged
            // while another order is still going
            if (code === 'ORDER_IN_PROGRESS') {
                if (data.orderNumber) {
                    followOrderInProgress(data, note);
                    return true;
                }
                const message = 'A number order is already in progress for your account, so another one can’t be placed yet. ' +
                    'Please wait a few minutes before trying again, or contact support.' + note;
                showAlert(message, 'info', 'Order already in progress');
                if (window.IrisBridge) window.IrisBridge.error(message);
                return true;
            }
            if (status === 503) {
                // ESPRESSO_BUSY, INVENTORY_FORBIDDEN, MIND_UNAVAILABLE, ...
                console.warn('[order] number ordering unavailable:', code, data && data.error);
                const message = (paid ? DID_UNAVAILABLE_COPY
                    : 'We couldn’t confirm your numbers are still available — please try again shortly.') + note;
                showAlert(message, 'error', 'Please try again shortly');
                if (window.IrisBridge) window.IrisBridge.error(message);
                return true;
            }
            return false;
        }

        // Before the card is charged: are the picked numbers still free?
        // Read-only on the server. Resolves true when the charge may go
        // ahead; otherwise the customer has been told why (and maybe sent
        // back to pick) and nothing is charged.
        async function checkPicksBeforeCharge() {
            const trunksList = loadTrunksFromCookie();
            // A top-up after an earlier payment: that payment stands
            const paid = alreadyPaid();
            if (!orderAlreadyPlaced() && sendBackIfPicksIncomplete(trunksList, paymentNote())) return false;
            if (!orderBuysNumbers()) return true;
            let response = null;
            let data = null;
            try {
                response = await fetch('/api/did/check-picks', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        email: customerEmail(getProvisioningContactData()),
                        requests: flattenOrderRequests(trunksList)
                    })
                });
                data = await response.json().catch(() => null);
            } catch (e) {
                console.error('Number check failed to send:', e.message);
            }

            if (response && response.ok && data) {
                // Already ordered by an earlier submit — the order step re-uses it
                if (data.orderNumber) {
                    console.log('Numbers already ordered as', data.orderNumber, '— charging');
                    return true;
                }
                if (data.ok) return true;
                if ((data.unavailable || []).length) {
                    sendBackToPickNumbers(trunksList, data.unavailable, [], paid);
                    return false;
                }
            }
            // 409 ORDER_IN_PROGRESS (another order still going), 422
            // NO_MIND_CITY, 400 DUPLICATE_PICK, 503 — all before payment
            if (!handleNumberOrderRefusal(response ? response.status : 503, data, trunksList, paid)) {
                const message = 'We couldn’t check your numbers: ' + ((data && data.error) || ('HTTP ' + (response ? response.status : '?')))
                    + '.' + NOT_CHARGED;
                showAlert(message, 'error', 'Number check failed');
                if (window.IrisBridge) window.IrisBridge.error(message);
            }
            return false;
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
        // The payment key is deliberately NOT here — charges go through
        // /api/payment/charge so the credential never reaches the browser.

        // ============================================
        // TRUNK (Broadworks) API Configuration — DEPRECATED
        // Replaced by UbossRobot API below
        // ============================================
        // const TRUNK_API_URL = 'http://100.67.14.26:8099/api/trunk/provision';
        // const TRUNK_API_KEY = '3c901f55e7864d2aae31b08c9746f9132d8847f1acb94c65b0897e3624f1edc6';

        // ============================================
        // Payment Status (already collected before business setup)
        // ============================================
        // Pricing constants live in sip-provisioning-common.js (SIP_PRICING)

        // ============================================
        // PROMO CODE
        // Entered on this page because this is where the card is charged. It
        // discounts the balance down to $0.01 — NOT to zero: the remaining
        // cent still has to be charged to the card before submitting, so
        // every promo order exercises the real payment path end to end.
        // ============================================
        const PROMO_CHARGE = 0.01;
        function getAppliedPromo() {
            return getCookie('iristel_promo_code') === 'TEST' ? 'TEST' : null;
        }

        function applyPromo() {
            const code = (document.getElementById('promoCode').value || '').trim().toUpperCase();
            const msg = document.getElementById('promoMessage');

            if (code === 'TEST') {
                setCookie('iristel_promo_code', 'TEST');
                msg.textContent = 'Promo applied — $0.01 card verification charge';
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
                    ? `$0.01 verification charge due — promo ${promo} applied`
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
                            // Channels (capacity) and numbers (DIDs) are billed
                            // independently — channels are user-chosen, DIDs
                            // are the actual requested quantity.
                            // Same rule UBoss and MIND's quantities use
                            const { channels, dids: numbers, monthly: trunkCost } = getTrunkBilling(trunk);

                            rows += `<tr>
                                <td class="pricing-trunk-label">${escapeHtml(trunk.name)}</td>
                                <td style="text-align:center;">${channels} ch / ${numbers} DID${numbers === 1 ? '' : 's'}</td>
                                <td style="text-align:right;">$${SIP_PRICING.CHANNEL_MONTHLY.toFixed(2)}/ch + $${SIP_PRICING.DID_MONTHLY.toFixed(2)}/DID</td>
                                <td style="text-align:right;">$${trunkCost.toFixed(2)}</td>
                            </tr>`;

                            totalMonthly += trunkCost;
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
                const channelCost = channels * SIP_PRICING.CHANNEL_MONTHLY;

                rows = `<tr>
                    <td class="pricing-trunk-label">SIP Trunk</td>
                    <td style="text-align:center;">${channels} ch</td>
                    <td style="text-align:right;">$${SIP_PRICING.CHANNEL_MONTHLY.toFixed(2)}/ch/mo</td>
                    <td style="text-align:right;">$${channelCost.toFixed(2)}</td>
                </tr>`;

                totalMonthly = channelCost;
            }

            body.innerHTML = rows;
            document.getElementById('pricingTotal').textContent = '$' + totalMonthly.toFixed(2) + '/mo';

            // Calculate remaining balance vs the promo and what was already paid
            const paidAmount = parseFloat(getCookie('iristel_payment_amount') || '0');
            const promo = getAppliedPromo();
            const tax = +(totalMonthly * SIP_PRICING.TAX_RATE).toFixed(2);
            const totalWithTax = +(totalMonthly + tax).toFixed(2);
            // The promo leaves one cent to charge — the card must still be
            // exercised for real before the order can be submitted.
            const promoDiscount = promo ? Math.max(0, +(totalWithTax - PROMO_CHARGE).toFixed(2)) : 0;
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
                    // Held while number ordering is down (setDidOrderingBlocked),
                    // and while a charge is already under way — this re-renders
                    // on every promo keystroke, mid-charge included
                    const label = returningToPicker ? 'Returning to number selection...'
                        : (chargeInFlight && chargeButtonLabel) || chargeLabel(remaining);
                    footerRows += `
                    <tr>
                        <td colspan="4" style="text-align:right;padding-top:12px;">
                            <button class="btn-edit" id="chargeBalanceBtn" onclick="chargeRemainingBalance(${remaining})" style="background:var(--tufts-blue);color:#fff;padding:8px 20px;"${didOrderingBlocked || returningToPicker || chargeInFlight ? ' disabled' : ''}>
                                ${escapeHtml(label)}
                            </button>
                            <div id="chargeBlockedNote" style="display:${didOrderingBlocked ? 'block' : 'none'};font-size:12px;color:#EF4444;margin-top:6px;">
                                ${DID_UNAVAILABLE_COPY}
                            </div>
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
        let unreconciledCharge = null;

        function unknownOutcome(detail) {
            const err = new Error(detail);
            err.outcomeUnknown = true;
            return err;
        }

        // Charge remaining balance using saved card token. The button is
        // re-rendered while this awaits, so it is only ever reached through
        // updateChargeButton.
        async function chargeRemainingBalance(amount) {
            // One charge at a time, however many buttons were clicked
            if (chargeInFlight) return;
            const token = getCookie('iristel_payment_token');
            const accountCode = getCookie('iristel_account_id') || '1204506';

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

            if (didOrderingBlocked) {
                showAlert(DID_UNAVAILABLE_COPY + NOT_CHARGED, 'info', 'Please try again shortly');
                return;
            }

            chargeInFlight = true;

            // Numbers first: the card is never charged for picks that are
            // already gone, or while ordering is down
            updateChargeButton('Checking your numbers...', true);
            let picksOk = false;
            try {
                picksOk = await checkPicksBeforeCharge();
            } catch (err) {
                console.error('Number check before payment failed:', err);
                showAlert('We couldn’t check your numbers — please try again shortly.' + NOT_CHARGED, 'error', 'Please try again shortly');
            }
            if (!picksOk) {
                chargeInFlight = false;
                // The button may since show a re-priced balance
                if (!returningToPicker) updateChargeButton(chargeLabel(window._remainingBalance || amount), didOrderingBlocked);
                return;
            }

            updateChargeButton('Processing...');

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
                        holder: getCookie('iristel_payment_card_holder') || '',
                        securityCode: getCookie('iristel_payment_card_cvv') || ''
                    },
                    reference: reference
                };

                // Charged through our server, not straight to the billing API: it
                // de-duplicates the charge, keeps the payment key off the client,
                // and can read the real HTTP status (a gateway 502 reaches the
                // browser without CORS headers, so from here it was unreadable).
                console.log('[CHARGE BALANCE] POST /api/payment/charge');

                let response;
                try {
                    response = await fetch('/api/payment/charge', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            accountCode: accountCode,
                            amount: amount.toFixed(2),
                            creditCard: requestBody.creditCard,
                            // What was paid before is part of the key: a later
                            // top-up of the same amount is a new charge, not
                            // a repeat of the first one
                            idempotencyKey: accountCode + '::'
                                + parseFloat(getCookie('iristel_payment_amount') || '0').toFixed(2) + '::' + amount.toFixed(2),
                            // Lets the server tell a duplicate from a genuine
                            // second purchase: once an order is provisioned the
                            // guard is released, so buying again is charged.
                            email: customerEmail(getContactDataFromCookies())
                        })
                    });
                } catch (networkErr) {
                    // Our own server is unreachable — the charge never left here
                    throw new Error('Could not reach the payment service: ' + networkErr.message);
                }

                const data = await response.json().catch(() => null);

                if (!response.ok) {
                    // 502 = the server tried but could not learn the outcome, so the
                    // card may have been charged. 409 = a previous attempt already
                    // ended that way. Both must not be retried.
                    if (response.status === 502 || response.status === 409) {
                        throw unknownOutcome((data && data.error) || `HTTP ${response.status}`);
                    }
                    throw new Error((data && data.error) || `Payment failed (HTTP ${response.status})`);
                }

                if (data && data.duplicate) {
                    console.log('Balance already charged under reference', data.reference, '— not charged again');
                }

                // Update the paid amount cookie
                const previousPaid = parseFloat(getCookie('iristel_payment_amount') || '0');
                const newTotal = +(previousPaid + amount).toFixed(2);
                setCookie('iristel_payment_amount', newTotal.toString());
                setCookie('iristel_payment_reference_balance', reference);

                if (window.IrisBridge) window.IrisBridge.paymentSuccess(reference, amount.toFixed(2));

                // Update UI
                updateChargeButton('Charged successfully', null, 'var(--success-green)');
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

                updateChargeButton(chargeLabel(window._remainingBalance || amount), didOrderingBlocked || returningToPicker, '');
                showAlert(err.message, 'error', 'Payment failed');
                if (window.IrisBridge) window.IrisBridge.paymentFailed(err.message);
            } finally {
                chargeInFlight = false;
            }
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
            submitBtn.disabled = didOrderingBlocked || returningToPicker;
            submitBtn.innerHTML = `
                <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg>
                Submit Order
            `;
        }

        // ============================================
        // STEP 1: Create business account in MIND
        // ============================================
        // Created through our server so it is guarded by email: a customer
        // returning on another device would otherwise sign up again, get a
        // second MIND account, and — because the order guard keys off the
        // account — be billed for a second set of numbers.
        async function createMindAccount(contactData, knownAccountId) {
            console.log('[STEP 1] Create account — POST /api/account');
            const response = await fetch('/api/account', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: customerEmail(contactData),
                    contact: { ...contactData, language: getCookie('iristel_user_language') || 'en' },
                    // Hand over an id the browser already has so the server can
                    // record the mapping instead of creating a second account
                    accountId: knownAccountId || undefined
                })
            });

            const data = await response.json().catch(() => null);
            console.log('Create Account Response:', data);

            if (!response.ok || !data || !data.accountId) {
                throw new Error((data && data.error) || `Account creation failed (HTTP ${response.status})`);
            }
            if (data.reused) console.log('Existing account reused — no duplicate created');
            return data.accountId;
        }

        // ============================================
        // STEP 3b: Submit the porting request (PON) via the LNP API
        // ============================================
        // Creation is quick; the STATUS page owns tracking it afterwards.
        // The email is what every server-side guard keys on — it is the only
        // identifier that survives a new device or a cleared browser.
        function customerEmail(contactData) {
            return (contactData && contactData.emailAddress)
                || getCookie('sip_billingEmail')
                || getCookie('iristel_user_email')
                || '';
        }

        // sip_ponNumber makes this idempotent across submit retries.
        async function submitPortRequest() {
            const existing = getCookie('sip_ponNumber');
            if (existing) {
                console.log('Re-using existing PON:', existing);
                return existing;
            }

            let ponData = null;
            try { ponData = JSON.parse(getCookie('sip_ponData') || 'null'); } catch (e) {}
            if (!ponData || !Array.isArray(ponData.numbers) || !ponData.numbers.length) {
                throw new Error('Port request details are missing. Please go back to the Port Request step and fill them in.');
            }

            // Defensive: a ponData cookie saved before the zip fix may carry a
            // lowercase/no-space code, which the carrier rejects outright
            // ("12: ZIP Code is invalid"). Normalize to "A1A 1A1" here too.
            if (ponData.zip_code) {
                const z = String(ponData.zip_code).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
                ponData.zip_code = z.length > 3 ? z.slice(0, 3) + ' ' + z.slice(3) : z;
            }

            console.log('[STEP 3b] LNP Create PON — POST /api/lnp/pon');
            const response = await fetch('/api/lnp/pon', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...ponData, email: customerEmail(getContactDataFromCookies()) })
            });
            const data = await response.json().catch(() => null);
            console.log('LNP Create PON Response:', data);
            if (!response.ok || !data || !data.pon) {
                throw new Error('Port request failed: ' + ((data && data.error) || ('HTTP ' + response.status)));
            }

            setCookie('sip_ponNumber', data.pon);
            return data.pon;
        }

        // ============================================
        // SUBMIT ORDER
        // (Payment already collected before business setup)
        // 1. Create business account in MIND
        // 2. Record the SIP Trunk service (already assigned at plan selection)
        // 3. Place the espresso DID order for the (temporary) numbers — do NOT
        //    wait for it here; the status page polls it, distributes the numbers
        //    and starts UBoss provisioning once they arrive
        // 3b. Porting orders: create the PON via the LNP API
        // Then redirect to provisioningStatus.html, where the customer waits.
        // ============================================
        async function submitOrder() {
            if (!document.getElementById('agreeTerms').checked) {
                showAlert('Please agree to the Terms of Service before submitting.', 'info', 'Almost there');
                if (window.IrisBridge) window.IrisBridge.error('Please agree to the Terms of Service before submitting.', 'agreeTerms');
                return;
            }

            // Verify card was saved. A promo zeroes the CHARGE, never the card
            // requirement — every order must have a payment method on file,
            // even when $0 is charged.
            if (!getCookie('iristel_payment_token')) {
                showAlert('No payment card on file. Please go back and save a card first.', 'error', 'No card on file');
                if (window.IrisBridge) window.IrisBridge.error('No payment card on file. Please go back and save a card first.');
                return;
            }

            if (returningToPicker) return;
            // Picks left short (Back, a reload, "Go to Review") go back to
            // the picker — never out as a quantity for the server to fill
            if (!orderAlreadyPlaced() && sendBackIfPicksIncomplete(loadTrunksFromCookie(), paymentNote())) return;
            if (didOrderingBlocked && orderBuysNumbers()) {
                showAlert(DID_UNAVAILABLE_COPY, 'info', 'Please try again shortly');
                if (window.IrisBridge) window.IrisBridge.error(DID_UNAVAILABLE_COPY);
                return;
            }

            const submitBtn = document.getElementById('submitBtn');
            submitBtn.disabled = true;

            const contactData = getProvisioningContactData();

            // Get primary number
            const savedPrimary = getCookie('sip_primaryNumber') || getCookie('sip_billingPhone') || '';
            const primaryNumber = savedPrimary ? formatToE164(savedPrimary) : '';

            // The status page renders steps 1 and 2 from these — never assume success
            clearOrderStepResults();

            try {
                // ---- STEP 1: Create MIND Account ----
                let accountId = getCookie('iristel_account_id');

                try {
                    // Always go through the server, even when the browser
                    // already knows the account. Skipping the call meant the
                    // email-to-account mapping was never recorded, so a resume
                    // on a fresh browser showed the account step as pending
                    // work that had in fact been done long ago.
                    const hadAccount = !!accountId;
                    updateStatusMessage(hadAccount ? 'Checking your account...' : 'Creating account...');
                    accountId = await createMindAccount(contactData, accountId);
                    setCookie('iristel_account_id', accountId);
                    console.log(hadAccount ? 'Using existing MIND account:' : 'MIND Account created:', accountId);
                    setOrderStepResult('account', 'done', hadAccount
                        ? 'Using existing account ' + accountId
                        : 'Business account ' + accountId + ' created');
                } catch (err) {
                    setOrderStepResult('account', 'error', err.message);
                    throw err;
                }

                // Check remaining balance BEFORE creating anything else —
                // the service is only minted once payment has settled.
                if (window._remainingBalance > 0) {
                    showAlert('Please pay the remaining balance of $' + window._remainingBalance.toFixed(2) + ' before submitting.', 'info', 'Balance outstanding');
                    if (window.IrisBridge) window.IrisBridge.error('Remaining balance of $' + window._remainingBalance.toFixed(2) + ' must be paid before submitting.');
                    resetSubmitButton();
                    return;
                }

                // ---- STEP 2: SIP Trunk service ----
                // Created HERE, after payment — creating it at plan selection
                // minted a new service on every visit to that page. The server
                // guards by email, so a retry or resumed session reuses the
                // same service instead of adding another.
                const assignedPlan = getCookie('iristel_selected_plan_name')
                    || getCookie('iristel_selected_plan') || 'SIP Trunk';
                try {
                    if (!getCookie('sip_serviceId')) {
                        updateStatusMessage('Setting up your SIP Trunk service...');
                        const svcResponse = await fetch('/api/mind/service', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                email: customerEmail(contactData),
                                accountId: accountId || getCookie('iristel_account_id'),
                                planCode: 'EXLNP_SBSIPTRNK',
                                contact: contactData,
                                businessName: getCookie('sip_businessName') || null
                            })
                        });
                        const svcData = await svcResponse.json().catch(() => null);
                        if (!svcResponse.ok || !svcData || !svcData.serviceId) {
                            throw new Error('Service setup failed: ' + ((svcData && svcData.error) || ('HTTP ' + svcResponse.status)));
                        }
                        setCookie('sip_serviceId', String(svcData.serviceId));
                        console.log('SIP Trunk service', svcData.reused ? 'reused:' : 'created:', svcData.serviceId);
                    }
                    setOrderStepResult('service', 'done', assignedPlan + ' active on your account');
                } catch (err) {
                    setOrderStepResult('service', 'error', err.message);
                    throw err;
                }

                // ---- STEP 3: Place the number order (espresso DID) ----
                // espresso is ONLY the number source: the customer's picked
                // numbers go in (a request without picks is picked by the
                // server). The order is only PLACED here — the status page
                // polls it, places the numbers on their trunks and starts UBoss
                // provisioning; the customer waits there, not on this button.
                let trunksList = loadTrunksFromCookie();
                if (trunksList.length === 0) {
                    trunksList = [{ name: 'Trunk 1', channels: 1, requests: [], numbers: primaryNumber ? [primaryNumber] : [], primaryNumber: primaryNumber }];
                    setCookie('sip_trunks', JSON.stringify(trunksList));
                }

                if (trunksNeedNumbers(trunksList)) {
                    // Re-use an order placed by an earlier submit attempt
                    // instead of ordering the numbers twice.
                    const existingOrder = getCookie('sip_didOrderId') || getCookie('sip_didOrderNumber');
                    if (!existingOrder) {
                        // Checked again against the trunks being sent: they
                        // may have changed while the account was set up
                        if (sendBackIfPicksIncomplete(trunksList, PAYMENT_UNAFFECTED)) {
                            resetSubmitButton();
                            return;
                        }
                        updateStatusMessage('Placing your number order...');
                        // The account and a stable key let the server recognise a
                        // repeat of THIS order and return the original instead of
                        // billing a second one — protection that survives the
                        // browser losing its state entirely. Each request names
                        // its trunk; its position is how the status page maps
                        // the delivered numbers back.
                        const orderResponse = await fetch('/api/did/order', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                requests: flattenOrderRequests(trunksList),
                                email: customerEmail(contactData),
                                accountRef: accountId || getCookie('iristel_account_id') || null,
                                // Snapshot so another device can rebuild the
                                // order rather than the customer redoing it
                                trunks: trunksList,
                                businessName: getCookie('sip_businessName') || null
                            })
                        });
                        const orderData = await orderResponse.json().catch(() => null);
                        if (!orderResponse.ok || !orderData || !orderData.orderNumber) {
                            // Nothing was bought. Payment is already taken by
                            // now, so the customer is told it is unaffected.
                            if (handleNumberOrderRefusal(orderResponse.status, orderData, trunksList, true)) {
                                resetSubmitButton();
                                return;
                            }
                            throw new Error('Number order failed: ' + ((orderData && orderData.error) || ('HTTP ' + orderResponse.status)));
                        }
                        // The id drives every status call; the ORD- number is
                        // what people read
                        if (orderData.orderId) setCookie('sip_didOrderId', orderData.orderId);
                        setCookie('sip_didOrderNumber', orderData.orderNumber);
                        // A new order: the status page's countdown starts
                        // fresh, not from an earlier order's anchor
                        deleteCookie('sip_provisionStartedAt');
                        console.log('DID order placed:', orderData.orderNumber, orderData.orderId ? '(' + orderData.orderId + ')' : '',
                            orderData.duplicate ? '(existing order re-used — not billed again)' : '');
                    } else {
                        console.log('Resuming DID order:', getCookie('sip_didOrderNumber') || existingOrder);
                    }
                } else if (!trunksList.some(t => t.numbers && t.numbers.length)) {
                    throw new Error('No trunk has number requests or numbers to provision.');
                }

                // ---- STEP 3b: Porting orders — create the PON (LNP API) ----
                if (isPortingOrder()) {
                    updateStatusMessage('Submitting your port request...');
                    try {
                        const pon = await submitPortRequest();
                        setOrderStepResult('port', 'done', 'Port request ' + pon + ' submitted to the losing carrier');
                    } catch (err) {
                        setOrderStepResult('port', 'error', err.message);
                        throw err;
                    }
                }

                // ---- STEP 4: Channel and DID quantities on the MIND service ----
                // The customer has paid and the order is placed, so the billing
                // lines get their counts now. Never blocks the order: the server
                // reports a miss for ops to fix in MIND.
                updateStatusMessage('Setting up billing for your channels and numbers...');
                try {
                    const qr = await fetch('/api/mind/service/quantities', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ email: customerEmail(contactData), trunks: trunksList })
                    });
                    const qd = await qr.json().catch(() => null);
                    if (qd && qd.ok) console.log('MIND quantities set — channels', qd.channels, 'DIDs', qd.dids);
                    else console.error('MIND quantities not set:', qd && qd.error);
                } catch (err) {
                    console.error('MIND quantities request failed:', err.message);
                }

                // The status page starts UBoss once the numbers exist — clear any
                // job state left over from a previous order.
                deleteCookie('sip_provisionJobId');
                deleteCookie('sip_provisionJobs');
                deleteCookie('sip_provisionResult');
                deleteCookie('sip_ubossAutoRetry');

                if (window.IrisBridge) window.IrisBridge.orderComplete(getCookie('sip_didOrderNumber') || getCookie('sip_ponNumber') || accountId);

                updateStatusMessage('Order submitted — opening status...');
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
            startHoldTimer();

            // Show a promo already applied — e.g. after stepping back into an edit
            const savedPromo = getAppliedPromo();
            if (savedPromo) {
                document.getElementById('promoCode').value = savedPromo;
            }

            loadPaymentStatus();
            loadPricingBreakdown();
            if (savedPromo) {
                const msg = document.getElementById('promoMessage');
                msg.textContent = 'Promo applied — $0.01 card verification charge';
                msg.style.color = 'var(--success-green)';
            }

            // Picks left short can't be paid for or ordered — back to the
            // picker before anything else happens here
            if (!orderAlreadyPlaced() && sendBackIfPicksIncomplete(loadTrunksFromCookie(), paymentNote())) return;

            // Hold payment and submit while espresso can't take the order
            checkDidOrderingReady();
        });
