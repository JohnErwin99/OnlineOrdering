// Number selection functionality
const numberItems = document.querySelectorAll('.number-item');

numberItems.forEach(item => {
    item.addEventListener('click', function() {
        // Toggle selected state
        this.classList.toggle('selected');
    });
});

// Filter functionality (demo)
const filterSelects = document.querySelectorAll('.filter-select');

filterSelects.forEach(select => {
    select.addEventListener('change', function() {
        // In a real app, this would filter the numbers list
        console.log('Filter changed:', this.value);
    });
});
