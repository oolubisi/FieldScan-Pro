// ===== reports.js =====

// Track current report type for layout system
let currentReportType = "";

async function generateReportPDF(orientation) {
  orientation = (orientation || "portrait").toLowerCase();
  const isLandscape = orientation === "landscape" || orientation === "l";
  const jsPdfOrientation = isLandscape ? "landscape" : "portrait";
  const container = document.getElementById("report-print-container");
  if (!container || !container.innerText.trim()) {
    alert("Generate a report first");
    return null;
  }
  if (typeof html2canvas === "undefined" || typeof jspdf === "undefined") {
    alert(
      "PDF libraries not loaded. Add html2canvas and jsPDF CDNs to index.html.",
    );
    return null;
  }

  const originals = {
    display: container.style.display,
    visibility: container.style.visibility,
    position: container.style.position,
    left: container.style.left,
    top: container.style.top,
    width: container.style.width,
    maxWidth: container.style.maxWidth,
    minWidth: container.style.minWidth,
    zIndex: container.style.zIndex,
    background: container.style.background,
    padding: container.style.padding,
  };

  const tables = container.querySelectorAll("table");
  const tableOriginalWidths = [];
  tables.forEach((t, i) => {
    tableOriginalWidths[i] = t.style.width;
    t.style.width = "100%";
    t.style.maxWidth = "none";
  });

  container.style.display = "block";
  container.style.visibility = "visible";
  container.style.position = "fixed";
  container.style.left = "0";
  container.style.top = "0";
  container.style.width = isLandscape ? "267mm" : "180mm";
  container.style.maxWidth = "none";
  container.style.minWidth = isLandscape ? "267mm" : "180mm";
  container.style.zIndex = "-9999";
  container.style.background = "white";
  container.style.padding = "0";
  container.getBoundingClientRect();

  try {
    const pdf = new jspdf.jsPDF(jsPdfOrientation, "mm", "a4");
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = pdf.internal.pageSize.getHeight();
    const margin = 15;
    const pageWidth = pdfWidth - margin * 2;
    const pageHeight = pdfHeight - margin * 2;
    const isFlowingReport = !!container.querySelector(".inspection-report-flow");
    const pages = isFlowingReport
      ? []
      : Array.from(container.querySelectorAll(".report-page-wrapper"));
    const renderTargets = pages.length ? pages : [container];
    const windowWidthPx = isLandscape ? 1009 : 680;

    for (let i = 0; i < renderTargets.length; i++) {
      const target = renderTargets[i];
      const canvas = await html2canvas(target, {
        scale: 1.25,
        useCORS: true,
        logging: false,
        backgroundColor: "#ffffff",
        windowWidth: windowWidthPx,
      });
      const imgData = canvas.toDataURL("image/jpeg", 0.72);
      const imgProps = pdf.getImageProperties(imgData);
      if (isFlowingReport) {
        const ratio = pageWidth / imgProps.width;
        const scaledHeight = imgProps.height * ratio;
        let heightLeft = scaledHeight;
        let position = margin;
        pdf.addImage(imgData, "JPEG", margin, position, pageWidth, scaledHeight, undefined, "FAST");
        heightLeft -= pageHeight;
        while (heightLeft > 2) {
          pdf.addPage();
          position = margin + heightLeft - scaledHeight;
          pdf.addImage(imgData, "JPEG", margin, position, pageWidth, scaledHeight, undefined, "FAST");
          heightLeft -= pageHeight;
        }
        continue;
      }
      const ratio = Math.min(pageWidth / imgProps.width, pageHeight / imgProps.height);
      const imgWidth = imgProps.width * ratio;
      const imgHeight = imgProps.height * ratio;
      if (i > 0) pdf.addPage();
      pdf.addImage(
        imgData,
        "JPEG",
        margin,
        margin,
        imgWidth,
        imgHeight,
        undefined,
        "FAST",
      );
    }
    return pdf;
  } catch (err) {
    console.error("PDF generation failed:", err);
    alert("Failed to generate PDF.");
    return null;
  } finally {
    container.style.display = originals.display;
    container.style.visibility = originals.visibility;
    container.style.position = originals.position;
    container.style.left = originals.left;
    container.style.top = originals.top;
    container.style.width = originals.width;
    container.style.maxWidth = originals.maxWidth;
    container.style.minWidth = originals.minWidth;
    container.style.zIndex = originals.zIndex;
    container.style.background = originals.background;
    container.style.padding = originals.padding;
    tables.forEach((t, i) => {
      t.style.width = tableOriginalWidths[i];
      t.style.maxWidth = "";
    });
  }
}

function printReport() {
  const container = document.getElementById("report-print-container");
  if (!container || !container.innerText.trim()) {
    alert("Generate a report first");
    return;
  }
  const statusEl =
    document.getElementById("inspection-report-status") ||
    document.getElementById("report-status-message");
  const setStatus = (message, type = "info") => {
    if (!statusEl) return;
    statusEl.style.display = message ? "block" : "none";
    statusEl.textContent = message || "";
    statusEl.style.color =
      type === "error"
        ? "var(--danger)"
        : type === "success"
          ? "var(--success)"
          : "var(--muted)";
  };
  if (isElectronApp && window.electronAPI && window.electronAPI.printReport) {
    setStatus("Preparing print dialog...");
    window.electronAPI.printReport(container.innerHTML).then((result) => {
      if (!result || result.success === false) {
        setStatus("Print failed: " + ((result && result.error) || "Unknown error"), "error");
        alert("Print failed: " + ((result && result.error) || "Unknown error"));
      } else {
        setStatus("Print dialog opened.", "success");
      }
    }).catch((err) => {
      setStatus("Print failed: " + (err.message || "Unknown error"), "error");
      alert("Print failed: " + (err.message || "Unknown error"));
    });
    return;
  }
  setStatus("Preparing print dialog...");
  const originals = {
    display: container.style.display,
    visibility: container.style.visibility,
  };
  container.style.display = "block";
  container.style.visibility = "visible";
  const restore = () => {
    container.style.display = originals.display;
    container.style.visibility = originals.visibility;
    window.removeEventListener("afterprint", restore);
  };
  window.addEventListener("afterprint", restore);
  setTimeout(() => window.print(), 50);
}

async function saveReportPDF() {
  const orientSel = document.getElementById("rep-orientation-sel");
  const orientation =
    orientSel && orientSel.value ? orientSel.value : "portrait";
  const pdf = await generateReportPDF(orientation);
  if (pdf) pdf.save("FieldScan_Report.pdf");
}

async function sharePDFNative(pdf, filename, fallbackFn) {
  if (!navigator.canShare || !navigator.share) {
    fallbackFn();
    return;
  }
  const blob = pdf.output("blob");
  const file = new File([blob], filename, { type: "application/pdf" });
  if (navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({
        files: [file],
        title: "FieldScan Pro Report",
        text: "FieldScan Pro Report",
      });
      return;
    } catch (err) {
      if (err.name !== "AbortError") console.error(err);
    }
  }
  fallbackFn();
}

async function shareReport() {
  const orientSel = document.getElementById("rep-orientation-sel");
  const orientation =
    orientSel && orientSel.value ? orientSel.value : "portrait";
  const pdf = await generateReportPDF(orientation);
  if (!pdf) return;
  const isMobile =
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent,
    );
  if (isMobile && navigator.canShare && navigator.share) {
    try {
      const blob = pdf.output("blob");
      const file = new File([blob], "FieldScan_Report.pdf", {
        type: "application/pdf",
      });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: "FieldScan Pro Report",
          text: "FieldScan Pro Report",
        });
        return;
      }
    } catch (err) {
      if (err.name !== "AbortError") console.error("Native share failed:", err);
    }
  }
  pdf.save("FieldScan_Report.pdf");
}

async function initReportsConsoleEngine() {
  const cache = getCache();
  if (!cache.projects || !cache.projects.length) {
    try {
      const projects = await callApi("getProjects", {});
      cache.projects = projects || [];
      setCache(cache);
    } catch (e) {
      console.warn("Could not preload projects for reports:", e);
    }
  }
  const typeSel = document.getElementById("rep-type-sel");
  if (typeSel) {
    typeSel.value = "";
    handleReportScopePopulation();
  }
}

function handleReportScopePopulation() {
  const typeSel = document.getElementById("rep-type-sel");
  const scopeSel = document.getElementById("rep-scope-sel");
  const filterWrap = document.getElementById("rep-filter-wrap");
  const subTypeWrap = document.getElementById("rep-subtype-wrap");

  if (!typeSel || !scopeSel) return;
  scopeSel.style.display = "none";
  const scopeLabel = scopeSel.previousElementSibling;
  if (scopeLabel && scopeLabel.tagName === "LABEL")
    scopeLabel.style.display = "none";
  const type = typeSel.value;
  let validScopes = [];

  if (type === "financial_all") validScopes = ["all"];
  else if (
    type === "financial_project" ||
    type === "scope" ||
    type === "snags" ||
    type === "progress"
  )
    validScopes = ["project"];
  else if (type === "workorder_report") validScopes = ["project"];
  else if (type === "financial_client") validScopes = ["client"];
  else if (type === "financial_vendor") validScopes = ["vendor"];
  else validScopes = ["all", "project", "client", "vendor"];

  const allOptions = [
    { value: "all", text: "All Projects" },
    { value: "project", text: "Specific Project" },
    { value: "client", text: "Specific Client" },
    { value: "vendor", text: "Specific Vendor" },
  ];
  scopeSel.innerHTML = allOptions
    .filter((opt) => validScopes.includes(opt.value))
    .map((opt) => `<option value="${opt.value}">${opt.text}</option>`)
    .join("");
  if (validScopes.length === 1) {
    scopeSel.value = validScopes[0];
    scopeSel.disabled = true;
  } else {
    scopeSel.disabled = false;
    scopeSel.value = validScopes[0];
  }
  if (filterWrap)
    filterWrap.style.display =
      type === "financial_all" || !type ? "none" : "block";
  if (subTypeWrap) subTypeWrap.style.display = "none";
  const woWrap = document.getElementById("rep-workorder-wrap");
  if (woWrap) woWrap.style.display = "none";
  const orientWrap = document.getElementById("rep-orientation-wrap");
  if (orientWrap)
    orientWrap.style.display = type === "financial_all" ? "block" : "none";
  handleReportFilterPopulation();
  updateFieldSelectorVisibility();
}

async function handleReportFilterPopulation() {
  const scopeSel = document.getElementById("rep-scope-sel");
  const filterWrap = document.getElementById("rep-filter-wrap");
  const filterLabel = document.getElementById("rep-filter-label");
  const filterSel = document.getElementById("rep-filter-sel");
  if (!scopeSel || !filterSel || !filterWrap) return;
  const scope = scopeSel.value;
  filterSel.innerHTML = '<option value="">-- Select --</option>';
  const cache = getCache();
  if (scope === "all") {
    filterWrap.style.display = "none";
    return;
  }
  filterWrap.style.display = "block";
  const typeSel = document.getElementById("rep-type-sel");
  if (typeSel && typeSel.value === "workorder_report") {
    filterSel.onchange = () => populateWorkOrderDropdown();
    populateWorkOrderDropdown();
  } else {
    filterSel.onchange = null;
    const woWrap = document.getElementById("rep-workorder-wrap");
    if (woWrap) woWrap.style.display = "none";
  }
  if (scope === "project") {
    filterLabel.innerText = "Select Project";
    const projects = cache.projects || [];
    filterSel.innerHTML += projects
      .map(
        (p) =>
          `<option value="${escapeAttr(p.projectId)}">${escapeHtml(p.clientName)} (${escapeHtml(p.displayNumber || p.projectId)})</option>`,
      )
      .join("");
  } else if (scope === "client") {
    filterLabel.innerText = "Select Client";
    const clients = [
      ...new Set(
        (cache.projects || []).map((p) => p.clientName).filter(Boolean),
      ),
    ].sort();
    filterSel.innerHTML += clients
      .map((c) => `<option value="${escapeAttr(c)}">${escapeHtml(c)}</option>`)
      .join("");
  } else if (scope === "vendor") {
    filterLabel.innerText = "Select Vendor";
    if (!cache.vendors || !cache.vendors.length) {
      try {
        const fetched = await callApi("getVendors", {});
        cache.vendors = fetched || [];
        setCache(cache);
      } catch (e) {}
    }
    const vendors = cache.vendors || [];
    filterSel.innerHTML += vendors
      .map(
        (v) =>
          `<option value="${escapeAttr(v.vendorId)}">${escapeHtml(v.company)}${v.trade ? ` (${escapeHtml(v.trade)})` : ""}</option>`,
      )
      .join("");
  }
}

