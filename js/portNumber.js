// Number selection functionality
const numberItems = document.querySelectorAll('.number-item');

numberItems.forEach(item => {
    item.addEventListener('click', function() {
        this.classList.toggle('selected');
    });
});

// File upload functionality
const fileUpload = document.querySelector('.file-upload');
const fileInput = document.querySelector('.file-input');
const uploadText = document.querySelector('.upload-text');

fileInput.addEventListener('change', function() {
    if (this.files.length > 0) {
        uploadText.textContent = this.files[0].name;
        fileUpload.style.borderColor = 'var(--tufts-blue)';
        fileUpload.style.backgroundColor = 'rgba(62, 140, 203, 0.05)';
    }
});

// Drag and drop functionality
fileUpload.addEventListener('dragover', function(e) {
    e.preventDefault();
    this.style.borderColor = 'var(--tufts-blue)';
    this.style.backgroundColor = 'rgba(62, 140, 203, 0.05)';
});

fileUpload.addEventListener('dragleave', function(e) {
    e.preventDefault();
    this.style.borderColor = '';
    this.style.backgroundColor = '';
});

fileUpload.addEventListener('drop', function(e) {
    e.preventDefault();
    this.style.borderColor = 'var(--tufts-blue)';
    this.style.backgroundColor = 'rgba(62, 140, 203, 0.05)';

    if (e.dataTransfer.files.length > 0) {
        fileInput.files = e.dataTransfer.files;
        uploadText.textContent = e.dataTransfer.files[0].name;
    }
});

// Filter functionality (demo)
const filterSelects = document.querySelectorAll('.filter-select');

filterSelects.forEach(select => {
    select.addEventListener('change', function() {
        console.log('Filter changed:', this.value);
    });
});
