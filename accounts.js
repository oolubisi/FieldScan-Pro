// ===== accounts.js =====
async function loadAccountsView() {
  const cache = getCache();
  const sel = document.getElementById("accounts-project-sel");
  if (sel) {
    sel.innerHTML =
      '<option value="">-- Select Project --</option>' +
      (cache.projects || [])
        .map(
          (p) =>
            `<option value="${escapeAttr(p.projectId)}">${escapeHtml(p.clientName)} (${escapeHtml(p.displayNumber || p.projectId)})</option>`,
        )
        .join("");
  }
  updateAccountsSummary();
  if (!cache.payments || !cache.payments.length) {
    callApi("getPayments", {})
      .then((payments) => {
        cache.payments = payments || [];
        setCache(cache);
        updateAccountsSummary();
      })
      .catch((e) => console.error("Background getPayments fetch failed", e));
  }
}

function updateAccountsSummary() {
  const pId = document.getElementById("accounts-project-sel").value;
  const cache = getCache();
  const proj = cache.projects.find((p) => p.projectId === pId);
  if (!pId || !proj) {
    setAccountsAmounts(0, 0, 0, 0, 0, 0, 0, 0);
    return;
  }
  const groups = getAllPaymentGroups(pId);
  let totalReceived = 0,
    totalOutgoing = 0,
    smallExpenses = 0,
    totalPending = 0,
    totalOutstanding = 0;
  groups.forEach((g) => {
    if (g.direction === "Client Receipt") {
      totalReceived += g.paymentsToDate;
      totalOutstanding += g.balance;
    } else if (g.direction === "Small Expense")
      smallExpenses += g.paymentsToDate;
    else {
      totalOutgoing += g.paymentsToDate;
      totalPending += g.balance;
    }
  });
  const subtotal = roundMoney(Number(proj.contractSubtotal) || 0);
  const vat = calculateTax(subtotal, "VAT");
  const totalContract = roundMoney(subtotal + vat);
  const balanceExpected = roundMoney(totalContract - totalReceived);
  const netProfit = roundMoney(
    totalReceived - totalOutgoing - smallExpenses - totalPending,
  );
  setAccountsAmounts(
    subtotal,
    totalReceived,
    totalOutgoing,
    smallExpenses,
    totalPending,
    balanceExpected,
    netProfit,
    totalOutstanding,
  );
}

function setAccountsAmounts(
  subtotal,
  received,
  outgoing,
  small,
  pending,
  balance,
  profit,
  outstanding = 0,
) {
  const els = {
    "acc-contract-subtotal": subtotal,
    "acc-client-receipts": received,
    "acc-total-outgoing": outgoing,
    "acc-small-expenses": small,
    "acc-pending-payments": pending,
    "acc-balance-expected": balance,
    "acc-net-profit": profit,
    "acc-outstanding-balance": outstanding,
  };
  for (const [id, val] of Object.entries(els)) {
    const el = document.getElementById(id);
    if (el) el.innerText = "₦" + moneyValue(val);
  }
}