function updateFieldSelectorVisibility() {
  const type = document.getElementById("rep-type-sel").value;
  let wrap = document.getElementById("rep-field-selector-wrap");
  const btn = document.querySelector('button[onclick*="compileFieldReport"]');
  if (type === "financial_all") {
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.id = "rep-field-selector-wrap";
      wrap.style.marginTop = "15px";
      wrap.innerHTML = `<label style="display:block; font-weight:800; margin-bottom:6px;">Fields to Print</label><div style="display:grid; grid-template-columns: 1fr 1fr; gap:6px; font-size:13px;"><label style="display:flex; align-items:center; gap:6px; cursor:default; opacity:0.7;"><input type="checkbox" class="rep-field-chk" value="project" checked disabled style="width:auto;"> Project (always)</label><label style="display:flex; align-items:center; gap:6px; cursor:pointer;"><input type="checkbox" class="rep-field-chk" value="subtotal" checked style="width:auto;"> Subtotal</label><label style="display:flex; align-items:center; gap:6px; cursor:pointer;"><input type="checkbox" class="rep-field-chk" value="vat" checked style="width:auto;"> VAT</label><label style="display:flex; align-items:center; gap:6px; cursor:pointer;"><input type="checkbox" class="rep-field-chk" value="totalContract" checked style="width:auto;"> Total</label><label style="display:flex; align-items:center; gap:6px; cursor:pointer;"><input type="checkbox" class="rep-field-chk" value="wht" checked style="width:auto;"> WHT</label><label style="display:flex; align-items:center; gap:6px; cursor:pointer;"><input type="checkbox" class="rep-field-chk" value="totalReceived" checked style="width:auto;"> Received</label><label style="display:flex; align-items:center; gap:6px; cursor:pointer;"><input type="checkbox" class="rep-field-chk" value="totalOutgoing" checked style="width:auto;"> Outgoing</label><label style="display:flex; align-items:center; gap:6px; cursor:pointer;"><input type="checkbox" class="rep-field-chk" value="smallExpenses" checked style="width:auto;"> Small Exp.</label><label style="display:flex; align-items:center; gap:6px; cursor:pointer;"><input type="checkbox" class="rep-field-chk" value="totalPending" checked style="width:auto;"> Pending</label><label style="display:flex; align-items:center; gap:6px; cursor:pointer;"><input type="checkbox" class="rep-field-chk" value="balanceExpected" checked style="width:auto;"> Balance</label><label style="display:flex; align-items:center; gap:6px; cursor:pointer;"><input type="checkbox" class="rep-field-chk" value="netProfit" checked style="width:auto;"> Net Profit</label></div>`;
      if (btn && btn.parentNode) btn.parentNode.insertBefore(wrap, btn);
    }
    wrap.style.display = "block";
  } else {
    if (wrap) wrap.style.display = "none";
  }
}

function getSelectedFinancialFields() {
  const checkboxes = document.querySelectorAll(".rep-field-chk:checked");
  const fields = Array.from(checkboxes).map((cb) => cb.value);
  if (!fields.includes("project")) fields.unshift("project");
  return fields;
}

async function generateReportHeader(title, project, settings) {
  // Use layout system if available and a report type is set
  if (typeof getLayoutForReport === "function" && currentReportType) {
    try {
      const layout = getLayoutForReport(currentReportType);
      if (layout && typeof generateLayoutHeader === "function") {
        return await generateLayoutHeader(title, project, layout);
      }
    } catch (e) {}
  }
  // Fallback: original letterhead-style header
  if (settings && settings.data) settings = settings.data;
  if (!settings) {
    const cache = typeof getCache === "function" ? getCache() : {};
    settings =
      cache.settings && cache.settings.data
        ? cache.settings.data
        : cache.settings || {};
  }
  const dateStr = new Date().toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const logoUrl =
    settings && settings.Logo ? await resolveImageToDataUrl(settings.Logo) : "";
  const logoSizeFactor = _getLogoSizeFactor();
  let html = `<div class="report-header" style="border-bottom: 2.5px solid #000; padding-bottom: 2px; margin-bottom: 18px;"><div style="display: flex; justify-content: space-between; align-items: flex-end;">`;
  html += `<div style="flex:1;"><div style="font-size: 11px; color: #495057; font-weight: 600; margin-bottom: 2px;">${escapeHtml(dateStr)}</div><div style="font-size: 16px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #495057; line-height: 1.1;">${escapeHtml(title)}</div></div>`;
  if (logoUrl) {
    html += `<div style="flex-shrink:0; margin-left:16px; text-align:right;"><img src="${escapeAttr(logoUrl)}" style="max-height:${Math.round(120 * logoSizeFactor)}px; max-width:${Math.round(280 * logoSizeFactor)}px; object-fit:contain;" onerror="this.style.display='none'"></div>`;
  }
  html += `</div>`;
  if (project)
    html += `<div style="margin-top: 12px; padding-top: 10px; border-top: 1px solid #adb5bd; font-size: 12px; line-height: 1.6;"><div style="display: grid; grid-template-columns: 1fr 1fr; gap: 2px 20px;"><div><strong style="color:#000;">Client:</strong> ${escapeHtml(project.clientName || "—")}</div><div><strong style="color:#000;">Project ID:</strong> ${escapeHtml(project.projectId || "—")}</div><div><strong style="color:#000;">Location:</strong> ${escapeHtml(project.siteLocation || "—")}</div><div><strong style="color:#000;">Phone:</strong> ${escapeHtml(project.clientPhone || "—")}</div></div></div>`;
  html += `</div>`;
  return html;
}

async function generateFlowReportHeader(title, project, options = {}) {
  const cache = typeof getCache === "function" ? getCache() : {};
  const settings =
    cache.settings && cache.settings.data
      ? cache.settings.data
      : cache.settings || {};
  const logoUrl = settings.Logo ? await resolveImageToDataUrl(settings.Logo) : "";
  const logoSizeFactor = _getLogoSizeFactor();
  const c = _getCompanyDetails();
  const contactLine = `${c.phone1} ${c.phone2} ${c.email}`.trim();
  const dateLine = options.dateLine || "";
  const extraFields = options.extraFieldsHtml || "";
  return `<div class="report-header inspection-report-header" style="padding-bottom:10px; margin-bottom:18px;">
    <div style="display:flex; justify-content:space-between; align-items:flex-end; gap:18px;">
      <div style="flex:1;">
        ${dateLine ? `<div style="font-size:11px; color:#495057; font-weight:600; margin-bottom:2px;">${escapeHtml(dateLine)}</div>` : ""}
        <div style="font-size:19px; font-weight:800; text-transform:uppercase; letter-spacing:0.6px; color:#212529; line-height:1.1;">${escapeHtml(title)}</div>
      </div>
      <div style="flex-shrink:0; text-align:right;">
        ${logoUrl ? `<img src="${escapeAttr(logoUrl)}" style="max-height:${Math.round(86 * logoSizeFactor)}px; max-width:${Math.round(210 * logoSizeFactor)}px; object-fit:contain;" onerror="this.style.display='none'">` : ""}
        <div style="font-size:10px; color:#495057; font-weight:700; margin-top:4px; white-space:nowrap;">${escapeHtml(contactLine)}</div>
      </div>
    </div>
    <div style="margin-top:14px; padding:12px 14px; background:#f8f9fa; border:1px solid #dee2e6; border-radius:8px; font-size:12px; line-height:1.6;">
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:2px 20px;">
        <div><strong style="color:#000;">Client:</strong> ${escapeHtml(project.clientName || "—")}</div>
        <div><strong style="color:#000;">Project ID:</strong> ${escapeHtml(project.projectId || "—")}</div>
        <div><strong style="color:#000;">Location:</strong> ${escapeHtml(project.siteLocation || "—")}</div>
        ${extraFields}
      </div>
    </div>
  </div>`;
}

function generateSignatureBlock() {
  if (typeof getLayoutForReport === "function" && currentReportType) {
    try {
      const layout = getLayoutForReport(currentReportType);
      if (layout && typeof generateLayoutSignature === "function") {
        return generateLayoutSignature(layout);
      }
    } catch (e) {}
  }
  return `<div style="margin-top: 32px; page-break-inside: avoid;">
    <div style="font-size: 12px; font-weight: 700; text-transform: uppercase; margin-bottom: 12px; color: #495057;">Authorized Signatory</div>
    <div style="display: inline-block; text-align: center;">
      <div style="border-bottom: 1.5px solid #000; width: 200px; margin: 0 auto 4px auto;"></div>
      <div style="font-size: 12px; font-weight: 700;">_________________________</div>
    </div>
  </div>`;
}

function generateReportFooter() {
  if (typeof getLayoutForReport === "function" && currentReportType) {
    try {
      const layout = getLayoutForReport(currentReportType);
      if (layout && typeof generateLayoutFooter === "function") {
        return generateLayoutFooter(layout);
      }
    } catch (e) {}
  }
  const c = _getCompanyDetails();
  return `<div class="report-footer">
    <div>${escapeHtml(c.address)}</div>
    <div>${escapeHtml(c.phone1)}&nbsp;&nbsp;&nbsp;${escapeHtml(c.phone2)}&nbsp;&nbsp;&nbsp;${escapeHtml(c.email)}</div>
  </div>`;
}

// Wraps report content in the standard page wrapper with a pinned footer.
// All render functions that don't have their own wrapper should use this.
function wrapReportPage(content) {
  return `<div class="report-page-wrapper">
    <div class="report-content" style="padding-bottom:22mm;">${content}</div>
    ${generateReportFooter()}
  </div>`;
}

function computeProjectFinancials(project, payments) {
  const pId = project.projectId;
  const groups = getAllPaymentGroups(pId);
  const subtotal = roundMoney(Number(project.contractSubtotal) || 0);
  const vat = calculateTax(subtotal, "VAT");
  const wht = calculateTax(subtotal, "WHT");
  const totalContract = roundMoney(subtotal + vat);
  const netReceivable = roundMoney(totalContract - wht);
  let totalReceived = 0,
    totalOutgoing = 0,
    smallExpenses = 0,
    totalPending = 0;
  groups.forEach((g) => {
    if (g.direction === "Client Receipt") totalReceived += g.paymentsToDate;
    else if (g.direction === "Small Expense") smallExpenses += g.paymentsToDate;
    else {
      totalOutgoing += g.paymentsToDate;
      totalPending += g.balance;
    }
  });
  totalReceived = roundMoney(totalReceived);
  totalOutgoing = roundMoney(totalOutgoing);
  smallExpenses = roundMoney(smallExpenses);
  totalPending = roundMoney(totalPending);
  const balanceExpected = roundMoney(totalContract - totalReceived);
  const netProfit = roundMoney(
    totalReceived - totalOutgoing - smallExpenses - totalPending,
  );
  return {
    subtotal,
    vat,
    wht,
    totalContract,
    netReceivable,
    totalReceived,
    totalOutgoing,
    smallExpenses,
    totalPending,
    balanceExpected,
    netProfit,
  };
}

