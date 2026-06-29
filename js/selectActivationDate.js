let currentDate = new Date();
let selectedDate = null;
let viewYear = currentDate.getFullYear();
let viewMonth = currentDate.getMonth();

const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function renderCalendar() {
    document.getElementById('calendarMonthYear').textContent = `${monthNames[viewMonth]} ${viewYear}`;

    const firstDay = new Date(viewYear, viewMonth, 1).getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let html = '';
    let day = 1;
    const rows = Math.ceil((firstDay + daysInMonth) / 7);

    for (let r = 0; r < rows; r++) {
        html += '<tr>';
        for (let c = 0; c < 7; c++) {
            const cellIndex = r * 7 + c;
            if (cellIndex < firstDay || day > daysInMonth) {
                // Overflow days from prev/next month
                const isFirst = cellIndex < firstDay;
                if (isFirst) {
                    const prevMonthDays = new Date(viewYear, viewMonth, 0).getDate();
                    const prevDay = prevMonthDays - (firstDay - cellIndex - 1);
                    html += `<td class="disabled">${prevDay}</td>`;
                } else {
                    html += `<td class="disabled">${day++ - daysInMonth}</td>`;
                }
            } else {
                const cellDate = new Date(viewYear, viewMonth, day);
                cellDate.setHours(0,0,0,0);
                const isPast = cellDate < today;
                const isToday = cellDate.getTime() === today.getTime();
                const isSelected = selectedDate && cellDate.getTime() === selectedDate.getTime();
                let cls = '';
                if (isPast) cls = 'disabled';
                else if (isSelected) cls = 'selected';
                else if (isToday) cls = 'today';
                const d = day;
                html += `<td class="${cls}" onclick="selectDay(${viewYear}, ${viewMonth}, ${d})">${d}</td>`;
                day++;
            }
        }
        html += '</tr>';
    }

    document.getElementById('calendarBody').innerHTML = html;
}

function selectDay(year, month, day) {
    const clicked = new Date(year, month, day);
    clicked.setHours(0,0,0,0);
    const today = new Date(); today.setHours(0,0,0,0);
    if (clicked < today) return;
    selectedDate = clicked;
    renderCalendar();
}

function changeMonth(dir) {
    viewMonth += dir;
    if (viewMonth > 11) { viewMonth = 0; viewYear++; }
    if (viewMonth < 0)  { viewMonth = 11; viewYear--; }
    renderCalendar();
}

function confirmDate() {
    const option = document.querySelector('input[name="activation"]:checked').value;
    if (option === 'scheduled' && !selectedDate) {
        alert('Please select an activation date from the calendar.');
        return;
    }
    const dateStr = option === 'asap' ? 'As soon as possible' : selectedDate.toDateString();
    alert(`Activation date confirmed: ${dateStr}`);
    // Store and proceed
    document.cookie = `iristel_activation_date=${encodeURIComponent(dateStr)};path=/;SameSite=Strict`;
    window.location.href = 'summary.html';
}

// Show/hide calendar based on radio
document.querySelectorAll('input[name="activation"]').forEach(radio => {
    radio.addEventListener('change', () => {
        const cal = document.getElementById('calendar');
        cal.style.opacity = radio.value === 'scheduled' ? '1' : '0.4';
        cal.style.pointerEvents = radio.value === 'scheduled' ? 'auto' : 'none';
    });
});

// Init calendar dimmed (asap is default)
document.getElementById('calendar').style.opacity = '0.4';
document.getElementById('calendar').style.pointerEvents = 'none';

renderCalendar();
