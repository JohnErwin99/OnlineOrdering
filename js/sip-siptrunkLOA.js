        function addNumber() {
            const container = document.getElementById('numbersContainer');
            const row = document.createElement('div');
            row.className = 'number-input-row';
            row.innerHTML = `
                <input type="tel" placeholder="(555) 123-4567" class="port-number" required>
                <button type="button" class="btn-remove" onclick="removeNumber(this)">
                    <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/></svg>
                </button>
            `;
            container.appendChild(row);
            updateRemoveButtons();
        }

        function removeNumber(btn) {
            btn.parentElement.remove();
            updateRemoveButtons();
        }

        function updateRemoveButtons() {
            const rows = document.querySelectorAll('.number-input-row');
            rows.forEach((row, index) => {
                const btn = row.querySelector('.btn-remove');
                btn.style.visibility = rows.length > 1 ? 'visible' : 'hidden';
            });
        }

        function downloadTemplate() {
            // In production, this would download an actual LOA template
            alert('LOA Template download would start here. In production, this links to the actual PDF template.');
        }

        // Drag and drop handling
        const uploadArea = document.getElementById('uploadArea');

        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.classList.add('dragover');
        });

        uploadArea.addEventListener('dragleave', () => {
            uploadArea.classList.remove('dragover');
        });

        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('dragover');
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                handleFile(files[0]);
            }
        });

        function handleFileUpload(input) {
            if (input.files.length > 0) {
                handleFile(input.files[0]);
            }
        }

        function handleFile(file) {
            const validTypes = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg'];
            if (!validTypes.includes(file.type)) {
                alert('Please upload a PDF, PNG, or JPG file.');
                return;
            }
            if (file.size > 10 * 1024 * 1024) {
                alert('File size must be less than 10MB.');
                return;
            }

            document.getElementById('uploadArea').style.display = 'none';
            document.getElementById('uploadedFile').style.display = 'flex';
            document.getElementById('fileName').textContent = file.name;
            document.getElementById('fileSize').textContent = formatFileSize(file.size);

            // Store file reference
            setCookie('sip_loaFileName', file.name);
        }

        function removeFile() {
            document.getElementById('uploadArea').style.display = 'block';
            document.getElementById('uploadedFile').style.display = 'none';
            document.getElementById('fileInput').value = '';
        }

        function formatFileSize(bytes) {
            if (bytes < 1024) return bytes + ' B';
            if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
            return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
        }

        function saveAndContinue() {
            const form = document.getElementById('loaForm');
            if (!form.checkValidity()) {
                form.reportValidity();
                return;
            }

            // Collect numbers to port
            const numbers = [];
            document.querySelectorAll('.port-number').forEach(input => {
                if (input.value.trim()) {
                    numbers.push(input.value.trim());
                }
            });

            if (numbers.length === 0) {
                alert('Please enter at least one phone number to port.');
                return;
            }

            // Save data
            setCookie('sip_portNumbers', JSON.stringify(numbers));
            setCookie('sip_currentProvider', document.getElementById('currentProvider').value);
            setCookie('sip_accountNumber', document.getElementById('accountNumber').value);
            setCookie('sip_accountPin', document.getElementById('accountPin').value);
            setCookie('sip_serviceAddress', document.getElementById('serviceAddress').value);
            setCookie('sip_isPoriting', 'true');

            window.location.href = 'numberSelection.html';
        }

        // Load saved data
        document.addEventListener('DOMContentLoaded', function() {
            loadUserInfoBar();
            const savedNumbers = getCookie('sip_portNumbers');
            if (savedNumbers) {
                try {
                    const numbers = JSON.parse(savedNumbers);
                    const container = document.getElementById('numbersContainer');
                    container.innerHTML = '';
                    numbers.forEach((num, index) => {
                        const row = document.createElement('div');
                        row.className = 'number-input-row';
                        row.innerHTML = `
                            <input type="tel" placeholder="(555) 123-4567" class="port-number" value="${num}" required>
                            <button type="button" class="btn-remove" onclick="removeNumber(this)">
                                <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/></svg>
                            </button>
                        `;
                        container.appendChild(row);
                    });
                    updateRemoveButtons();
                } catch (e) {}
            }

            const fields = ['currentProvider', 'accountNumber', 'accountPin', 'serviceAddress'];
            fields.forEach(field => {
                const saved = getCookie('sip_' + field);
                if (saved) document.getElementById(field).value = saved;
            });
        });
