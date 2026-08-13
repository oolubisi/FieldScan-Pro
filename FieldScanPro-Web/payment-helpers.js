// ===== payment-helpers.js =====
function onPaymentDirectionChange() {
  const dir = document.getElementById("pay_dir").value;
  const isSmall = dir === "Small Expense";
  const stagingWrap = document.getElementById("pay_staging_wrap");
  if (stagingWrap) stagingWrap.style.display = isSmall ? "none" : "block";
  const balanceLabel = document.querySelector(
    "#pay_staging_wrap div:nth-child(2) span:first-child",
  );
  if (balanceLabel)
    balanceLabel.innerText =
      dir === "Client Receipt" ? "Outstanding Balance" : "Balance";
  if (isSmall) {
    const totalInput = document.getElementById("pay_total_invoice");
    const amountInput = document.getElementById("pay_amount");
    if (totalInput && amountInput) {
      totalInput.value = amountInput.value || "";
      // ✅ Keep editable for Small Expense
      totalInput.disabled = false;
      totalInput.style.background = "white";
    }
  } else {
    const totalInput = document.getElementById("pay_total_invoice");
    if (totalInput) {
      totalInput.disabled = false;
      totalInput.style.background = "white";
    }
  }
  window.recalcPaymentBalance();
}

function recalcPaymentBalance() {
  const dir = document.getElementById("pay_dir").value;
  const isSmall = dir === "Small Expense";
  const totalInvoice = roundMoney(
    Number(document.getElementById("pay_total_invoice").value) || 0,
  );
  const paymentsToDateEl = document.getElementById("pay_payments_to_date");
  const balanceEl = document.getElementById("pay_balance");
  const stageInput = document.getElementById("pay_stage");
  const amountInput = document.getElementById("pay_amount");
  const groupId = document.getElementById("pay_group_id").value;
  const currentId = document.getElementById("pay_id_hidden").value;
  if (isSmall) {
    if (paymentsToDateEl) paymentsToDateEl.innerText = "₦0.00";
    if (balanceEl) balanceEl.innerText = "₦" + moneyValue(totalInvoice);
    return;
  }
  if (!totalInvoice || totalInvoice <= 0) {
    if (paymentsToDateEl) paymentsToDateEl.innerText = "₦0.00";
    if (balanceEl) balanceEl.innerText = "₦0.00";
    return;
  }
  let paymentsToDate = 0;
  if (groupId) {
    const groupData = getPaymentGroupData(groupId, currentId);
    paymentsToDate = groupData.paymentsToDate;
  }
  const balance = roundMoney(totalInvoice - paymentsToDate);
  if (paymentsToDateEl)
    paymentsToDateEl.innerText = "₦" + moneyValue(paymentsToDate);
  if (balanceEl) {
    balanceEl.innerText = "₦" + moneyValue(balance);
    balanceEl.style.color =
      balance > 0
        ? "var(--primary)"
        : balance < 0
          ? "var(--danger)"
          : "var(--success)";
  }
  if (amountInput && balance >= 0) {
    const currentAmount = roundMoney(Number(amountInput.value) || 0);
    if (currentAmount > balance) {
      amountInput.value = balance;
    }
  }
}

function validateStageAmount() {
  const amountInput = document.getElementById("pay_amount");
  const hint = document.getElementById("pay_amount_hint");
  const balanceEl = document.getElementById("pay_balance");
  if (!amountInput || !balanceEl) return;
  const amount = roundMoney(Number(amountInput.value) || 0);

  // ✅ Small Expense is a single full payment — don't cap it at the balance display
  const dir = document.getElementById("pay_dir")?.value;
  if (dir === "Small Expense") {
    if (hint) hint.style.display = "none";
    return;
  }

  const balanceText = balanceEl.innerText.replace(/[₦,]/g, "");
  const balance = roundMoney(Number(balanceText) || 0);
  if (amount > balance && balance >= 0) {
    amountInput.value = balance;
    if (hint) {
      hint.innerText = `Amount capped at balance: ₦${moneyValue(balance)}`;
      hint.style.display = "block";
      hint.style.color = "var(--danger)";
    }
  } else {
    if (hint) hint.style.display = "none";
  }
}

function getPaymentGroupData(groupId, excludePaymentId) {
  const cache = getCache();
  const payments = cache.payments || [];
  const groupPayments = payments.filter(
    (p) => p.paymentGroupId === groupId && p.paymentId !== excludePaymentId,
  );
  const totalInvoice =
    groupPayments.length > 0
      ? Number(groupPayments[0].totalInvoice) ||
        Number(groupPayments[0].amount) ||
        0
      : 0;
  const paymentsToDate = groupPayments.reduce(
    (sum, p) => roundMoney(sum + Number(p.amount || 0)),
    0,
  );
  return {
    totalInvoice,
    paymentsToDate,
    balance: roundMoney(totalInvoice - paymentsToDate),
    stages: groupPayments.sort(
      (a, b) => Number(a.stage || 0) - Number(b.stage || 0),
    ),
    stageCount: groupPayments.length,
  };
}

function getAllPaymentGroups(projectId) {
  const cache = getCache();
  const payments = (cache.payments || []).filter(
    (p) => p.projectId === projectId,
  );
  const groups = {};
  payments.forEach((p) => {
    const gid = p.paymentGroupId || p.paymentId;
    if (!groups[gid]) {
      groups[gid] = {
        paymentGroupId: gid,
        direction: p.paymentDirection,
        payee: p.payee,
        projectId: p.projectId,
        totalInvoice: Number(p.totalInvoice) || Number(p.amount) || 0,
        stages: [],
        notes: p.notes,
        paymentMethod: p.paymentMethod,
        expenseCategory: p.expenseCategory,
      };
    }
    groups[gid].stages.push(p);
  });
  Object.values(groups).forEach((g) => {
    g.stages.sort((a, b) => Number(a.stage || 0) - Number(b.stage || 0));
    g.paymentsToDate = g.stages.reduce(
      (sum, s) => roundMoney(sum + Number(s.amount || 0)),
      0,
    );
    g.balance = roundMoney(g.totalInvoice - g.paymentsToDate);
  });
  return Object.values(groups).sort((a, b) => {
    const aDate = a.stages[0]?.paymentDate || "";
    const bDate = b.stages[0]?.paymentDate || "";
    return bDate.localeCompare(aDate);
  });
}

function openAddStageModal(groupId) {
  const cache = getCache();
  const payments = cache.payments || [];
  const groupPayments = payments.filter((p) => p.paymentGroupId === groupId);
  if (!groupPayments.length) return;
  const firstPayment = groupPayments[0];
  const groupData = getPaymentGroupData(groupId, "");
  const nextStage = groupData.stageCount + 1;
  if (nextStage > 4) {
    alert("Maximum 4 stages reached for this invoice.");
    return;
  }
  openModalWithRecord("payment", {
    ...firstPayment,
    _addStage: true,
    paymentId: null,
    stage: String(nextStage),
    amount: "",
    notes: "",
    attachments: "",
    paymentGroupId: groupId,
    totalInvoice: groupData.totalInvoice,
  });
}