(() => {
  const DAYS = 90;
  const BAR_HEIGHT = 34;
  const BAR_WIDTH = 3;
  const BAR_GAP = 2;

  const componentsEl = document.getElementById("components");
  const statusBanner = document.getElementById("status-banner");
  const statusBannerText = document.getElementById("status-banner-text");
  const statusBannerSub = document.getElementById("status-banner-sub");
  const siteDot = document.getElementById("site-dot");
  const detailPanel = document.getElementById("detail-panel");
  const detailContent = document.getElementById("detail-content");
  const detailClose = document.getElementById("detail-close");
  const pastIncidentsEl = document.getElementById("past-incidents");
  const tooltipEl = document.getElementById("tooltip");

  let categories = [];
  let assessments = new Map();

  // Vertical connector line from bar to tooltip (touch only)
  const connectorLine = document.createElement("div");
  connectorLine.className = "connector-line";
  document.body.appendChild(connectorLine);

  const COLORS = {
    green: "#76ad2a",
    yellow: "#e5a530",
    orange: "#e07a3a",
    red: "#d94040",
    empty: "#ccc",
  };

  const severityRank = { green: 0, yellow: 1, red: 2 };
  const statusWord = { green: "Operational", yellow: "Degraded Performance", red: "Major Outage" };

  function getDateRange(days) {
    const dates = [];
    const now = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      dates.push(d.toISOString().slice(0, 10));
    }
    return dates;
  }

  function formatDate(dateStr) {
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  }

  function formatDateLong(dateStr) {
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  }

  function worstSeverity(severities) {
    let worst = "green";
    for (const s of severities) {
      if (severityRank[s] > severityRank[worst]) worst = s;
    }
    return worst;
  }

  // Tooltip
  function showTooltip(e, dateStr, catId) {
    const assessment = assessments.get(dateStr);
    const catData = assessment?.categories?.[catId];
    if (!catData) {
      tooltipEl.innerHTML = `
        <div class="tooltip-date">${formatDate(dateStr)}</div>
        <div class="tooltip-text" style="color:var(--text-light)">No data</div>
      `;
    } else {
      tooltipEl.innerHTML = `
        <div class="tooltip-date">${formatDate(dateStr)}</div>
        <div>
          <span class="tooltip-dot ${catData.severity}"></span>
          <span class="tooltip-text">${catData.headline}</span>
        </div>
      `;
    }
    tooltipEl.classList.add("visible");
    positionTooltip(e);
  }

  let isTouch = false;

  let activeBarSvg = null;

  function positionTooltip(e) {
    const pad = 12;
    const clientX = e.clientX ?? 0;
    const clientY = e.clientY ?? 0;
    const rect = tooltipEl.getBoundingClientRect();
    let x, y;

    if (isTouch) {
      x = clientX - rect.width / 2;
      y = clientY - rect.height - 50;
    } else {
      // Position tooltip above the bar chart, centered on cursor X
      x = clientX - rect.width / 2;
      if (activeBarSvg) {
        const svgRect = activeBarSvg.getBoundingClientRect();
        y = svgRect.top - rect.height - 8;
      } else {
        y = clientY - rect.height - pad;
      }
    }

    // Clamp to viewport
    if (x + rect.width > window.innerWidth - pad) x = window.innerWidth - rect.width - pad;
    if (x < pad) x = pad;
    if (y < pad) y = pad;
    tooltipEl.style.left = x + "px";
    tooltipEl.style.top = y + "px";

    if (activeBarSvg) {
      const svgRect = activeBarSvg.getBoundingClientRect();
      const barBottom = svgRect.bottom;
      const tooltipBottom = y + rect.height;
      connectorLine.style.left = clientX + "px";
      connectorLine.style.top = tooltipBottom + "px";
      connectorLine.style.height = Math.max(0, barBottom - tooltipBottom) + "px";
      connectorLine.classList.add("visible");
    }
  }

  function hideTooltip() {
    tooltipEl.classList.remove("visible");
    connectorLine.classList.remove("visible");
    activeBarSvg = null;
  }

  // Detail rendering helper
  function buildDetailHTML(dateStr, catId) {
    const assessment = assessments.get(dateStr);
    const catData = assessment?.categories?.[catId];
    const catMeta = categories.find((c) => c.id === catId);
    if (!catData || !catMeta) return null;

    const sourcesHtml = catData.sources?.length
      ? `<div class="detail-sources">
          <div class="detail-sources-label">Sources</div>
          ${catData.sources.map((s) => `<a href="${s.url}" target="_blank" rel="noopener">${s.title || s.url}</a>`).join("")}
        </div>`
      : "";

    return `
      <div class="detail-date">${formatDate(dateStr)}</div>
      <div class="detail-category">${catMeta.label}</div>
      <div class="detail-severity-badge ${catData.severity}">${catData.severity}</div>
      <div class="detail-headline">${catData.headline}</div>
      <div class="detail-summary">${catData.summary}</div>
      ${sourcesHtml}
    `;
  }

  // Detail panel (from bar chart clicks)
  function showDetail(dateStr, catId) {
    const html = buildDetailHTML(dateStr, catId);
    if (!html) return;
    detailContent.innerHTML = html;
    detailPanel.classList.add("open");
    detailPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function closeDetail() {
    detailPanel.classList.remove("open");
  }

  detailClose.addEventListener("click", closeDetail);

  // Close detail panel on outside click
  document.addEventListener("click", (e) => {
    if (detailPanel.classList.contains("open") &&
        !detailPanel.contains(e.target) &&
        !e.target.closest(".bar-chart")) {
      closeDetail();
    }
  });

  // Build SVG bar chart for a category
  function buildBarSVG(dates, catId) {
    const totalWidth = DAYS * (BAR_WIDTH + BAR_GAP) - BAR_GAP;
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("class", "bar-chart");
    svg.setAttribute("viewBox", `0 0 ${totalWidth} ${BAR_HEIGHT}`);
    svg.setAttribute("height", BAR_HEIGHT);
    svg.setAttribute("preserveAspectRatio", "none");

    for (let i = 0; i < dates.length; i++) {
      const dateStr = dates[i];
      const assessment = assessments.get(dateStr);
      const catData = assessment?.categories?.[catId];
      const color = catData ? COLORS[catData.severity] || COLORS.empty : COLORS.empty;

      const rect = document.createElementNS(ns, "rect");
      rect.setAttribute("x", i * (BAR_WIDTH + BAR_GAP));
      rect.setAttribute("y", 0);
      rect.setAttribute("width", BAR_WIDTH);
      rect.setAttribute("height", BAR_HEIGHT);
      rect.setAttribute("fill", color);
      rect.style.cursor = "pointer";

      rect.addEventListener("mouseenter", (e) => { activeBarSvg = svg; showTooltip(e, dateStr, catId); });
      rect.addEventListener("mousemove", positionTooltip);
      rect.addEventListener("mouseleave", hideTooltip);
      rect.addEventListener("click", () => showDetail(dateStr, catId));

      svg.appendChild(rect);
    }

    // Vertical cursor line for touch
    const cursorLine = document.createElementNS(ns, "line");
    cursorLine.setAttribute("y1", 0);
    cursorLine.setAttribute("y2", BAR_HEIGHT);
    cursorLine.setAttribute("stroke", "#141413");
    cursorLine.setAttribute("stroke-width", "1");
    cursorLine.setAttribute("stroke-opacity", "0.5");
    cursorLine.setAttribute("visibility", "hidden");
    svg.appendChild(cursorLine);

    // Touch slide support for mobile
    let touchActive = false;

    function dateFromTouch(touch) {
      const svgRect = svg.getBoundingClientRect();
      const x = touch.clientX - svgRect.left;
      const ratio = x / svgRect.width;
      const idx = Math.floor(ratio * dates.length);
      return Math.max(0, Math.min(dates.length - 1, idx));
    }

    function showCursorAt(idx) {
      const cx = idx * (BAR_WIDTH + BAR_GAP) + BAR_WIDTH / 2;
      cursorLine.setAttribute("x1", cx);
      cursorLine.setAttribute("x2", cx);
      cursorLine.setAttribute("visibility", "visible");
    }

    svg.addEventListener("touchstart", (e) => {
      touchActive = true;
      isTouch = true;
      activeBarSvg = svg;
      const idx = dateFromTouch(e.touches[0]);
      showCursorAt(idx);
      showTooltip(e.touches[0], dates[idx], catId);
      e.preventDefault();
    }, { passive: false });

    svg.addEventListener("touchmove", (e) => {
      if (!touchActive) return;
      const idx = dateFromTouch(e.touches[0]);
      showCursorAt(idx);
      showTooltip(e.touches[0], dates[idx], catId);
      e.preventDefault();
    }, { passive: false });

    svg.addEventListener("touchend", (e) => {
      if (!touchActive) return;
      touchActive = false;
      isTouch = false;
      activeBarSvg = null;
      cursorLine.setAttribute("visibility", "hidden");
      connectorLine.classList.remove("visible");
      const touch = e.changedTouches[0];
      const idx = dateFromTouch(touch);
      hideTooltip();
      showDetail(dates[idx], catId);
    });

    return svg;
  }

  // Build past incidents section
  function buildIncidents(dates) {
    const recentDates = dates.slice(-7).reverse();
    let html = `<div class="incidents-heading">Past Incidents</div>`;

    for (const dateStr of recentDates) {
      const assessment = assessments.get(dateStr);
      html += `<div class="incident-day">`;
      html += `<div class="incident-date">${formatDateLong(dateStr)}</div>`;

      if (assessment) {
        const nonGreen = Object.entries(assessment.categories)
          .filter(([, v]) => v.severity !== "green");

        if (nonGreen.length > 0) {
          for (const [catId, catData] of nonGreen) {
            const catMeta = categories.find(c => c.id === catId);
            html += `<div class="incident-item">
              <div class="incident-title">
                <span class="severity-dot ${catData.severity}"></span>
                ${catMeta?.label || catId} - ${catData.headline}
              </div>
              <div class="incident-body">${catData.summary}</div>
            </div>`;
          }
        } else {
          html += `<div class="incident-none">No issues reported.</div>`;
        }
      } else {
        html += `<div class="incident-none">No data for this day.</div>`;
      }

      html += `</div>`;
    }

    pastIncidentsEl.innerHTML = html;
  }

  function render() {
    const dates = getDateRange(DAYS);
    const today = dates[dates.length - 1];
    const todayAssessment = assessments.get(today);

    // Banner
    if (todayAssessment) {
      const severities = Object.values(todayAssessment.categories).map(c => c.severity);
      const overall = worstSeverity(severities);
      statusBanner.className = "status-banner " + overall;

      const redCats = Object.entries(todayAssessment.categories)
        .filter(([, v]) => v.severity === "red")
        .map(([id]) => categories.find(c => c.id === id)?.label)
        .filter(Boolean);
      const yellowCats = Object.entries(todayAssessment.categories)
        .filter(([, v]) => v.severity === "yellow")
        .map(([id]) => categories.find(c => c.id === id)?.label)
        .filter(Boolean);

      // Dot color in logo
      const dotColors = { green: "var(--green)", yellow: "var(--yellow)", red: "var(--red)" };
      siteDot.style.color = dotColors[overall] || "var(--green)";
      siteDot.classList.toggle("pulse", overall !== "green");

      const greenCount = severities.filter(s => s === "green").length;
      const total = severities.length;

      if (overall === "green") {
        statusBannerText.textContent = "All Systems Operational";
        statusBannerSub.textContent = `${total} of ${total} components operational`;
      } else if (redCats.length >= 4) {
        statusBannerText.textContent = "Major Service Outage — Our team has been paged";
        statusBannerSub.textContent = `${greenCount} of ${total} components operational · Updated ${formatDate(today)}`;
      } else if (redCats.length > 0) {
        const list = redCats.length <= 3
          ? redCats.join(redCats.length === 2 ? " and " : ", ").replace(/, ([^,]*)$/, ", and $1")
          : redCats.slice(0, 2).join(", ") + ", and others";
        statusBannerText.textContent = redCats.length === 1
          ? `Identified — Degraded performance in ${list}`
          : `Identified — Elevated error rates in ${list}`;
        statusBannerSub.textContent = `${greenCount} of ${total} components operational · Updated ${formatDate(today)}`;
      } else if (yellowCats.length === 1) {
        statusBannerText.textContent = `Investigating — Increased latency detected in ${yellowCats[0]}`;
        statusBannerSub.textContent = `${greenCount} of ${total} components operational · Updated ${formatDate(today)}`;
      } else {
        statusBannerText.textContent = "Monitoring — Elevated error rates across multiple components";
        statusBannerSub.textContent = `${greenCount} of ${total} components operational · Updated ${formatDate(today)}`;
      }
      // Active incidents summary below banner
      const activeEl = document.getElementById("active-incidents");
      const incidents = Object.entries(todayAssessment.categories)
        .filter(([, v]) => v.severity !== "green")
        .map(([id, v]) => {
          const cat = categories.find(c => c.id === id);
          return { id, label: cat?.label, severity: v.severity, headline: v.headline };
        })
        .filter(i => i.label);

      if (incidents.length > 0) {
        statusBanner.classList.add("has-incidents");
        activeEl.innerHTML = incidents.map(i =>
          `<div class="active-incident" data-cat-id="${i.id}">
            <div class="active-incident-header">
              <span class="severity-dot ${i.severity}"></span>
              <span class="active-incident-name">${i.label}</span>
              <span class="active-incident-status">${statusWord[i.severity]}</span>
            </div>
            <div class="active-incident-detail"></div>
          </div>`
        ).join("");

        // Click to expand inline detail
        activeEl.querySelectorAll(".active-incident").forEach(el => {
          el.style.cursor = "pointer";
          el.addEventListener("click", (e) => {
            e.stopPropagation();
            const catId = el.dataset.catId;
            const detailEl = el.querySelector(".active-incident-detail");
            if (detailEl.classList.contains("open")) {
              detailEl.classList.remove("open");
              detailEl.innerHTML = "";
              return;
            }
            // Close any other open inline details
            activeEl.querySelectorAll(".active-incident-detail.open").forEach(d => {
              d.classList.remove("open");
              d.innerHTML = "";
            });
            const html = buildDetailHTML(today, catId);
            if (html) {
              detailEl.innerHTML = html;
              detailEl.classList.add("open");
            }
          });
        });
      } else {
        activeEl.innerHTML = "";
      }
    } else {
      statusBanner.className = "status-banner";
      statusBanner.style.background = "#ccc";
      statusBannerText.textContent = "No data available";
      statusBannerSub.textContent = "";
      siteDot.style.color = "var(--empty)";
      siteDot.classList.remove("pulse");
      document.getElementById("active-incidents").innerHTML = "";
    }

    // Component rows
    componentsEl.innerHTML = "";
    for (const cat of categories) {
      const row = document.createElement("div");
      row.className = "component-row";

      const todayCat = todayAssessment?.categories?.[cat.id];
      const severity = todayCat?.severity || "green";
      const word = todayCat ? statusWord[severity] : "No Data";

      const header = document.createElement("div");
      header.className = "component-header";
      header.innerHTML = `
        <span class="component-name">${cat.label}</span>
        <span class="component-status ${severity}">${word}</span>
      `;

      const svg = buildBarSVG(dates, cat.id);

      // Calculate "uptime" — percentage of green days
      const greenDays = dates.filter(d => {
        const a = assessments.get(d);
        return a?.categories?.[cat.id]?.severity === "green";
      }).length;
      const totalWithData = dates.filter(d => assessments.has(d)).length;
      const uptime = totalWithData > 0
        ? ((greenDays / totalWithData) * 100).toFixed(2)
        : "—";

      const footer = document.createElement("div");
      footer.className = "bar-footer";
      footer.innerHTML = `<span>90 days ago</span><div class="spacer"></div><span>${uptime} % stability</span><div class="spacer"></div><span>Today</span>`;

      row.appendChild(header);
      row.appendChild(svg);
      row.appendChild(footer);
      componentsEl.appendChild(row);
    }

    // Past incidents
    buildIncidents(dates);
  }

  async function init() {
    componentsEl.innerHTML = `<div class="loading">Loading world status...</div>`;

    try {
      const [catRes, recentRes] = await Promise.all([
        fetch("categories.json"),
        fetch("data/recent.json"),
      ]);

      categories = await catRes.json();

      if (!recentRes.ok) { showEmpty(); return; }

      const recentData = await recentRes.json();
      for (const [date, assessment] of Object.entries(recentData)) {
        assessments.set(date, assessment);
      }

      if (assessments.size === 0) { showEmpty(); return; }

      render();
    } catch (e) {
      console.error("Failed to load:", e);
      showEmpty();
    }
  }

  function showEmpty() {
    componentsEl.innerHTML = `<div class="empty-state">No data yet. Run the assessment script to generate data.</div>`;
  }

  init();
})();