function financialRowHTML(label, amount, isBold, color) {
  const style = isBold
    ? "font-weight: 900; border-top: 1.5px solid #000; padding-top: 6px; margin-top: 6px;"
    : "";
  const colorStyle = color ? `color: ${color};` : "";
  return `<div style="display: flex; justify-content: space-between; margin-bottom: 4px; ${style}"><span style="font-weight: ${isBold ? "900" : "600"}; font-size: ${isBold ? "14px" : "13px"};">${escapeHtml(label)}</span><span style="font-weight: ${isBold ? "900" : "700"}; font-size: ${isBold ? "15px" : "13px"}; text-align: right; ${colorStyle}">₦${moneyValue(amount)}</span></div>`;
}

async function renderFinancialAll(projects, payments, selectedFields) {
  const allCols = [
    {
      key: "project",
      label: "Project",
      thStyle: "text-align:left;",
      tdStyle: "vertical-align:top;",
    },
    {
      key: "subtotal",
      label: "Subtotal",
      thStyle: "text-align:right;",
      tdStyle: "text-align:right; vertical-align:top;",
    },
    {
      key: "vat",
      label: "VAT",
      thStyle: "text-align:right;",
      tdStyle: "text-align:right; vertical-align:top;",
    },
    {
      key: "totalContract",
      label: "Total",
      thStyle: "text-align:right;",
      tdStyle: "text-align:right; vertical-align:top; font-weight:800;",
    },
    {
      key: "wht",
      label: "WHT",
      thStyle: "text-align:right;",
      tdStyle: "text-align:right; vertical-align:top;",
    },
    {
      key: "totalReceived",
      label: "Received",
      thStyle: "text-align:right;",
      tdStyle:
        "text-align:right; vertical-align:top; color:var(--success); font-weight:700;",
    },
    {
      key: "totalOutgoing",
      label: "Outgoing",
      thStyle: "text-align:right;",
      tdStyle:
        "text-align:right; vertical-align:top; color:var(--danger); font-weight:700;",
    },
    {
      key: "smallExpenses",
      label: "Small Exp.",
      thStyle: "text-align:right;",
      tdStyle: "text-align:right; vertical-align:top;",
    },
    {
      key: "totalPending",
      label: "Pending",
      thStyle: "text-align:right;",
      tdStyle:
        "text-align:right; vertical-align:top; color:#fd7e14; font-weight:700;",
    },
    {
      key: "balanceExpected",
      label: "Balance",
      thStyle: "text-align:right;",
      tdStyle: "text-align:right; vertical-align:top;",
    },
    {
      key: "netProfit",
      label: "Net Profit",
      thStyle: "text-align:right;",
      tdStyle: "text-align:right; vertical-align:top; font-weight:800;",
    },
  ];
  const cols = allCols.filter((c) => selectedFields.includes(c.key));
  const thead = `<tr>${cols.map((c) => `<th style="background:#000; color:#fff; ${c.thStyle} padding:8px; font-weight:700; text-transform:uppercase; font-size:10px;">${c.label}</th>`).join("")}</tr>`;
  let tSub = 0,
    tVat = 0,
    tWht = 0,
    tCon = 0,
    tRec = 0,
    tOut = 0,
    tSml = 0,
    tPen = 0,
    tBal = 0,
    tPro = 0;
  const cellMapFn = (f) => ({
    project: `<td style="border-bottom:1px solid #adb5bd; padding:8px; font-size:12px; ${cols.find((c) => c.key === "project")?.tdStyle || ""}"><strong>${escapeHtml(f.projectId)}</strong><br><span style="font-size:11px; color:#495057;">${escapeHtml(f.clientName)}</span></td>`,
    subtotal: `<td style="border-bottom:1px solid #adb5bd; padding:8px; font-size:12px; text-align:right; vertical-align:top;">₦${moneyValue(f.subtotal)}</td>`,
    vat: `<td style="border-bottom:1px solid #adb5bd; padding:8px; font-size:12px; text-align:right; vertical-align:top;">₦${moneyValue(f.vat)}</td>`,
    totalContract: `<td style="border-bottom:1px solid #adb5bd; padding:8px; font-size:12px; text-align:right; vertical-align:top; font-weight:800;">₦${moneyValue(f.totalContract)}</td>`,
    wht: `<td style="border-bottom:1px solid #adb5bd; padding:8px; font-size:12px; text-align:right; vertical-align:top;">₦${moneyValue(f.wht)}</td>`,
    totalReceived: `<td style="border-bottom:1px solid #adb5bd; padding:8px; font-size:12px; text-align:right; vertical-align:top; color:var(--success); font-weight:700;">₦${moneyValue(f.totalReceived)}</td>`,
    totalOutgoing: `<td style="border-bottom:1px solid #adb5bd; padding:8px; font-size:12px; text-align:right; vertical-align:top; color:var(--danger); font-weight:700;">₦${moneyValue(f.totalOutgoing)}</td>`,
    smallExpenses: `<td style="border-bottom:1px solid #adb5bd; padding:8px; font-size:12px; text-align:right; vertical-align:top;">₦${moneyValue(f.smallExpenses)}</td>`,
    totalPending: `<td style="border-bottom:1px solid #adb5bd; padding:8px; font-size:12px; text-align:right; vertical-align:top; color:#fd7e14; font-weight:700;">₦${moneyValue(f.totalPending)}</td>`,
    balanceExpected: `<td style="border-bottom:1px solid #adb5bd; padding:8px; font-size:12px; text-align:right; vertical-align:top;">₦${moneyValue(f.balanceExpected)}</td>`,
    netProfit: `<td style="border-bottom:1px solid #adb5bd; padding:8px; font-size:12px; text-align:right; vertical-align:top; font-weight:800; color:${f.netProfit >= 0 ? "var(--success)" : "var(--danger)"};">₦${moneyValue(f.netProfit)}</td>`,
  });
  const totalMapFn = () => ({
    project: `<td style="border-bottom:2px solid #000; padding:8px; font-size:12px;"><strong>GRAND TOTAL</strong></td>`,
    subtotal: `<td style="border-bottom:2px solid #000; padding:8px; font-size:12px; text-align:right;">₦${moneyValue(tSub)}</td>`,
    vat: `<td style="border-bottom:2px solid #000; padding:8px; font-size:12px; text-align:right;">₦${moneyValue(tVat)}</td>`,
    totalContract: `<td style="border-bottom:2px solid #000; padding:8px; font-size:12px; text-align:right;">₦${moneyValue(tCon)}</td>`,
    wht: `<td style="border-bottom:2px solid #000; padding:8px; font-size:12px; text-align:right;">₦${moneyValue(tWht)}</td>`,
    totalReceived: `<td style="border-bottom:2px solid #000; padding:8px; font-size:12px; text-align:right; color:var(--success);">₦${moneyValue(tRec)}</td>`,
    totalOutgoing: `<td style="border-bottom:2px solid #000; padding:8px; font-size:12px; text-align:right; color:var(--danger);">₦${moneyValue(tOut)}</td>`,
    smallExpenses: `<td style="border-bottom:2px solid #000; padding:8px; font-size:12px; text-align:right;">₦${moneyValue(tSml)}</td>`,
    totalPending: `<td style="border-bottom:2px solid #000; padding:8px; font-size:12px; text-align:right; color:#fd7e14;">₦${moneyValue(tPen)}</td>`,
    balanceExpected: `<td style="border-bottom:2px solid #000; padding:8px; font-size:12px; text-align:right;">₦${moneyValue(tBal)}</td>`,
    netProfit: `<td style="border-bottom:2px solid #000; padding:8px; font-size:12px; text-align:right; color:${tPro >= 0 ? "var(--success)" : "var(--danger)"};">₦${moneyValue(tPro)}</td>`,
  });
  const rows = projects
    .map((p) => {
      const f = computeProjectFinancials(p, payments);
      tSub = roundMoney(tSub + f.subtotal);
      tVat = roundMoney(tVat + f.vat);
      tWht = roundMoney(tWht + f.wht);
      tCon = roundMoney(tCon + f.totalContract);
      tRec = roundMoney(tRec + f.totalReceived);
      tOut = roundMoney(tOut + f.totalOutgoing);
      tSml = roundMoney(tSml + f.smallExpenses);
      tPen = roundMoney(tPen + f.totalPending);
      tBal = roundMoney(tBal + f.balanceExpected);
      tPro = roundMoney(tPro + f.netProfit);
      const cells = cellMapFn({
        ...f,
        projectId: p.projectId,
        clientName: p.clientName,
      });
      return `<tr>${cols.map((c) => cells[c.key]).join("")}</tr>`;
    })
    .join("");
  const totalCells = totalMapFn();
  const totalRow = `<tr style="background:#e9ecef; font-weight:900;">${cols.map((c) => totalCells[c.key]).join("")}</tr>`;
  const table = `<table class="report-table" style="width:100%; border-collapse: collapse; font-size:12px;"><thead>${thead}</thead><tbody>${rows || `<tr><td colspan="${cols.length}" style="padding:20px; text-align:center; color:#495057;">No projects</td></tr>`}${totalRow}</tbody></table>`;
  return `<div class="report-page-wrapper">
    <div class="report-content" style="padding-bottom:22mm;">
      ${await generateReportHeader("Financial Summary — All Projects", null)}
      ${table}
      ${generateSignatureBlock()}
    </div>
    ${generateReportFooter()}
  </div>`;
}

function paymentDetailRowsHTML(payments) {
  const sorted = [...payments].sort((a, b) =>
    String(a.paymentDate || "").localeCompare(String(b.paymentDate || "")),
  );
  const rows = sorted
    .map((p) => {
      const incoming = p.paymentDirection === "Client Receipt";
      const isSmall = p.paymentDirection === "Small Expense";
      const sign = incoming ? "+" : "-";
      const color = incoming
        ? "var(--success)"
        : isSmall
          ? "var(--muted)"
          : "var(--danger)";
      const who = isSmall ? p.expenseCategory || "Expense" : p.payee || "—";
      const stageTxt = p.stage ? `Stage ${escapeHtml(p.stage)}` : "";
      return `<tr>
        <td style="border-bottom:1px solid #adb5bd; padding:8px; font-size:12px;">${escapeHtml(p.paymentDate || "—")}</td>
        <td style="border-bottom:1px solid #adb5bd; padding:8px; font-size:12px;">${escapeHtml(who)}</td>
        <td style="border-bottom:1px solid #adb5bd; padding:8px; font-size:12px;">${escapeHtml(p.paymentDirection || "—")}${stageTxt ? " · " + stageTxt : ""}</td>
        <td style="border-bottom:1px solid #adb5bd; padding:8px; font-size:12px; text-align:center;">${escapeHtml(p.status || "—")}</td>
        <td style="border-bottom:1px solid #adb5bd; padding:8px; font-size:12px; text-align:right; font-weight:700; color:${color};">${sign}₦${moneyValue(p.amount)}</td>
      </tr>`;
    })
    .join("");
  return `<table class="report-table" style="width:100%; border-collapse: collapse; font-size:12px; margin-top:8px;">
    <thead><tr>
      <th style="background:#000; color:#fff; text-align:left; padding:8px; font-size:10px; text-transform:uppercase;">Date</th>
      <th style="background:#000; color:#fff; text-align:left; padding:8px; font-size:10px; text-transform:uppercase;">Payee / Category</th>
      <th style="background:#000; color:#fff; text-align:left; padding:8px; font-size:10px; text-transform:uppercase;">Direction</th>
      <th style="background:#000; color:#fff; text-align:center; padding:8px; font-size:10px; text-transform:uppercase;">Status</th>
      <th style="background:#000; color:#fff; text-align:right; padding:8px; font-size:10px; text-transform:uppercase;">Amount</th>
    </tr></thead>
    <tbody>${rows || '<tr><td colspan="5" style="padding:8px; text-align:center; color:#495057;">No payments recorded</td></tr>'}</tbody>
  </table>`;
}

