        let selectedSource = null;

        function selectSource(source) {
            selectedSource = source;
            document.getElementById('cardNew').classList.toggle('selected', source === 'new');
            document.getElementById('cardPort').classList.toggle('selected', source === 'port');
            document.getElementById('nextBtn').disabled = false;
        }

        function goNext() {
            if (!selectedSource) return;

            setCookie('sip_numberSource', selectedSource);
            setCookie('sip_isPorting', selectedSource === 'port' ? 'true' : 'false');

            if (selectedSource === 'port') {
                window.location.href = 'siptrunkLOA.html';
            } else {
                window.location.href = 'numberSelection.html';
            }
        }

        document.addEventListener('DOMContentLoaded', function() {
            loadUserInfoBar();
            const saved = getCookie('sip_numberSource');
            if (saved) selectSource(saved);
        });
