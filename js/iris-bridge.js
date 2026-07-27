/* ═══════════════════════════════════════════════════════════════
   iris-bridge.js — SIP trunk ordering → Iris (parent page) bridge
   ═══════════════════════════════════════════════════════════════
   WHERE: save as js/iris-bridge.js in OnlineOrdering, then add to
   EVERY page in the "Sip Trunk" folder, right before </body>:

       <script src="../js/iris-bridge.js"></script>

   WHAT: announces the current step to the parent page so Iris knows
   where the customer is, and exposes helpers for errors + payment.
   Safe to include when NOT in an iframe — it simply does nothing.
   ═══════════════════════════════════════════════════════════════ */

   (function () {
    "use strict";
  
    // Parent origins allowed to receive our messages (add the custom
    // domain here when the Webflow site launches on iristel.com).
    var PARENT_ORIGINS = [
      "https://iristel.webflow.io",
      "https://www.iristel.com",
      "https://iristel.com"
    ];
  
    // Only run inside an iframe.
    if (window.parent === window) return;
  
    /* Step map keyed by filename. Order reflects the ACTUAL navigation
       chain in the JS (not the on-page progress labels, which are
       inconsistent — see note at the bottom of this file). */
    var STEPS = {
      "signup.html":            { step: 1, name: "signup",           label: "Creating your account" },
      "siptrunkselection.html": { step: 2, name: "plan_selection",   label: "Choosing your trunk plan" },
      "siptrunkpayment.html":   { step: 3, name: "payment",          label: "Saving your card" },
      "businesssetup.html":     { step: 4, name: "business_setup",   label: "Business details" },
      "numbersource.html":      { step: 5, name: "number_source",    label: "New or ported numbers" },
      // Step 6 forks: porting goes LOA -> number selection, new numbers
      // go straight to number selection. Both share a step number so the
      // progress bar reads the same either way.
      "siptrunkloa.html":       { step: 6, name: "loa",              label: "Letter of Authorization" },
      "numberselection.html":   { step: 6, name: "number_selection", label: "Picking your numbers" },
      "userassignment.html":    { step: 7, name: "user_assignment",  label: "Assigning users" },
      "sipreview.html":         { step: 8, name: "review",           label: "Review & confirm" },
      // Post-submission. All 8 customer steps are done by the time this
      // page loads — it polls UbossRobot and has no Next button.
      "provisioningstatus.html":{ step: 8, name: "provisioning",     label: "Setting up your trunk" }
    };
    var TOTAL_STEPS = 8;
  
    function post(payload) {
      payload.source = "onlineordering";
      for (var i = 0; i < PARENT_ORIGINS.length; i++) {
        try { window.parent.postMessage(payload, PARENT_ORIGINS[i]); } catch (e) {}
      }
    }
  
    function currentPage() {
      var f = (location.pathname.split("/").pop() || "").toLowerCase();
      return f || "index.html";
    }
  
    /* ---- 1. Announce the step on load ---- */
    function announceStep() {
      var info = STEPS[currentPage()];
      if (!info) return;
      post({
        type: "iris:step",
        step: info.step,
        total: TOTAL_STEPS,
        name: info.name,
        label: info.label
      });
    }
  
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", announceStep);
    } else {
      announceStep();
    }
  
    /* ---- 2. Public helpers — call these from your existing step JS ---- */
  
    // Validation / API error the customer is looking at.
    //   IrisBridge.error("Postal code must be Canadian format");
    function error(message, field) {
      post({ type: "iris:error", message: String(message || ""), field: field || null });
    }
  
    // Card tokenized and stored on the payment step. No money has moved
    // yet — the charge happens on the review step.
    //   IrisBridge.cardSaved("8785");
    function cardSaved(last4) {
      post({ type: "iris:payment", status: "card_saved", last4: last4 || null });
    }

    // Payment succeeded — this is the important one. Iris uses the
    // reference instead of asking the customer to read it aloud.
    //   IrisBridge.paymentSuccess(reference, amount);
    function paymentSuccess(reference, amount) {
      post({
        type: "iris:payment",
        status: "paid",
        reference: reference || "",
        amount: amount || null
      });
    }
  
    function paymentFailed(message) {
      post({ type: "iris:payment", status: "failed", message: String(message || "") });
    }
  
    // Whole order finished.
    //   IrisBridge.orderComplete(orderRef);
    function orderComplete(reference) {
      post({ type: "iris:complete", reference: reference || "" });
    }
  
    window.IrisBridge = {
      error: error,
      cardSaved: cardSaved,
      paymentSuccess: paymentSuccess,
      paymentFailed: paymentFailed,
      orderComplete: orderComplete,
      announceStep: announceStep
    };
  
    /* ═══════════════════════════════════════════════════════════════
       WHERE THIS IS WIRED UP

       js/common.js — showMessage('error', msg) forwards to error().
         Covers every inline message box on every step automatically.

       js/sipTrunkPayment.js — processPayment() only tokenizes the card,
         so it calls cardSaved(last4). No charge happens on this step.

       js/sip-sipReview.js — chargeRemainingBalance() calls
         paymentSuccess(reference, amount) / paymentFailed(msg), and
         submitOrder() calls orderComplete(jobId) plus error() on each
         of its blocking checks.

       Any NEW alert()-style error you add should also call:
           if (window.IrisBridge) window.IrisBridge.error("...", "fieldId");
       (alert() itself is not intercepted — the call has to be explicit.)

       ═══════════════════════════════════════════════════════════════
       NOTE — progress labels are inconsistent in the HTML:
         businessSetup.html says "Step 1 of 6" but is reached AFTER
         payment; sipTrunkSelection says "2 of 6" but is the first
         screen; numberSelection.html has no label at all. This file
         uses the real navigation order instead. Worth fixing the
         on-page labels separately so what the customer sees matches
         what Iris says.
       ═══════════════════════════════════════════════════════════════ */
  })();