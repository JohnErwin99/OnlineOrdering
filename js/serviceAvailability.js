const input = document.querySelector(".address-input");
const nextBtn = document.querySelector(".nav-button");
const statusEl = document.querySelector(".address-status");
const suggestionBox = document.querySelector(".address-suggestion");
const suggestedTextEl = document.querySelector(".suggested-text");
const acceptBtn = document.querySelector(".btn-accept");
const keepBtn = document.querySelector(".btn-keep");

let lastValidation = null; // store latest validation response

function showStatus(msg, type = "info") {
    statusEl.style.display = "block";
    statusEl.textContent = msg;
    // simple styling
    statusEl.style.padding = "10px";
    statusEl.style.borderRadius = "10px";
    statusEl.style.border = "1px solid #e5e7eb";
    statusEl.style.background = type === "error" ? "rgba(239,68,68,.08)"
                        : type === "ok" ? "rgba(34,197,94,.08)"
                        : "rgba(59,130,246,.08)";
}

function hideSuggestion() {
    suggestionBox.style.display = "none";
    suggestedTextEl.textContent = "";
}

function showSuggestion(formattedAddress) {
    suggestionBox.style.display = "block";
    suggestedTextEl.textContent = formattedAddress;
}

async function initGoogle() {
    await window.__gmapsReady();
    // Import libraries on demand
    const { AddressValidation } = await google.maps.importLibrary("addressValidation");
    const { places } = await google.maps.importLibrary("places");

    // Places Autocomplete (classic widget) for the single-line input
    const autocomplete = new google.maps.places.Autocomplete(input, {
        types: ["address"],
        componentRestrictions: { country: ["ca"] } // change if needed
    });

    autocomplete.addListener("place_changed", async () => {
        const place = autocomplete.getPlace();
        const text = (place && place.formatted_address) ? place.formatted_address : input.value.trim();
        if (!text) return;
        input.value = text;
        hideSuggestion();
        await validateSingleLine(AddressValidation, text);
    });

    // Also validate on blur (if user types manually)
    input.addEventListener("blur", async () => {
        const text = input.value.trim();
        if (!text) return;
        hideSuggestion();
        await validateSingleLine(AddressValidation, text);
    });

    // Validate on Next click (block if not valid)
    nextBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        const text = input.value.trim();
        if (!text) {
            showStatus("Please enter an address.", "error");
            return;
        }
        await validateSingleLine(AddressValidation, text, { strictOnNext: true });
        if (lastValidation && lastValidation.verdict && lastValidation.verdict.addressComplete) {
            // proceed (replace with your real next step)
            showStatus("Address validated. You can proceed.", "ok");
            window.location.href = "signUp.html";
        }
    });

    // Suggestion actions
    acceptBtn.addEventListener("click", () => {
        if (lastValidation?.address?.formattedAddress) {
            input.value = lastValidation.address.formattedAddress;
            showStatus("Using the standardized address.", "ok");
            hideSuggestion();
        }
    });

    keepBtn.addEventListener("click", () => {
        showStatus("Keeping your entered address. Please ensure it's correct.", "info");
        hideSuggestion();
    });

    // Core validator using ONE-LINE addressLines
    async function validateSingleLine(AddressValidationLib, singleLine, opts = {}) {
        try {
            showStatus("Validating address\u2026", "info");

            const result = await AddressValidationLib.fetchAddressValidation({
                address: {
                    regionCode: "CA",            // change to "US" if US
                    languageCode: "en",
                    addressLines: [singleLine]   // single-line input goes here
                }
            });

            lastValidation = result;

            const verdict = result.verdict || {};
            const formatted = result.address?.formattedAddress || "";

            // If Google suggests a standardized format different from user input
            if (formatted && formatted.toLowerCase() !== singleLine.toLowerCase()) {
                showSuggestion(formatted);
            } else {
                hideSuggestion();
            }

            // Basic acceptance rules (you can tighten these)
            if (!verdict.addressComplete) {
                showStatus("Address looks incomplete. Please add missing details (unit, postal code, city, etc.).", "error");
                return;
            }

            if (verdict.hasUnconfirmedComponents && opts.strictOnNext) {
                showStatus("Some address parts can't be confirmed. Please choose the suggested address or edit yours.", "error");
                return;
            }

            showStatus("Address looks valid.", "ok");
        } catch (err) {
            console.error(err);
            showStatus("Validation failed. Please try again or check your API key / enabled APIs.", "error");
        }
    }
}

initGoogle();
