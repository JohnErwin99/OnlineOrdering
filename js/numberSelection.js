// Radio option selection
const radioOptions = document.querySelectorAll('.radio-input');

radioOptions.forEach(radio => {
    radio.addEventListener('change', function() {
        // Handle selection change
        console.log('Selected option:', this.nextElementSibling.textContent);
    });
});

// Pick different number link
const pickDifferent = document.querySelector('.pick-different');
pickDifferent.addEventListener('click', function(e) {
    e.preventDefault();
    // In a real app, this would navigate to number selection
    console.log('Navigate to number selection');
});