async function renderFinancialProject(project, payments) {
  const f = computeProjectFinancials(project, payments);
  const projectPayments = payments.filter(
    (p) => p.projectId === project.projectId,
  );
  return wrapReportPage(
    `${await generateReportHeader("Financial Report — Project", project)}<div style="max-width: 420px; margin: 0 auto;">${financialRowHTML("Contract Subtotal", f.subtotal)}${financialRowHTML("VAT (" + formatTaxRate(getTaxRate("VAT")) + ")", f.vat)}${financialRowHTML("Total Contract Value", f.totalContract, true)}${financialRowHTML("WHT (" + formatTaxRate(getTaxRate("WHT")) + ")", f.wht)}${financialRowHTML("Net Receivable (after WHT)", f.netReceivable, true)}<div style="height: 10px;"></div>${financialRowHTML("Client Receipts (Cleared)", f.totalReceived, false, "var(--success)")}${financialRowHTML("Total Outgoing (Cleared)", f.totalOutgoing, false, "var(--danger)")}${financialRowHTML("Small Expenses (Cleared)", f.smallExpenses)}${financialRowHTML("Pending Payments", f.totalPending, false, "#fd7e14")}<div style="height: 10px;"></div>${financialRowHTML("Balance Expected", f.balanceExpected, true)}${financialRowHTML("Net Profit", f.netProfit, true, f.netProfit >= 0 ? "var(--success)" : "var(--danger)")}</div><h3 style="font-size: 14px; font-weight: 900; text-transform: uppercase; margin: 24px 0 8px; border-bottom: 1px solid #000; padding-bottom: 4px;">Payment Details</h3>${paymentDetailRowsHTML(projectPayments)}`,
  );
}

async function renderFinancialClient(clientName, projects, payments) {
  const clientProjects = projects.filter((p) => p.clientName === clientName);
  let tSub = 0,
    tVat = 0,
    tWht = 0,
    tCon = 0,
    tRec = 0,
    tOut = 0,
    tSml = 0,
    tPen = 0,
    tBal = 0,
    tPro = 0;
  const rows = clientProjects
    .map((p) => {
      const f = computeProjectFinancials(p, payments);
      tSub += f.subtotal;
      tVat += f.vat;
      tWht += f.wht;
      tCon += f.totalContract;
      tRec += f.totalReceived;
      tOut += f.totalOutgoing;
      tSml += f.smallExpenses;
      tPen += f.totalPending;
      tBal += f.balanceExpected;
      tPro += f.netProfit;
      return `<tr><td style="border-bottom:1px solid #adb5bd; padding:8px; font-size:12px; vertical-align:top;"><strong>${escapeHtml(p.displayNumber || p.projectId)}</strong><br><span style="font-size:11px; color:#495057;">${escapeHtml(p.siteLocation)}</span></td><td style="border-bottom:1px solid #adb5bd; padding:8px; font-size:12px; text-align:right; vertical-align:top;">₦${moneyValue(f.subtotal)}</td><td style="border-bottom:1px solid #adb5bd; padding:8px; font-size:12px; text-align:right; vertical-align:top;">₦${moneyValue(f.vat)}</td><td style="border-bottom:1px solid #adb5bd; padding:8px; font-size:12px; text-align:right; vertical-align:top; font-weight:800;">₦${moneyValue(f.totalContract)}</td><td style="border-bottom:1px solid #adb5bd; padding:8px; font-size:12px; text-align:right; vertical-align:top;">₦${moneyValue(f.wht)}</td><td style="border-bottom:1px solid #adb5bd; padding:8px; font-size:12px; text-align:right; vertical-align:top; color:var(--success); font-weight:700;">₦${moneyValue(f.totalReceived)}</td><td style="border-bottom:1px solid #adb5bd; padding:8px; font-size:12px; text-align:right; vertical-align:top; color:var(--danger); font-weight:700;">₦${moneyValue(f.totalOutgoing)}</td><td style="border-bottom:1px solid #adb5bd; padding:8px; font-size:12px; text-align:right; vertical-align:top;">₦${moneyValue(f.smallExpenses)}</td><td style="border-bottom:1px solid #adb5bd; padding:8px; font-size:12px; text-align:right; vertical-align:top; color:#fd7e14; font-weight:700;">₦${moneyValue(f.totalPending)}</td><td style="border-bottom:1px solid #adb5bd; padding:8px; font-size:12px; text-align:right; vertical-align:top;">₦${moneyValue(f.balanceExpected)}</td><td style="border-bottom:1px solid #adb5bd; padding:8px; font-size:12px; text-align:right; vertical-align:top; font-weight:800; color:${f.netProfit >= 0 ? "var(--success)" : "var(--danger)"};">₦${moneyValue(f.netProfit)}</td></tr>`;
    })
    .join("");
  tSub = roundMoney(tSub);
  tVat = roundMoney(tVat);
  tWht = roundMoney(tWht);
  tCon = roundMoney(tCon);
  tRec = roundMoney(tRec);
  tOut = roundMoney(tOut);
  tSml = roundMoney(tSml);
  tPen = roundMoney(tPen);
  tBal = roundMoney(tBal);
  tPro = roundMoney(tPro);
  return wrapReportPage(
    `${await generateReportHeader(`Financial Report — Client: ${clientName}`, null)}<table class="report-table" style="width:100%; border-collapse: collapse; font-size:12px;"><thead><tr><th style="background:#000; color:#fff; text-align:left; padding:8px; font-weight:700; text-transform:uppercase; font-size:10px;">Project</th><th style="background:#000; color:#fff; text-align:right; padding:8px; font-weight:700; text-transform:uppercase; font-size:10px;">Subtotal</th><th style="background:#000; color:#fff; text-align:right; padding:8px; font-weight:700; text-transform:uppercase; font-size:10px;">VAT</th><th style="background:#000; color:#fff; text-align:right; padding:8px; font-weight:700; text-transform:uppercase; font-size:10px;">Total</th><th style="background:#000; color:#fff; text-align:right; padding:8px; font-weight:700; text-transform:uppercase; font-size:10px;">WHT</th><th style="background:#000; color:#fff; text-align:right; padding:8px; font-weight:700; text-transform:uppercase; font-size:10px;">Received</th><th style="background:#000; color:#fff; text-align:right; padding:8px; font-weight:700; text-transform:uppercase; font-size:10px;">Outgoing</th><th style="background:#000; color:#fff; text-align:right; padding:8px; font-weight:700; text-transform:uppercase; font-size:10px;">Small Exp.</th><th style="background:#000; color:#fff; text-align:right; padding:8px; font-weight:700; text-transform:uppercase; font-size:10px;">Pending</th><th style="background:#000; color:#fff; text-align:right; padding:8px; font-weight:700; text-transform:uppercase; font-size:10px;">Balance</th><th style="background:#000; color:#fff; text-align:right; padding:8px; font-weight:700; text-transform:uppercase; font-size:10px;">Net Profit</th></tr></thead><tbody>${rows || '<tr><td colspan="11" style="padding:20px; text-align:center; color:#495057;">No projects</td></tr>'}<tr style="background:#e9ecef; font-weight:900;"><td style="border-bottom:2px solid #000; padding:8px; font-size:12px;"><strong>TOTAL</strong></td><td style="border-bottom:2px solid #000; padding:8px; font-size:12px; text-align:right;">₦${moneyValue(tSub)}</td><td style="border-bottom:2px solid #000; padding:8px; font-size:12px; text-align:right;">₦${moneyValue(tVat)}</td><td style="border-bottom:2px solid #000; padding:8px; font-size:12px; text-align:right;">₦${moneyValue(tCon)}</td><td style="border-bottom:2px solid #000; padding:8px; font-size:12px; text-align:right;">₦${moneyValue(tWht)}</td><td style="border-bottom:2px solid #000; padding:8px; font-size:12px; text-align:right; color:var(--success);">₦${moneyValue(tRec)}</td><td style="border-bottom:2px solid #000; padding:8px; font-size:12px; text-align:right; color:var(--danger);">₦${moneyValue(tOut)}</td><td style="border-bottom:2px solid #000; padding:8px; font-size:12px; text-align:right;">₦${moneyValue(tSml)}</td><td style="border-bottom:2px solid #000; padding:8px; font-size:12px; text-align:right; color:#fd7e14;">₦${moneyValue(tPen)}</td><td style="border-bottom:2px solid #000; padding:8px; font-size:12px; text-align:right;">₦${moneyValue(tBal)}</td><td style="border-bottom:2px solid #000; padding:8px; font-size:12px; text-align:right; color:${tPro >= 0 ? "var(--success)" : "var(--danger)"};">₦${moneyValue(tPro)}</td></tr></tbody></table>`,
  );
}

