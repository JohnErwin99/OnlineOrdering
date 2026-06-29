// Sample data matching the style
let users = [
    {
        id: 1,
        firstName: 'Alex',
        lastName: 'Johnson',
        password: 'Fax@2024!',
        faxNumber: '(825) 651-2862',
        extension: '2001',
        device: 'Yealink T31P',
        package: 'Essentials',
        status: 'active'
    },
    {
        id: 2,
        firstName: 'Maria',
        lastName: 'Gonzales',
        password: 'Secure#123',
        faxNumber: '(825) 651-2552',
        extension: '2002',
        device: 'None',
        package: 'Pro',
        status: 'pending'
    },
    {
        id: 3,
        firstName: 'John',
        lastName: 'Erwin',
        password: 'Virtual@Fax1',
        faxNumber: '(825) 651-2002',
        extension: '2003',
        device: 'None',
        package: 'Premium',
        status: 'active'
    }
];

let availableFaxNumbers = [
    '(825) 651-2862',
    '(825) 651-2552',
    '(825) 651-2002',
    '(825) 651-2864',
    '(825) 651-2861',
    '(825) 651-2851'
];

let devices = ['None', 'Yealink T31P', 'Yealink T48U', 'Polycom VVX 250', 'Cisco 8841'];
let packages = ['Essentials', 'Pro', 'Premium'];

function togglePassword(id) {
    const input = document.getElementById(`password-${id}`);
    const icon = document.getElementById(`toggle-icon-${id}`);

    if (input.type === 'password') {
        input.type = 'text';
        icon.innerHTML = `
            <path d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
        `;
    } else {
        input.type = 'password';
        icon.innerHTML = `
            <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
            <path d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
        `;
    }
}

function renderUsers() {
    const tbody = document.getElementById('usersTableBody');

    tbody.innerHTML = users.map((user, index) => `
        <tr data-id="${user.id}">
            <td>
                <input type="text" class="table-input" value="${user.firstName}"
                       placeholder="First name"
                       onchange="updateUser(${user.id}, 'firstName', this.value)">
            </td>
            <td>
                <span class="name-display">${user.lastName}</span>
            </td>
            <td>
                <div class="password-wrapper">
                    <input type="password" class="password-input" id="password-${user.id}"
                           value="${user.password}"
                           placeholder="Password"
                           onchange="updateUser(${user.id}, 'password', this.value)">
                    <button type="button" class="toggle-password" onclick="togglePassword(${user.id})">
                        <svg id="toggle-icon-${user.id}" viewBox="0 0 24 24" fill="none">
                            <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
                            <path d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
                        </svg>
                    </button>
                </div>
            </td>
            <td>
                <select class="table-select" onchange="updateUser(${user.id}, 'faxNumber', this.value)">
                    ${availableFaxNumbers.map(num => `
                        <option value="${num}" ${user.faxNumber === num ? 'selected' : ''}>${num}</option>
                    `).join('')}
                </select>
            </td>
            <td>
                <input type="text" class="table-input" value="${user.extension}"
                       placeholder="Ext"
                       onchange="updateUser(${user.id}, 'extension', this.value)">
            </td>
            <td>
                <div class="device-display">${user.device}</div>
            </td>
            <td>
                <select class="table-select" onchange="updateUser(${user.id}, 'package', this.value)">
                    ${packages.map(pkg => `
                        <option value="${pkg}" ${user.package === pkg ? 'selected' : ''}>${pkg}</option>
                    `).join('')}
                </select>
            </td>
            <td>
                <span class="status-badge ${user.status}">${user.status === 'active' ? 'Active' : '• Pending'}</span>
            </td>
            <td>
                <button class="btn-delete" onclick="deleteUser(${user.id})" title="Delete user">
                    <svg viewBox="0 0 20 20" fill="currentColor">
                        <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"/>
                    </svg>
                </button>
            </td>
        </tr>
    `).join('');
}

function updateUser(id, field, value) {
    const user = users.find(u => u.id === id);
    if (user) {
        user[field] = value;
    }
}

function generatePassword() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%';
    let password = '';
    for (let i = 0; i < 10; i++) {
        password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
}

function addUser() {
    const newId = Math.max(...users.map(u => u.id), 0) + 1;
    const nextExtension = 2000 + users.length + 1;

    // Find an available fax number not already in use
    const usedNumbers = users.map(u => u.faxNumber);
    const availableNumber = availableFaxNumbers.find(n => !usedNumbers.includes(n)) || availableFaxNumbers[0];

    users.push({
        id: newId,
        firstName: '',
        lastName: '',
        password: generatePassword(),
        faxNumber: availableNumber,
        extension: nextExtension.toString(),
        device: 'None',
        package: 'Essentials',
        status: 'pending'
    });

    renderUsers();

    // Focus on the new row's first input
    setTimeout(() => {
        const newRow = document.querySelector(`tr[data-id="${newId}"] input`);
        if (newRow) newRow.focus();
    }, 100);
}

function deleteUser(id) {
    if (users.length <= 1) {
        alert('You must have at least one user.');
        return;
    }

    if (confirm('Are you sure you want to remove this user?')) {
        users = users.filter(u => u.id !== id);
        renderUsers();
    }
}

function goBack() {
    window.location.href = 'assignService.html';
}

function saveAndContinue() {
    // Validate that all users have required fields
    const incompleteUser = users.find(u => !u.firstName || !u.lastName || !u.password);
    if (incompleteUser) {
        alert('Please complete all user information (first name, last name, and password required).');
        return;
    }

    // Save to cookies
    setCookie('virtual_fax_users', JSON.stringify(users));

    // Navigate to review page
    window.location.href = 'selectActivationDate.html';
}

// Initialize
document.addEventListener('DOMContentLoaded', function() {
    // Load saved users if available
    const savedUsers = getCookie('virtual_fax_users');
    if (savedUsers) {
        try {
            users = JSON.parse(savedUsers);
        } catch (e) {
            console.log('Using default users');
        }
    }

    renderUsers();
});
