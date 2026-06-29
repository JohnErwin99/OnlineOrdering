        let users = [];
        let availableNumbers = [];

        function addUser() {
            const id = Date.now();
            users.push({
                id: id,
                firstName: '',
                lastName: '',
                number: '',
                package: 'business-trunk'
            });
            renderUsers();
        }

        function removeUser(id) {
            users = users.filter(u => u.id !== id);
            renderUsers();
        }

        function updateUser(id, field, value) {
            const user = users.find(u => u.id === id);
            if (user) {
                user[field] = value;
            }
            updatePilotOptions();
        }

        function renderUsers() {
            const tbody = document.getElementById('usersTableBody');
            const emptyState = document.getElementById('emptyState');
            const table = document.getElementById('usersTable');
            const pilotSection = document.getElementById('pilotSection');

            if (users.length === 0) {
                table.style.display = 'none';
                emptyState.style.display = 'block';
                pilotSection.style.display = 'none';
            } else {
                table.style.display = 'table';
                emptyState.style.display = 'none';
                pilotSection.style.display = 'block';

                tbody.innerHTML = users.map(user => `
                    <tr>
                        <td>
                            <input type="text" placeholder="First name" value="${user.firstName}"
                                   onchange="updateUser(${user.id}, 'firstName', this.value)">
                        </td>
                        <td>
                            <input type="text" placeholder="Last name" value="${user.lastName}"
                                   onchange="updateUser(${user.id}, 'lastName', this.value)">
                        </td>
                        <td>
                            <select onchange="updateUser(${user.id}, 'number', this.value)">
                                <option value="">Select number</option>
                                ${availableNumbers.map(num => `
                                    <option value="${num}" ${user.number === num ? 'selected' : ''}>${num}</option>
                                `).join('')}
                            </select>
                        </td>
                        <td>
                            <select onchange="updateUser(${user.id}, 'package', this.value)">
                                <option value="business-trunk" ${user.package === 'business-trunk' ? 'selected' : ''}>Business Trunk</option>
                                <option value="standard" ${user.package === 'standard' ? 'selected' : ''}>Standard</option>
                                <option value="premium" ${user.package === 'premium' ? 'selected' : ''}>Premium</option>
                            </select>
                        </td>
                        <td>
                            <button class="btn-remove" onclick="removeUser(${user.id})" ${users.length === 1 ? 'disabled style="opacity: 0.3; cursor: not-allowed;"' : ''}>
                                <svg viewBox="0 0 20 20" fill="currentColor">
                                    <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"/>
                                </svg>
                            </button>
                        </td>
                    </tr>
                `).join('');

                updatePilotOptions();
            }
        }

        function updatePilotOptions() {
            const pilotSelect = document.getElementById('pilotUser');
            const currentValue = pilotSelect.value;

            pilotSelect.innerHTML = '<option value="">Select pilot user</option>';

            users.forEach(user => {
                if (user.firstName && user.lastName && user.number) {
                    const label = `${user.firstName} ${user.lastName} - ${user.number}`;
                    pilotSelect.innerHTML += `<option value="${user.id}" ${currentValue == user.id ? 'selected' : ''}>${label}</option>`;
                }
            });
        }

        function saveAndContinue() {
            // Validate users
            if (users.length === 0) {
                alert('Please add at least one user.');
                return;
            }

            const incompleteUser = users.find(u => !u.firstName || !u.lastName || !u.number);
            if (incompleteUser) {
                alert('Please complete all user information (first name, last name, and phone number).');
                return;
            }

            const pilotUser = document.getElementById('pilotUser').value;
            if (!pilotUser) {
                alert('Please select a pilot user.');
                return;
            }

            // Save data
            setCookie('sip_users', JSON.stringify(users));
            setCookie('sip_pilotUser', pilotUser);

            window.location.href = 'sipReview.html';
        }

        // Initialize
        document.addEventListener('DOMContentLoaded', function() {
            loadUserInfoBar();
            // Load selected numbers
            const savedNumbers = getCookie('sip_selectedNumbers');
            if (savedNumbers) {
                try {
                    availableNumbers = JSON.parse(savedNumbers);
                } catch (e) {
                    availableNumbers = [];
                }
            }

            // Load saved users or add first user
            const savedUsers = getCookie('sip_users');
            if (savedUsers) {
                try {
                    users = JSON.parse(savedUsers);
                } catch (e) {
                    users = [];
                }
            }

            if (users.length === 0) {
                addUser();
            } else {
                renderUsers();
            }

            // Load pilot user selection
            const savedPilot = getCookie('sip_pilotUser');
            if (savedPilot) {
                setTimeout(() => {
                    document.getElementById('pilotUser').value = savedPilot;
                }, 100);
            }
        });