async function renderFinancialVendor(vendor, projects, workorders, payments) {
  const vendorWorkorders = workorders.filter(
    (w) => w.vendorId === vendor.vendorId,
  );
  const vendorPayments = payments.filter(
    (p) => p.payee === vendor.company || p.vendorId === vendor.vendorId,
  );
  const totalWO = vendorWorkorders.reduce(
    (s, w) => roundMoney(s + Number(w.amount || 0)),
    0,
  );
  // A payment's status ("Cleared" vs "Pending") describes whether the
  // invoice GROUP it belongs to is fully settled yet — not whether that
  // individual payment actually happened. Every row in Payments is real
  // money paid out, including partial/installment payments logged against
  // a "Pending" (not-yet-fully-settled) invoice group. Filtering those out
  // of the total understated how much the vendor has actually been paid.
  const totalPaid = vendorPayments
    .filter((p) => !isClientReceipt(p))
    .reduce((s, p) => roundMoney(s + Number(p.amount || 0)), 0);
  const balance = roundMoney(totalWO - totalPaid);
  const woRows = vendorWorkorders
    .map((w) => {
      const proj = projects.find((p) => p.projectId === w.projectId);
      return `<tr><td style="border-bottom:1px solid #adb5bd; padding:8px; font-size:12px;">${escapeHtml(w.workOrderId)}</td><td style="border-bottom:1px solid #adb5bd; padding:8px; font-size:12px;">${escapeHtml(proj ? proj.projectId : w.projectId)}</td><td style="border-bottom:1px solid #adb5bd; padding:8px; font-size:12px; text-align:right; font-weight:700;">₦${moneyValue(w.amount)}</td><td style="border-bottom:1px solid #adb5bd; padding:8px; font-size:12px; text-align:center;">${escapeHtml(w.status)}</td></tr>`;
    })
    .join("");
  const payRows = vendorPayments
    .map((p) => {
      const proj = projects.find((pr) => pr.projectId === p.projectId);
      return `<tr><td style="border-bottom:1px solid #adb5bd; padding:8px; font-size:12px;">${escapeHtml(p.paymentDate)}</td><td style="border-bottom:1px solid #adb5bd; padding:8px; font-size:12px;">${escapeHtml(proj ? proj.projectId : p.projectId)}</td><td style="border-bottom:1px solid #adb5bd; padding:8px; font-size:12px;">${escapeHtml(p.expenseCategory || "-")}</td><td style="border-bottom:1px solid #adb5bd; padding:8px; font-size:12px; text-align:right; font-weight:700;">₦${moneyValue(p.amount)}</td><td style="border-bottom:1px solid #adb5bd; padding:8px; font-size:12px; text-align:center;">${escapeHtml(p.status)}</td></tr>`;
    })
    .join("");
  return wrapReportPage(
    `${await generateReportHeader(`Financial Report — Vendor: ${vendor.company}`, null)}<div style="margin-bottom: 16px; font-size: 12px; line-height: 1.6;"><div><strong>Trade:</strong> ${escapeHtml(vendor.trade || "—")}</div><div><strong>Contact:</strong> ${escapeHtml(vendor.contactName || "—")}</div><div><strong>Phone:</strong> ${escapeHtml(vendor.phone1 || "—")}</div><div><strong>Email:</strong> ${escapeHtml(vendor.email || "—")}</div></div><h3 style="font-size: 14px; font-weight: 900; text-transform: uppercase; margin: 16px 0 8px; border-bottom: 1px solid #000; padding-bottom: 4px;">Work Orders</h3><table class="report-table" style="width:100%; border-collapse: collapse; font-size:12px; margin-bottom: 16px;"><thead><tr><th style="background:#000; color:#fff; text-align:left; padding:8px; font-size:10px; text-transform:uppercase;">WO ID</th><th style="background:#000; color:#fff; text-align:left; padding:8px; font-size:10px; text-transform:uppercase;">Project</th><th style="background:#000; color:#fff; text-align:right; padding:8px; font-size:10px; text-transform:uppercase;">Amount</th><th style="background:#000; color:#fff; text-align:center; padding:8px; font-size:10px; text-transform:uppercase;">Status</th></tr></thead><tbody>${woRows || '<tr><td colspan="4" style="padding:8px; text-align:center; color:#495057;">No work orders</td></tr>'}<tr style="background:#e9ecef; font-weight:900;"><td colspan="2" style="border-bottom:2px solid #000; padding:8px; font-size:12px;"><strong>TOTAL</strong></td><td style="border-bottom:2px solid #000; padding:8px; font-size:12px; text-align:right;">₦${moneyValue(totalWO)}</td><td style="border-bottom:2px solid #000; padding:8px;"></td></tr></tbody></table><h3 style="font-size: 14px; font-weight: 900; text-transform: uppercase; margin: 16px 0 8px; border-bottom: 1px solid #000; padding-bottom: 4px;">Payments</h3><table class="report-table" style="width:100%; border-collapse: collapse; font-size:12px; margin-bottom: 16px;"><thead><tr><th style="background:#000; color:#fff; text-align:left; padding:8px; font-size:10px; text-transform:uppercase;">Date</th><th style="background:#000; color:#fff; text-align:left; padding:8px; font-size:10px; text-transform:uppercase;">Project</th><th style="background:#000; color:#fff; text-align:left; padding:8px; font-size:10px; text-transform:uppercase;">Category</th><th style="background:#000; color:#fff; text-align:right; padding:8px; font-size:10px; text-transform:uppercase;">Amount</th><th style="background:#000; color:#fff; text-align:center; padding:8px; font-size:10px; text-transform:uppercase;">Status</th></tr></thead><tbody>${payRows || '<tr><td colspan="5" style="padding:8px; text-align:center; color:#495057;">No payments</td></tr>'}<tr style="background:#e9ecef; font-weight:900;"><td colspan="3" style="border-bottom:2px solid #000; padding:8px; font-size:12px;"><strong>TOTAL PAID</strong></td><td style="border-bottom:2px solid #000; padding:8px; font-size:12px; text-align:right;">₦${moneyValue(totalPaid)}</td><td style="border-bottom:2px solid #000; padding:8px;"></td></tr></tbody></table><div style="max-width: 350px; margin: 20px 0 0 auto;">${financialRowHTML("Total Work Order Value", totalWO, true)}${financialRowHTML("Total Paid", totalPaid, false, "var(--danger)")}${financialRowHTML("Balance / Outstanding", balance, true, balance > 0 ? "var(--danger)" : "var(--success)")}</div>`,
  );
}

async function renderScopeReport(project, settings) {
  // Normalize: getSettings returns {data: {...}} or the cache may hold the raw response
  if (settings && settings.data) settings = settings.data;
  const c = _getCompanyDetails();
  // Per-user signature first, falling back to the company-wide one.
  const signName = escapeHtml(await _getSignatoryName());
  const signImg = await _getSignImageUrl();
  const hasSignature = signName || signImg;

  let signatureBlock = "";
  if (hasSignature) {
    signatureBlock = `<div style="margin-top: 32px; page-break-inside: avoid; text-align: left;">
      <div style="display: inline-block; text-align: center;">
        ${signImg ? `<div style="margin-bottom: 2px;"><img src="${escapeAttr(signImg)}" style="max-height:50px; max-width:150px; object-fit:contain;" onerror="this.style.display='none'"></div>` : ""}
        <div style="font-size: 12px; font-weight: 700;">${signName || "_________________________"}</div>
      </div>
    </div>`;
  }

  return `<div class="report-page-wrapper">
    <div class="report-content" style="padding-bottom:22mm;">
      ${await generateReportHeader("Project Scope", project, settings)}
      <div style="font-size: 13px; line-height: 1.6; white-space: pre-wrap;">${escapeHtml(project.scope || "No scope defined.")}</div>
      ${signatureBlock}
    </div>
    <div class="report-footer">
      <div style="font-weight: 700; margin-bottom: 4px;">${escapeHtml(c.address)}</div>
      <div>${escapeHtml(c.phone1)}&nbsp;&nbsp;&nbsp;${escapeHtml(c.phone2)}&nbsp;&nbsp;&nbsp;${escapeHtml(c.email)}</div>
    </div>
  </div>`;
}

/**
 * Shared photo-grid pagination: first photo page holds up to 4 boxes,
 * every page after holds up to 6. A box only renders when there's an
 * actual photo behind it — no empty placeholder cards. Used by both the
 * Snags Report and the Inspection Report so they stay visually identical
 * apart from title/content around them.
 *
 * `photos` should already be filtered to the relevant category and have
 * a driveFileId (local-only/not-yet-synced photos have nothing to embed,
 * so they're dropped here rather than shown as a broken image).
 */
async function buildPhotoGridPages(project, photos, reportTitle, options = {}) {
  const usable = (photos || [])
    .filter((p) => p.driveFileId)
    .sort((a, b) => (Number(a.capturedAt) || 0) - (Number(b.capturedAt) || 0));

  const FIRST_PAGE_BOXES = options.firstPageBoxes || 4;
  const OTHER_PAGE_BOXES = options.otherPageBoxes || 6;
  const pageClass = options.pageClass || "snags-report-page";
  const gridClassName = options.gridClassName || "snags-report-grid";
  const firstGridClassName = options.firstGridClassName || "snags-report-grid-4";
  const includeFooter = options.includeFooter !== false;
  const wrapperClass = includeFooter ? "report-page-wrapper" : "inspection-photo-chunk";
  const contentStyle = includeFooter ? ' style="padding-bottom:22mm;"' : "";
  const pages = [];
  if (usable.length) {
    pages.push(usable.slice(0, FIRST_PAGE_BOXES));
    let i = FIRST_PAGE_BOXES;
    while (i < usable.length) {
      pages.push(usable.slice(i, i + OTHER_PAGE_BOXES));
      i += OTHER_PAGE_BOXES;
    }
  }

  if (!pages.length) return { html: "", hasPhotos: false };

  // Resolve every photo's real image data first (see resolveImageToDataUrl
  // in utils.js — the plain driveFileId URL doesn't render as an <img> on
  // its own). Done once up front, in parallel, rather than per-box.
  const resolvedByPhotoId = {};
  await Promise.all(
    usable.map(async (p) => {
      const resolved = await resolveImageToDataUrl(p.driveFileId);
      resolvedByPhotoId[p.photoId] =
        resolved && typeof compressImageToTargetLimit === "function"
          ? await compressImageToTargetLimit(resolved, 110000)
          : resolved;
    }),
  );

  const html = pages
    .map((pagePhotos, idx) => {
      const isFirstPhotoPage = idx === 0;
      const gridClass = isFirstPhotoPage ? firstGridClassName : gridClassName;
      const header = `<div style="border-bottom: 1px solid #adb5bd; padding-bottom: 8px; margin-bottom: 12px; font-size: 11px; font-weight: 700;">${escapeHtml(project.clientName)} — ${escapeHtml(project.displayNumber || project.projectId)} — ${escapeHtml(reportTitle)} (cont.)</div>`;
      const startIndex = isFirstPhotoPage ? 0 : FIRST_PAGE_BOXES + (idx - 1) * OTHER_PAGE_BOXES;
      const boxesHtml = pagePhotos
        .map((p, i) => snagPhotoBoxHtml(p, resolvedByPhotoId[p.photoId], startIndex + i))
        .join("");
      return `<div class="${wrapperClass} ${pageClass}">
        <div class="report-content"${contentStyle}>${header}<div class="${gridClass}">${boxesHtml}</div></div>
        ${includeFooter ? generateReportFooter() : ""}
      </div>`;
    })
    .join("");

  return { html, hasPhotos: true };
}

/**
 * Snags Report — same flowing layout as the Inspection Report: one
 * continuous document (header + photo grid), letting the browser/print
 * engine paginate naturally instead of the earlier fixed cover-page +
 * 4-then-6-box-per-page scheme.
 *
 * `photos` is expected to already be filtered to this project's
 * tags:"Snags" photos (see compileFieldReport).
 */
async function renderSnagsReport(project, photos) {
  const { html: photoGridHtml, hasPhotos } = await buildFlowingInspectionPhotoGrid(project, photos);

  const photosSection = `
    <div style="margin-top:20px;">
      ${renderSectionHeading(1, "Photographic Record")}
      <div style="margin-top:14px;">
        ${hasPhotos ? photoGridHtml : `<p style="text-align:center; color:#495057; padding:24px 0;">No snag photos recorded for this project.</p>`}
      </div>
    </div>`;

  return `<div class="report-page-wrapper inspection-report-flow">
    <div class="report-content">
      ${await generateFlowReportHeader("Snags Report", project)}
      ${photosSection}
    </div>
  </div>`;
}

