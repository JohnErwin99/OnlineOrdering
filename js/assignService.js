// Sample data matching the screenshot
let users = [
    {
        id: 1,
        firstName: 'Alex',
        lastName: 'Johnson',
        phoneNumber: '(825) 555-101',
        extension: '1001',
        device: 'Yealink T31P',
        package: 'Essentials',
        status: 'active'
    },
    {
        id: 2,
        firstName: 'Maria',
        lastName: 'Gonzales',
        phoneNumber: '(825) 555-101',
        extension: '1002',
        device: 'None',
        package: 'Pro',
        status: 'pending'
    }
];

let availableNumbers = [
    '(825) 555-101',
    '(825) 555-102',
    '(825) 555-103',
    '(825) 555-104',
    '(825) 555-105'
];

let devices = ['None', 'Yealink T31P', 'Yealink T48U', 'Polycom VVX 250', 'Cisco 8841'];
let packages = ['Essentials', 'Pro', 'Premium'];

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
                <select class="table-select" onchange="updateUser(${user.id}, 'phoneNumber', this.value)">
                    ${availableNumbers.map(num => `
                        <option value="${num}" ${user.phoneNumber === num ? 'selected' : ''}>${num}</option>
                    `).join('')}
                </select>
            </td>
            <td>
                <input type="text" class="table-input" value="${user.extension}"
                       placeholder="Extension"
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

function addUser() {
    const newId = Math.max(...users.map(u => u.id), 0) + 1;
    const nextExtension = 1000 + users.length + 1;

    users.push({
        id: newId,
        firstName: '',
        lastName: '',
        phoneNumber: availableNumbers[0],
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
    window.history.back();
}

function saveAndContinue() {
    // Validate that all users have required fields
    const incompleteUser = users.find(u => !u.firstName || !u.lastName);
    if (incompleteUser) {
        alert('Please complete all user information (first name and last name required).');
        return;
    }

    // Save to cookies
    setCookie('cloud_calling_users', JSON.stringify(users));

    // Navigate to next page
    window.location.href = 'assignVirtualFax.html';
}

// Initialize
document.addEventListener('DOMContentLoaded', function() {
    // Load saved users if available
    const savedUsers = getCookie('cloud_calling_users');
    if (savedUsers) {
        try {
            users = JSON.parse(savedUsers);
        } catch (e) {
            console.log('Using default users');
        }
    }

    renderUsers();
});
