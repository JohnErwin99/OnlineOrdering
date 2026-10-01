// Error dashboard: reads the snag store (GET /api/snags) and lists every
// failure with the full report. Embedded by iframe in the partner portal
// (partner.iristel.com/dashboards/errors), which handles login.
(function () {
    'use strict';

    const REFRESH_MS = 60000;

    // Friendly names for the stages recorded by provisioningStatus.html
    // (client) and reportServerError in server.js (server)
    const STAGE_LABELS = {
        'uboss-pool': 'UBoss number pool',
        'uboss-pool-retry': 'UBoss pool re-order',
        'uboss-provisioning': 'UBoss provisioning',
        'uboss-start': 'UBoss provisioning start',
        'espresso-order': 'DID order rejected',
        'orchestration': 'Provisioning orchestration',
        'did-order': 'DID order placement',
        'lnp-pon': 'Number port (PON)',
        'mind-account': 'MIND account',
        'mind-service': 'MIND service',
        'mind-assign-number': 'MIND number assignment',
        'payment-declined': 'Payment declined',
        'payment-gateway': 'Payment gateway',
        'crm-sync': 'CRM sync'
    };

    const $ = id => document.getElementById(id);
    let all = [];
    let openId = new URLSearchParams(location.search).get('id');

    const esc = s => String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const stageLabel = s => STAGE_LABELS[s] || s || 'unknown';
    const fmtWhen = iso => {
        const d = new Date(iso);
        return isNaN(d) ? '--' : d.toLocaleString(undefined, {
            year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
        });
    };
    const sevChip = sev => sev === 'warning'
        ? '<span class="chip chip-warning">Warning</span>'
        : '<span class="chip chip-error">Error</span>';

    // Old reports predate these fields
    function normalize(r, i) {
        return {
            ...r,
            id: r.id || `legacy-${i}-${r.at}`,
            source: r.source || 'client',
            severity: r.severity || 'error',
            context: r.context || {},
            numbers: r.numbers || [],
            provisionJobs: r.provisionJobs || [],
            orderProblems: r.orderProblems || []
        };
    }

    async function load() {
        $('refresh').disabled = true;
        try {
            const res = await fetch('/api/snags', { cache: 'no-store' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            all = (data.snags || []).map(normalize)
                .sort((a, b) => String(b.at).localeCompare(String(a.at)));
            $('loadError').hidden = true;
            $('updated').textContent = 'Updated ' + new Date().toLocaleTimeString();
            fillStageFilter();
            render();
            if (openId) openDetail(openId);
        } catch (e) {
            $('loadError').textContent = 'Could not load errors (' + e.message + '). Retrying shortly.';
            $('loadError').hidden = false;
        } finally {
            $('refresh').disabled = false;
        }
    }

    function fillStageFilter() {
        const sel = $('fStage');
        const current = sel.value;
        const stages = [...new Set(all.map(r => r.stage))].sort((a, b) => stageLabel(a).localeCompare(stageLabel(b)));
        sel.innerHTML = '<option value="">All stages</option>' +
            stages.map(s => `<option value="${esc(s)}">${esc(stageLabel(s))}</option>`).join('');
        sel.value = stages.includes(current) ? current : '';
    }

    function haystack(r) {
        return [r.email, r.businessName, r.orderNumber, r.account, r.stage, stageLabel(r.stage), r.detail,
            ...r.numbers, ...r.provisionJobs.map(j => j.jobId), ...r.provisionJobs.flatMap(j => j.numbers || []),
            r.context.reference]
            .filter(Boolean).join(' ').toLowerCase();
    }

    function filtered() {
        const q = $('q').value.trim().toLowerCase();
        const sev = $('fSeverity').value, stage = $('fStage').value, src = $('fSource').value;
        const from = $('fFrom').value ? new Date($('fFrom').value + 'T00:00:00') : null;
        const to = $('fTo').value ? new Date($('fTo').value + 'T23:59:59.999') : null;
        return all.filter(r => {
            if (sev && r.severity !== sev) return false;
            if (stage && r.stage !== stage) return false;
            if (src && r.source !== src) return false;
            const at = new Date(r.at);
            if (from && at < from) return false;
            if (to && at > to) return false;
            if (q && !haystack(r).includes(q)) return false;
            return true;
        });
    }

    function renderKpis() {
        const errors = all.filter(r => r.severity === 'error');
        const dayAgo = Date.now() - 24 * 3600 * 1000;
        $('kpiTotal').textContent = errors.length;
        $('kpi24h').textContent = errors.filter(r => new Date(r.at).getTime() >= dayAgo).length;
        $('kpiWarn').textContent = all.length - errors.length;
        const counts = {};
        errors.forEach(r => { counts[r.stage] = (counts[r.stage] || 0) + 1; });
        const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
        $('kpiTop').textContent = top ? `${stageLabel(top[0])} (${top[1]})` : '–';
        $('kpiTop').title = $('kpiTop').textContent;
    }

    function render() {
        renderKpis();
        const rows = filtered();
        $('rows').innerHTML = rows.map(r => `
            <tr data-id="${esc(r.id)}">
                <td class="when">${esc(fmtWhen(r.at))}</td>
                <td>${sevChip(r.severity)}</td>
                <td>${esc(stageLabel(r.stage))}<div class="muted">${r.source === 'server' ? 'Server' : 'Customer browser'}</div></td>
                <td>${r.businessName ? `${esc(r.businessName)}<div class="muted">${esc(r.email)}</div>` : esc(r.email || '--')}</td>
                <td class="mono">${esc(r.orderNumber || '--')}</td>
                <td class="detail" title="${esc(r.detail)}">${esc(r.detail || '--')}</td>
            </tr>`).join('');
        $('empty').textContent = all.length ? 'No errors match these filters.' : 'No errors recorded yet.';
        $('empty').hidden = rows.length > 0;
    }

    // ---------- Detail drawer ----------
    const field = (label, value) => `<dt>${esc(label)}</dt><dd>${value}</dd>`;
    const txt = v => v == null || v === '' ? '--' : esc(v);

    function openDetail(id) {
        const r = all.find(x => x.id === id);
        if (!r) return;
        openId = id;
        $('dBadges').innerHTML = sevChip(r.severity) +
            `<span class="chip">${r.source === 'server' ? 'Server' : 'Customer browser'}</span>`;
        $('dTitle').textContent = stageLabel(r.stage);
        $('dWhen').textContent = fmtWhen(r.at) + ' · ' + r.stage;

        const jobs = r.provisionJobs.length
            ? r.provisionJobs.map(j => `<span class="mono">${esc(j.jobId)}</span> <span class="muted">[${esc((j.numbers || []).join(', '))}]</span>`).join('<br>')
            : '--';
        const ctx = Object.entries(r.context).filter(([, v]) => v != null && v !== '');

        let html = `
            <h3>Customer</h3>
            <dl>
                ${field('Business', txt(r.businessName))}
                ${field('Email', r.email ? `<a href="mailto:${esc(r.email)}">${esc(r.email)}</a>` : '--')}
                ${field('MIND account', `<span class="mono">${txt(r.account)}</span>`)}
            </dl>
            <h3>Order</h3>
            <dl>
                ${field('Order number', `<span class="mono">${txt(r.orderNumber)}</span>`)}
                ${field('Numbers', r.numbers.length ? `<span class="mono">${esc(r.numbers.join(', '))}</span>` : '--')}
                ${field('UBoss jobs', jobs)}
            </dl>
            <h3>Error detail</h3>
            <pre>${txt(r.detail)}</pre>`;
        if (r.orderProblems.length) {
            html += `<h3>espresso order problems</h3><pre>${esc(JSON.stringify(r.orderProblems, null, 2))}</pre>`;
        }
        if (ctx.length) {
            html += `<h3>Context</h3><dl>${ctx.map(([k, v]) =>
                field(k, `<span class="mono">${esc(typeof v === 'object' ? JSON.stringify(v) : v)}</span>`)).join('')}</dl>`;
        }
        $('dBody').innerHTML = html;
        $('drawer').classList.add('open');
        $('drawer').setAttribute('aria-hidden', 'false');
        $('backdrop').hidden = false;
    }

    function closeDetail() {
        openId = null;
        $('drawer').classList.remove('open');
        $('drawer').setAttribute('aria-hidden', 'true');
        $('backdrop').hidden = true;
    }

    // ---------- Wiring ----------
    $('rows').addEventListener('click', e => {
        const tr = e.target.closest('tr[data-id]');
        if (tr) openDetail(tr.dataset.id);
    });
    $('dClose').addEventListener('click', closeDetail);
    $('backdrop').addEventListener('click', closeDetail);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDetail(); });
    $('refresh').addEventListener('click', load);
    ['q', 'fSeverity', 'fStage', 'fSource', 'fFrom', 'fTo'].forEach(id =>
        $(id).addEventListener(id === 'q' ? 'input' : 'change', render));
    $('clear').addEventListener('click', () => {
        ['q', 'fSeverity', 'fStage', 'fSource', 'fFrom', 'fTo'].forEach(id => { $(id).value = ''; });
        render();
    });

    load();
    setInterval(load, REFRESH_MS);
})();