function formatInspectionDate(value) {
  if (!value) return new Date().toLocaleDateString("en-GB");
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

async function generateInspectionSignatureBlocks(inspectorName) {
  const cache = typeof getCache === "function" ? getCache() : {};
  const settings =
    cache.settings && cache.settings.data
      ? cache.settings.data
      : cache.settings || {};
  // Per-user signature image first (see branding.js's _getSignImageUrl),
  // falling back to the company-wide one only if this user hasn't set
  // their own yet. This was the actual gap: every call site correctly
  // passed a per-user NAME, but the image itself always came from the
  // old company-wide Sign_Signed field regardless -- which nobody
  // populates anymore now that My Signature exists, so no image ever
  // showed up on estimates, inspections, or anything else routed
  // through this shared function.
  const signImageUrl = (typeof _getSignImageUrl === "function")
    ? await _getSignImageUrl()
    : (settings.Sign_Signed ? await resolveImageToDataUrl(settings.Sign_Signed) : "");
  const finalName = inspectorName || (typeof _getSignatoryName === "function" ? await _getSignatoryName() : "") || settings.Name_Signed || "Kayode Olubisi";
  return `<div style="margin-top:16px; page-break-inside:avoid;">
    <div>
      ${signImageUrl ? `<div><img src="${escapeAttr(signImageUrl)}" style="max-height:54px; max-width:170px; object-fit:contain; display:block;" onerror="this.style.display='none'"></div>` : ""}
      <div style="font-size:12px; margin-top:0; font-weight:700;">${escapeHtml(finalName)}</div>
    </div>
  </div>`;
}

/**
 * Inspection Report photo grid — unlike buildPhotoGridPages (used by the
 * Snags Report, which deliberately paginates into fixed 4/6-box pages),
 * this renders every included photo into ONE continuous grid with no
 * synthetic page-chunk wrappers. The earlier chunked approach forced each
 * group of 4 photos to avoid breaking across pages as a unit — if a group
 * didn't fully fit in the space remaining on the current page, the whole
 * group (not just the overflow) got pushed to a new page, which is what
 * produced unwanted blank space / photos "starting on a new page" even
 * when there was room for some of them. Individual cards still avoid
 * breaking mid-card (via .snag-report-card's own page-break-inside:avoid),
 * but the grid as a whole is free to flow and wrap across as many pages
 * as it naturally needs.
 */
async function buildFlowingInspectionPhotoGrid(project, photos) {
  const usable = (photos || [])
    .filter((p) => p.driveFileId)
    .sort((a, b) => (Number(a.capturedAt) || 0) - (Number(b.capturedAt) || 0));
  if (!usable.length) return { html: "", hasPhotos: false };

  const resolvedByPhotoId = {};
  await Promise.all(
    usable.map(async (p) => {
      const resolved = await resolveImageToDataUrl(p.driveFileId);
      resolvedByPhotoId[p.photoId] =
        resolved && typeof compressImageToTargetLimit === "function"
          ? await compressImageToTargetLimit(resolved, 110000)
          : resolved;
    }),
  );

  const boxesHtml = usable
    .map((p, i) => snagPhotoBoxHtml(p, resolvedByPhotoId[p.photoId], i))
    .join("");

  return { html: `<div class="inspection-report-grid">${boxesHtml}</div>`, hasPhotos: true };
}

/** Numbered section heading ("1. Introduction" etc.) — shared by any flowing report (Snags, Inspections). */
function renderSectionHeading(number, title) {
  return `<div class="report-section-heading"><span class="section-number">${escapeHtml(String(number))}.</span><span class="section-title">${escapeHtml(title)}</span></div>`;
}

/**
 * A single photo box for the grid reports. Shows the image, capture date,
 * a caption (comment if present, otherwise falls back to area/trade/
 * activity), and any tags. Note: this only surfaces text metadata —
 * there's no drawn-markup/annotation layer in the app yet (arrows,
 * circles, boxes on the image itself), so "annotations" here means tags
 * and comments only, not visual markup. Flagging that since it's a gap,
 * not a silent omission.
 */
function snagPhotoBoxHtml(p, resolvedImageUrl, index) {
  const dateStr = p.capturedAt ? new Date(Number(p.capturedAt)).toLocaleDateString() : "";
  const tags = typeof safeParseTags_ === "function" ? safeParseTags_(p.tags) : [];
  const imgHtml = resolvedImageUrl
    ? `<img src="${escapeAttr(resolvedImageUrl)}" onerror="this.parentElement.style.display='none'">`
    : `<div style="display:flex; align-items:center; justify-content:center; height:100%; font-size:11px; color:#adb5bd;">Image unavailable</div>`;

  return `<div class="snag-report-card">
    <div class="snag-photo-box-img">${imgHtml}</div>
    <div class="snag-photo-index">${Number.isInteger(index) ? `Photo ${index + 1}` : ""}${dateStr ? (Number.isInteger(index) ? " — " : "") + dateStr : ""}</div>
    ${p.comment ? `<div class="snag-photo-caption-sub">${escapeHtml(p.comment)}</div>` : ""}
    ${tags.length ? `<div class="snag-photo-tags">${tags.map((t) => `<span class="snag-photo-tag-pill">${escapeHtml(t)}</span>`).join("")}</div>` : ""}
  </div>`;
}

async function renderProgressReport(project, logs) {
  const sorted = [...logs].sort(
    (a, b) => new Date(b.dateRecorded) - new Date(a.dateRecorded),
  );
  const rows = sorted
    .map(
      (l) =>
        `<tr><td style="border-bottom:1px solid #adb5bd; padding:8px; font-size:12px; vertical-align:top; white-space:nowrap;">${escapeHtml(l.dateRecorded)}</td><td style="border-bottom:1px solid #adb5bd; padding:8px; font-size:12px; vertical-align:top; width:90px;"><strong>${escapeHtml(l.tradeCategory)}</strong></td><td style="border-bottom:1px solid #adb5bd; padding:8px; font-size:12px; vertical-align:top; width:100px;"><div style="background:#e9ecef; border-radius:4px; height:16px; width:100px; overflow:hidden; display:inline-block; vertical-align:middle; margin-right:8px;"><div style="background:#6c757d; height:100%; width:${Math.min(100, Math.max(0, Number(l.completionPercentage) || 0))}%;"></div></div><strong style="color:#6c757d;">${escapeHtml(l.completionPercentage)}%</strong></td><td style="border-bottom:1px solid #adb5bd; padding:8px; font-size:12px; vertical-align:top;">${escapeHtml(l.commentNarrative || "—")}</td></tr>`,
    )
    .join("");
  return wrapReportPage(
    `${await generateReportHeader("Progress Report", project)}<table class="report-table" style="width:100%; border-collapse: collapse; font-size:12px;"><thead><tr><th style="background:#000; color:#fff; text-align:left; padding:8px; font-size:10px; text-transform:uppercase; white-space:nowrap;">Date</th><th style="background:#000; color:#fff; text-align:left; padding:8px; font-size:10px; text-transform:uppercase; width:90px;">Trade</th><th style="background:#000; color:#fff; text-align:left; padding:8px; font-size:10px; text-transform:uppercase; width:100px;">%</th><th style="background:#000; color:#fff; text-align:left; padding:8px; font-size:10px; text-transform:uppercase;">Comments</th></tr></thead><tbody>${rows || '<tr><td colspan="4" style="padding:20px; text-align:center; color:#495057;">No progress logs recorded.</td></tr>'}</tbody></table>${generateSignatureBlock()}`,
  );
}

/**
 * Resolves a "|||"-delimited attachments string (Drive file IDs, as stored
 * by processAttachments() in Code.gs) into real embeddable data URIs.
 * Same underlying fix as photos/documents: the doGet endpoint returns
 * text/plain, not image bytes, so each one has to be fetched and the
 * fetched text reused as the actual src. Mimetype (and therefore whether
 * it's an image or something else, e.g. a PDF) is read off the resolved
 * data URI itself, since the sheet only stores a bare Drive file ID with
 * no filename/extension to go by.
 */
async function resolveAttachmentList(attachmentsStr) {
  const ids = typeof splitAttachments === "function" ? splitAttachments(attachmentsStr) : [];
  const resolved = await Promise.all(
    ids.map(async (id) => {
      const url = await resolveImageToDataUrl(id);
      return { url, isImage: !!url && url.startsWith("data:image/") };
    }),
  );
  return resolved.filter((r) => r.url);
}

/** Compact "Attachments" block — small thumbnails for images, a file chip for anything else (e.g. PDFs). */
function renderAttachmentsSectionHtml(resolvedAttachments, heading) {
  if (!resolvedAttachments || !resolvedAttachments.length) return "";
  const items = resolvedAttachments
    .map((a) =>
      a.isImage
        ? `<div style="width:90px; height:90px; border:1px solid #dee2e6; border-radius:6px; overflow:hidden;"><img src="${escapeAttr(a.url)}" style="width:100%; height:100%; object-fit:cover;" onerror="this.parentElement.style.display='none'"></div>`
        : `<div style="width:90px; height:90px; border:1px solid #dee2e6; border-radius:6px; display:flex; align-items:center; justify-content:center; background:#f8f9fa;"><i class="fas fa-file" style="font-size:26px; color:#868e96;"></i></div>`,
    )
    .join("");
  return `<div style="margin-top:14px; page-break-inside:avoid;">
    ${heading ? `<div style="font-size:11px; font-weight:800; text-transform:uppercase; color:#495057; margin-bottom:6px;">${escapeHtml(heading)}</div>` : ""}
    <div style="display:flex; flex-wrap:wrap; gap:8px;">${items}</div>
  </div>`;
}

/**
 * Radio-style thumbnail picker so the person can choose exactly ONE
 * attachment to include in a Work Order / Change Order report — these
 * reports are meant to carry a single supporting photo, not a full album.
 * `onSelectFnName` is called as `onSelectFnName(...extraArgs, index)`.
 */
function renderAttachmentPickerHtml(resolvedAttachments, selectedIndex, onSelectFnName, extraArgsJs) {
  if (!resolvedAttachments || !resolvedAttachments.length) return "";
  const items = resolvedAttachments
    .map((a, i) => {
      const thumb = a.isImage
        ? `<img src="${escapeAttr(a.url)}" style="width:100%; height:100%; object-fit:cover;">`
        : `<div style="width:100%; height:100%; display:flex; align-items:center; justify-content:center;"><i class="fas fa-file" style="font-size:20px; color:#868e96;"></i></div>`;
      const isSelected = i === selectedIndex;
      return `<label style="display:flex; flex-direction:column; align-items:center; gap:4px; cursor:pointer;">
        <div style="width:64px; height:64px; border-radius:6px; overflow:hidden; border:2px solid ${isSelected ? "var(--primary, #0056b3)" : "var(--border)"};">${thumb}</div>
        <input type="radio" name="attach-picker" value="${i}" ${isSelected ? "checked" : ""} style="width:auto;" onchange="${onSelectFnName}(${extraArgsJs}, ${i})">
      </label>`;
    })
    .join("");
  return `<div style="margin-bottom:12px;">
    <label style="display:block; font-weight:700; margin-bottom:6px; font-size:13px;">Select one photo to include in the report</label>
    <div style="display:flex; gap:10px; flex-wrap:wrap;">${items}</div>
  </div>`;
}

/** Resolves the full attachment list but returns only the one at `selectedIndex`, ready for renderAttachmentsSectionHtml. */
async function resolveSingleAttachment(attachmentsStr, selectedIndex) {
  const all = await resolveAttachmentList(attachmentsStr);
  if (!all.length) return [];
  const idx = Number.isInteger(selectedIndex) && all[selectedIndex] ? selectedIndex : 0;
  return [all[idx]];
}

async function renderWorkOrderReport(project, workorders, vendors, settings) {
  // Build terms & conditions from settings WO1-W10
  const terms = [];
  for (let i = 1; i <= 10; i++) {
    const key = `WO${i}`;
    if (settings && settings[key]) terms.push({ num: i, text: settings[key] });
  }
  const woRows = workorders
    .map((w) => {
      const vendor = vendors.find((v) => v.vendorId === w.vendorId);
      return `<tr>
      <td style="border-bottom:1px solid #adb5bd; padding:8px; font-size:12px; vertical-align:top;"><strong>${escapeHtml(w.workOrderId)}</strong></td>
      <td style="border-bottom:1px solid #adb5bd; padding:8px; font-size:12px; vertical-align:top;">${escapeHtml(vendor ? vendor.company : w.vendorId)}</td>
      <td style="border-bottom:1px solid #adb5bd; padding:8px; font-size:12px; vertical-align:top;">${escapeHtml(vendor ? vendor.trade : "—")}</td>
      <td style="border-bottom:1px solid #adb5bd; padding:8px; font-size:12px; vertical-align:top;">${escapeHtml(formatWorkOrderDescription(w.description))}</td>
      <td style="border-bottom:1px solid #adb5bd; padding:8px; font-size:12px; text-align:right; vertical-align:top; font-weight:700;">₦${moneyValue(w.amount)}</td>
      <td style="border-bottom:1px solid #adb5bd; padding:8px; font-size:12px; text-align:center; vertical-align:top;">${escapeHtml(w.status)}</td>
    </tr>`;
    })
    .join("");
  const totalWO = workorders.reduce(
    (s, w) => roundMoney(s + Number(w.amount || 0)),
    0,
  );
  let termsHtml = "";
  if (terms.length) {
    termsHtml = `<div style="margin-top: 24px; page-break-inside: avoid;">
      <h3 style="font-size: 14px; font-weight: 900; text-transform: uppercase; margin: 16px 0 8px; border-bottom: 1px solid #000; padding-bottom: 4px;">Terms & Conditions</h3>
      <ol style="font-size: 12px; line-height: 1.6; padding-left: 20px;">
        ${terms.map((t) => `<li style="margin-bottom: 6px;">${escapeHtml(t.text)}</li>`).join("")}
      </ol>
    </div>`;
  }

  // Resolve every work order's attachments up front (in parallel), then
  // build one appendix section per work order that actually has any —
  // keeps the main table clean rather than cramming thumbnails into cells.
  const woWithAttachments = workorders.filter((w) => w.attachments && String(w.attachments).trim());
  const resolvedByWorkOrderId = {};
  await Promise.all(
    woWithAttachments.map(async (w) => {
      resolvedByWorkOrderId[w.workOrderId] = await resolveAttachmentList(w.attachments);
    }),
  );
  const attachmentsAppendixHtml = woWithAttachments
    .map((w) => {
      const resolved = resolvedByWorkOrderId[w.workOrderId];
      if (!resolved || !resolved.length) return "";
      const vendor = vendors.find((v) => v.vendorId === w.vendorId);
      return renderAttachmentsSectionHtml(resolved, `${w.workOrderId} — ${vendor ? vendor.company : w.vendorId}`);
    })
    .join("");

  return wrapReportPage(`${await generateReportHeader("Work Orders Report", project)}
    <table class="report-table" style="width:100%; border-collapse: collapse; font-size:12px; margin-bottom: 16px;">
      <thead>
        <tr>
          <th style="background:#000; color:#fff; text-align:left; padding:8px; font-size:10px; text-transform:uppercase;">WO ID</th>
          <th style="background:#000; color:#fff; text-align:left; padding:8px; font-size:10px; text-transform:uppercase;">Vendor</th>
          <th style="background:#000; color:#fff; text-align:left; padding:8px; font-size:10px; text-transform:uppercase;">Trade</th>
          <th style="background:#000; color:#fff; text-align:left; padding:8px; font-size:10px; text-transform:uppercase;">Description</th>
          <th style="background:#000; color:#fff; text-align:right; padding:8px; font-size:10px; text-transform:uppercase;">Amount</th>
          <th style="background:#000; color:#fff; text-align:center; padding:8px; font-size:10px; text-transform:uppercase;">Status</th>
        </tr>
      </thead>
      <tbody>
        ${woRows || '<tr><td colspan="6" style="padding:20px; text-align:center; color:#495057;">No work orders recorded.</td></tr>'}
        <tr style="background:#e9ecef; font-weight:900;">
          <td colspan="4" style="border-bottom:2px solid #000; padding:8px; font-size:12px;"><strong>TOTAL</strong></td>
          <td style="border-bottom:2px solid #000; padding:8px; font-size:12px; text-align:right;">₦${moneyValue(totalWO)}</td>
          <td style="border-bottom:2px solid #000; padding:8px;"></td>
        </tr>
      </tbody>
    </table>
    ${attachmentsAppendixHtml}
    ${termsHtml}`);
}

async function compileFieldReport(btn) {
  const statusEl = document.getElementById("report-status-message");
  const setStatus = (message, type = "info") => {
    if (!statusEl) return;
    statusEl.style.display = message ? "block" : "none";
    statusEl.textContent = message || "";
    statusEl.style.color =
      type === "error"
        ? "var(--danger)"
        : type === "success"
          ? "var(--success)"
          : "var(--muted)";
  };
  if (!btn) {
    btn = document.activeElement;
    if (!btn || btn.tagName !== "BUTTON")
      btn = document.querySelector('button[onclick*="compileFieldReport"]');
  }
  if (btn) {
    btn.disabled = true;
    btn.dataset.originalHtml = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generating...';
  }
  setStatus("Loading report data...");
  try {
    const typeSel = document.getElementById("rep-type-sel");
    const scopeSel = document.getElementById("rep-scope-sel");
    const filterSel = document.getElementById("rep-filter-sel");
    if (!typeSel || !typeSel.value) {
      alert("Select a report type");
      return;
    }
    const type = typeSel.value;
    currentReportType = type; // Set for layout system
    const scope = scopeSel ? scopeSel.value : "all";
    const filter = filterSel ? filterSel.value : "";
    if (type !== "financial_all" && scope !== "all" && !filter) {
      alert("Please select a " + scope.replace("Specific ", "").toLowerCase());
      return;
    }
    const cache = getCache();
    let html = "";
    const ensureAll = async (pairs) => {
      const needed = pairs.filter(([key]) => !cache[key] || !cache[key].length);
      if (!needed.length) return;
      const results = await Promise.allSettled(needed.map(([, action]) => callApi(action, {})));
      needed.forEach(([key], i) => {
        if (results[i].status === "fulfilled") cache[key] = results[i].value || [];
      });
      setCache(cache);
    };
    await ensureAll([
      ["payments", "getPayments"],
      ["workorders", "getWorkOrders"],
      ["snags", "getSnags"],
      ["progressLogs", "getProgressLogs"],
      ["changeOrders", "getChangeOrders"],
    ]);
    setStatus("Building report...");
    if (type === "financial_all") {
      const selectedFields = getSelectedFinancialFields();
      if (!selectedFields.length) {
        alert("Select at least one field to print");
        return;
      }
      html = await renderFinancialAll(
        cache.projects || [],
        cache.payments || [],
        selectedFields,
      );
    } else if (type === "financial_project") {
      const project = (cache.projects || []).find(
        (p) => p.projectId === filter,
      );
      if (!project) {
        alert("Project not found");
        return;
      }
      html = await renderFinancialProject(project, cache.payments || []);
    } else if (type === "financial_client") {
      html = await renderFinancialClient(
        filter,
        cache.projects || [],
        cache.payments || [],
      );
    } else if (type === "financial_vendor") {
      const vendor = (cache.vendors || []).find((v) => v.vendorId === filter);
      if (!vendor) {
        alert("Vendor not found");
        return;
      }
      html = await renderFinancialVendor(
        vendor,
        cache.projects || [],
        cache.workorders || [],
        cache.payments || [],
      );
    } else if (type === "scope") {
      const project = (cache.projects || []).find(
        (p) => p.projectId === filter,
      );
      if (!project) {
        alert("Project not found");
        return;
      }
      if (!cache.settings || !cache.settings.VAT) {
        try {
          const res = await callApi("getSettings", {});
          cache.settings = res || cache.settings || {};
          setCache(cache);
        } catch (e) {
          console.warn("Could not load settings for report:", e);
        }
      }
      html = await renderScopeReport(project, cache.settings || {});
    } else if (type === "snags") {
      const project = (cache.projects || []).find(
        (p) => p.projectId === filter,
      );
      if (!project) {
        alert("Project not found");
        return;
      }
      let projectSnagPhotos = [];
      try {
        const allPhotos = await callApi("getPhotos", { projectId: filter });
        projectSnagPhotos = (Array.isArray(allPhotos) ? allPhotos : []).filter(
          (p) =>
            String(p.projectId).trim() === String(filter).trim() &&
            (typeof safeParseTags_ === "function" ? safeParseTags_(p.tags) : []).includes("Snags"),
        );
      } catch (e) {
        console.warn("Could not load snag photos for report:", e);
      }
      html = await renderSnagsReport(project, projectSnagPhotos);
    } else if (type === "progress") {
      const project = (cache.projects || []).find(
        (p) => p.projectId === filter,
      );
      if (!project) {
        alert("Project not found");
        return;
      }
      const projectLogs = (cache.progressLogs || []).filter(
        (l) => l.projectId === filter,
      );
      html = await renderProgressReport(project, projectLogs);
    } else if (type === "workorder_report") {
      const woId = document.getElementById("rep-workorder-sel").value;
      if (!woId) {
        alert("Select a work order");
        return;
      }
      const workorder = (cache.workorders || []).find(
        (w) => w.workOrderId === woId,
      );
      if (!workorder) {
        alert("Work order not found");
        return;
      }
      const project = (cache.projects || []).find(
        (p) => p.projectId === workorder.projectId,
      );
      await ensureAll([["vendors", "getVendors"]]);
      html = await renderWorkOrderDetailReport(
        workorder,
        project,
        cache.vendors || [],
        cache.settings || {},
      );
    }
    const preview = document.getElementById("report-preview-viewport");
    const printContainer = document.getElementById("report-print-container");
    const card = document.getElementById("report-onscreen-preview-card");
    if (preview) preview.innerHTML = html;
    if (printContainer) printContainer.innerHTML = html;
    if (card) card.style.display = "block";
    setStatus("Report ready. Use Print, Save PDF, or Share.", "success");
    window.scrollTo(0, document.body.scrollHeight);
  } catch (e) {
    console.error("compileFieldReport failed", e);
    setStatus("Report generation failed: " + (e.message || "Unknown error"), "error");
    alert("Report generation failed: " + (e.message || "Unknown error"));
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML =
        btn.dataset.originalHtml ||
        '<i class="fas fa-file-alt"></i> Generate Report';
    }
  }
}
// ===== PCR REPORT =====
async function renderPcrReport(project, changeOrders, payments, mode) {
  mode = mode === "payment_request" ? "payment_request" : "pcr";
  // ── Financials ───────────────────────────────────────────────────────────
  const subtotal = roundMoney(Number(project.contractSubtotal) || 0);
  const vat = calculateTax(subtotal, "VAT");
  const wht = calculateTax(subtotal, "WHT");
  const totalContract = roundMoney(subtotal + vat);
  const netReceivable = roundMoney(totalContract - wht);

  const groups = getAllPaymentGroups(project.projectId);
  let totalReceived = 0,
    totalOutgoing = 0,
    smallExpenses = 0,
    totalPending = 0;
  groups.forEach((g) => {
    if (g.direction === "Client Receipt") totalReceived += g.paymentsToDate;
    else if (g.direction === "Small Expense") smallExpenses += g.paymentsToDate;
    else {
      totalOutgoing += g.paymentsToDate;
      totalPending += g.balance;
    }
  });
  totalReceived = roundMoney(totalReceived);
  totalOutgoing = roundMoney(totalOutgoing);
  smallExpenses = roundMoney(smallExpenses);
  totalPending = roundMoney(totalPending);
  const balanceExpected = roundMoney(totalContract - totalReceived);
  const netProfit = roundMoney(
    totalReceived - totalOutgoing - smallExpenses - totalPending,
  );

  // ── Snags & work orders ──────────────────────────────────────────────────
  const cache = getCache();
  const projectSnags = (cache.snags || []).filter(
    (s) => s.projectId === project.projectId,
  );
  const openSnags = projectSnags.filter((s) => s.status !== "Completed").length;
  const closedSnags = projectSnags.filter(
    (s) => s.status === "Completed",
  ).length;
  const workOrderCount = (cache.workorders || []).filter(
    (w) => w.projectId === project.projectId,
  ).length;

  // ── PCR narrative fields ─────────────────────────────────────────────────
  const pcrStatus =
    project.pcrStatus || project.projectStatus || "Substantially Complete";
  const pcrCompletion = project.pcrCompletion || "0%";
  const pcrSummary =
    project.pcrSummary ||
    "Works completed in line with recorded project scope and site updates.";
  const pcrDeclaration =
    project.pcrDeclaration ||
    "This report confirms that the project works recorded for the above project have reached substantially complete status, subject to any open snags noted in FieldScan Pro.";
  // Display the stored value directly (e.g. "100.0%"); strip trailing % then re-add
  // to avoid double-% if the value already contains one.
  // Google Sheets stores "100.0%" as the decimal 1.0, "50%" as 0.5, etc.
  // If the raw value is a number (or numeric string) <= 1 with no % sign,
  // multiply by 100 to recover the real percentage.
  let _pcrRaw = pcrCompletion;
  if (
    typeof _pcrRaw === "number" ||
    (typeof _pcrRaw === "string" && !String(_pcrRaw).includes("%"))
  ) {
    const _num = parseFloat(_pcrRaw);
    if (!isNaN(_num) && _num > 0 && _num <= 1) {
      _pcrRaw = (_num * 100).toFixed(1);
    } else if (!isNaN(_num)) {
      _pcrRaw = _num.toFixed(1);
    }
  }
  const _pcrPct = String(_pcrRaw).trim();
  const completionDisplay = _pcrPct.endsWith("%") ? _pcrPct : _pcrPct + "%";

  // ── Settings (logo / signature) ──────────────────────────────────────────
  const settings =
    cache.settings && cache.settings.data
      ? cache.settings.data
      : cache.settings || {};
  const c = _getCompanyDetails();
  const logoUrl = settings.Logo ? await resolveImageToDataUrl(settings.Logo) : "";
  // Per-user signature first, falling back to the company-wide one.
  const signImageUrl = await _getSignImageUrl();
  const signatoryName = await _getSignatoryName();

  // ── WHT toggle ───────────────────────────────────────────────────────────
  const showWht =
    document.getElementById("pcr-show-wht")?.checked !== false;

  // ── Date ─────────────────────────────────────────────────────────────────
  const dateStr = new Date().toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  // ── Financial table (mirrors PDF table style: label | value rows) ────────
  // Core rows always shown
  const finRows = [
    { label: "Contract Value", value: moneyValue(totalContract), bold: false },
    { label: "Client Receipts", value: moneyValue(totalReceived), bold: false },
    {
      label: "Balance Expected",
      value: moneyValue(balanceExpected),
      bold: true,
    },
  ];
  // Optional WHT block appended as additional rows when toggled on
  const whtRows = showWht
    ? [
        {
          label: `WHT (${formatTaxRate(getTaxRate("WHT"))})`,
          value: moneyValue(wht),
          bold: false,
        },
        {
          label: "Net Receivable (after WHT)",
          value: moneyValue(netReceivable),
          bold: true,
        },
      ]
    : [];

  const allFinRows = [...finRows, ...whtRows];

  const finTableRows = allFinRows
    .map(
      (r) => `
    <tr>
      <td style="
        padding: 7px 10px;
        font-size: 11px;
        border-bottom: 1px solid #dee2e6;
        font-weight: ${r.bold ? "900" : "600"};
        ${r.bold ? "border-top: 1.5px solid #adb5bd;" : ""}
      ">${escapeHtml(r.label)}</td>
      <td style="
        padding: 7px 10px;
        font-size: 11px;
        text-align: right;
        border-bottom: 1px solid #dee2e6;
        font-weight: ${r.bold ? "900" : "700"};
        ${r.bold ? "border-top: 1.5px solid #adb5bd;" : ""}
      ">₦${r.value}</td>
    </tr>`,
    )
    .join("");

  const financialHtml = `
    <table style="width: 100%; border-collapse: collapse; font-size: 11px; border: 1px solid #dee2e6;">
      <tbody>${finTableRows}</tbody>
    </table>`;

  // ── Metric card helper ───────────────────────────────────────────────────
  const metricCard = (value, label, valueColor) => `
    <div style="
      border: 1px solid #dee2e6;
      padding: 10px 8px;
      text-align: center;
      background: #fff;
    ">
      <div style="font-size: 26px; font-weight: 900; line-height: 1; ${valueColor ? "color:" + valueColor + ";" : ""}">${value}</div>
      <div style="font-size: 9px; font-weight: 700; text-transform: uppercase; color: #6c757d; margin-top: 4px; letter-spacing: 0.5px;">${label}</div>
    </div>`;

  // ── Render ───────────────────────────────────────────────────────────────
  return `
    <div class="report-page-wrapper pcr-report" style="
      position: relative;
      min-height: calc(297mm - 30mm);
      background: white;
      font-family: 'Inter', 'Segoe UI', Arial, sans-serif;
      font-size: 11pt;
      color: #000;
      box-sizing: border-box;
    ">
      <div class="report-content" style="padding-bottom: 24mm;">

        <!-- ══ HEADER ══════════════════════════════════════════════════════ -->
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px;">
          <div style="flex: 1;">
            <div style="font-size: 10px; color: #495057; font-weight: 600; margin-bottom: 6px;">${escapeHtml(dateStr)}</div>
            <h1 style="font-size: 22px; font-weight: 900; margin: 0 0 3px 0; letter-spacing: -0.3px; color: #000;">${mode === "payment_request" ? "PAYMENT REQUEST" : "PROJECT COMPLETION REPORT"}</h1>
            <div style="font-size: 12px; font-weight: 700; color: #495057;">PCR / ${escapeHtml(project.displayNumber || project.projectId)}</div>
          </div>
          ${logoUrl ? '<div style="flex-shrink: 0; margin-left: 20px; text-align: right;"><img src="' + escapeAttr(logoUrl) + '" style="max-height: 90px; max-width: 160px; object-fit: contain;" onerror="this.style.display=\'none\'"></div>' : ""}
        </div>

        <!-- Thick divider -->
        <div style="border-top: 2.5px solid #000; margin: 8px 0 14px 0;"></div>

        <!-- ══ PROJECT INFO (table style matching PDF) ══════════════════════ -->
        <table style="width: 100%; border-collapse: collapse; font-size: 11px; margin-bottom: 14px;">
          <tbody>
            <tr>
              <td style="padding: 5px 0; font-weight: 700; width: 30%;">Client</td>
              <td style="padding: 5px 0;">${escapeHtml(project.clientName || "—")}</td>
              <td style="padding: 5px 0; font-weight: 700; width: 30%;">Project ID</td>
              <td style="padding: 5px 0;">${escapeHtml(project.projectId || "—")}</td>
            </tr>
            <tr>
              <td style="padding: 5px 0; font-weight: 700;">Site Location</td>
              <td style="padding: 5px 0;">${escapeHtml(project.siteLocation || "—")}</td>
              <td style="padding: 5px 0; font-weight: 700;">Client Phone</td>
              <td style="padding: 5px 0;">${escapeHtml(project.clientPhone || "—")}</td>
            </tr>
            <tr>
              <td style="padding: 5px 0; font-weight: 700;">Project Status</td>
              <td style="padding: 5px 0;" colspan="3">${escapeHtml(pcrStatus)}</td>
            </tr>
          </tbody>
        </table>

        ${mode === "payment_request" ? `
        <!-- ══ REQUESTED AMOUNT + ACCOUNT DETAILS ══════════════════════════ -->
        <div style="border: 2px solid #000; padding: 14px 16px; margin-bottom: 16px; display: flex; justify-content: space-between; gap: 20px; flex-wrap: wrap;">
          <div>
            <div style="font-size: 10px; font-weight: 700; text-transform: uppercase; color: #495057; margin-bottom: 4px;">Amount Requested</div>
            <div style="font-size: 30.8px; font-weight: 900;">₦${moneyValue(Number(project.pcrRequestedAmount) || 0)}</div>
          </div>
          <div style="text-align: right;">
            <div style="font-size: 10px; font-weight: 700; text-transform: uppercase; color: #495057; margin-bottom: 4px;">Payment Details</div>
            <div style="font-size: 12px; font-weight: 700;">${escapeHtml(settings.Bank_Name || "—")}</div>
            <div style="font-size: 12px;">${escapeHtml(settings.Account_Name || "—")}</div>
            <div style="font-size: 15px; font-weight: 700;">${escapeHtml(settings.Account_Number || "—")}</div>
          </div>
        </div>` : ""}

        <!-- ══ METRIC CARDS ══════════════════════════════════════════════════ -->
        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 8px; margin-bottom: 16px;">
          ${metricCard(completionDisplay, "Completion")}
          ${metricCard(openSnags, "Open Snags", openSnags > 0 ? "#dc3545" : null)}
          ${metricCard(closedSnags, "Closed Snags", closedSnags > 0 ? "#28a745" : null)}
          ${metricCard(pcrStatus, "Status")}
        </div>

        <!-- ══ TWO-COLUMN BODY: Summary + Financials ════════════════════════ -->
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 16px;">

          <!-- Completion Summary -->
          <div>
            <h2 style="font-size: 12px; font-weight: 900; text-transform: uppercase; margin: 0 0 6px 0; border-bottom: 1.5px solid #000; padding-bottom: 4px;">Completion Summary</h2>
            <p style="font-size: 11px; line-height: 1.65; margin: 6px 0 0 0;">${escapeHtml(pcrSummary)}</p>
          </div>

          <!-- Financial Snapshot -->
          <div>
            <h2 style="font-size: 12px; font-weight: 900; text-transform: uppercase; margin: 0 0 6px 0; border-bottom: 1.5px solid #000; padding-bottom: 4px;">Financial Snapshot</h2>
            ${financialHtml}
          </div>

        </div>

        <!-- ══ COMPLETION DECLARATION ════════════════════════════════════════ -->
        <div style="
          border: 1px solid #dee2e6;
          border-radius: 4px;
          padding: 12px 14px;
          margin-bottom: 20px;
          background: #fff;
        ">
          <div style="font-size: 11px; font-weight: 900; margin-bottom: 6px;">Completion Declaration</div>
          <p style="font-size: 11px; line-height: 1.65; margin: 0;">${escapeHtml(pcrDeclaration)}</p>
        </div>

        <!-- ══ SIGNATURE BLOCK ════════════════════════════════════════════════ -->
        <div style="margin-top: 20px; page-break-inside: avoid;">
          <div style="font-size: 10px; font-weight: 900; text-transform: uppercase; color: #495057; letter-spacing: 0.5px; margin-bottom: 10px;">Project Sign-Off</div>
          <div style="display: inline-block; text-align: center;">
            ${signImageUrl ? '<div style="margin-bottom: 2px;"><img src="' + escapeAttr(signImageUrl) + '" style="max-height: 48px; max-width: 160px; object-fit: contain;" onerror="this.style.display=\'none\'"></div>' : '<div style="height: 40px;"></div>'}
            <div style="border-bottom: 1.5px solid #000; width: 200px; margin: 0 auto 5px auto;"></div>
            <div style="font-size: 11px; font-weight: 700;">${escapeHtml(signatoryName || "_________________________")}</div>
          </div>
        </div>

      </div><!-- /report-content -->

      <!-- ══ FOOTER ══════════════════════════════════════════════════════════ -->
      <div class="report-footer">
        <div style="font-weight: 700; margin-bottom: 4px;">${escapeHtml(c.address)}</div>
        <div>${escapeHtml(c.phone1)}&nbsp;&nbsp;&nbsp;${escapeHtml(c.phone2)}&nbsp;&nbsp;&nbsp;${escapeHtml(c.email)}</div>
      </div>

    </div>
  `;
}
