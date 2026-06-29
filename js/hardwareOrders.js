// Add selection functionality to cards
const selectButtons = document.querySelectorAll('.btn-select');

selectButtons.forEach(button => {
    button.addEventListener('click', function() {
        // Remove selected state from all cards
        document.querySelectorAll('.hardware-card').forEach(card => {
            card.style.boxShadow = '';
            card.style.borderColor = '';
            card.querySelector('.btn-select').textContent = 'Select';
        });

        // Add selected state to clicked card
        const card = this.closest('.hardware-card');
        card.style.boxShadow = '0 0 0 2px var(--tufts-blue), 0 8px 30px rgba(62, 140, 203, 0.2)';
        this.textContent = 'Selected';
    });
});
