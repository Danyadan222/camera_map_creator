(() => {
  const MAX_SIZE = 10000;
  const MIN_SCALE = 0.1;
  const MAX_SCALE = 4;
  const SCALE_STEP = 0.1;

  const backgroundInput = document.getElementById("backgroundInput");
  const configInput = document.getElementById("configInput");
  const viewportEl = document.getElementById("viewport");
  const canvasEl = document.getElementById("canvas");
  const addButtonModeBtn = document.getElementById("addButtonModeBtn");
  const saveConfigBtn = document.getElementById("saveConfigBtn");
  const exportReleaseBtn = document.getElementById("exportReleaseBtn");
  const resetViewBtn = document.getElementById("resetViewBtn");
  const bgSizeEl = document.getElementById("bgSize");
  const zoomLevelEl = document.getElementById("zoomLevel");
  const markerContextMenu = document.getElementById("markerContextMenu");
  const playerDateInput = document.getElementById("playerDateInput");
  const playerTimeInput = document.getElementById("playerTimeInput");
  const resetPlayerDateBtn = document.getElementById("resetPlayerDateBtn");
  const resetPlayerTimeBtn = document.getElementById("resetPlayerTimeBtn");
  const playerDateModeLabel = document.getElementById("playerDateModeLabel");
  const playerDateLabel = playerDateInput
    ? playerDateInput.closest(".date-label")
    : null;
  const markerSearchInput = document.getElementById("markerSearchInput");
  const markerSearchBtn = document.getElementById("markerSearchBtn");
  const markerSearchStatus = document.getElementById("markerSearchStatus");

  const ANGLE_PROMPT =
    "Угол наклона (0–359).\n" +
    "0 — вверх-вправо, 90 — вниз-вправо, 180 — вниз-влево, 270 — вверх-влево.";

  let scale = 1;
  let addMode = false;
  let buttons = [];
  let canvasWidth = 800;
  let canvasHeight = 600;
  let backgroundDataUrl = null;
  let backgroundName = null;
  let panX = 0;
  let panY = 0;
  let isPanning = false;
  let panStartX = 0;
  let panStartY = 0;
  let panOriginX = 0;
  let panOriginY = 0;
  let activePanPointerId = null;
  let contextMenuTargetId = null;
  let selectedDateYmd = null;
  const DEFAULT_TIME = "00:00:00";
  let selectedTimeHm = DEFAULT_TIME;
  let lastClickedButtonId = null;
  let searchHighlightedButtonId = null;

  function clearLastClickedButton() {
    lastClickedButtonId = null;
  }

  function setLastClickedButton(id) {
    lastClickedButtonId = id;
  }

  function padTimePart(num) {
    return String(num).padStart(2, "0");
  }

  function parsePastedTime(value) {
    if (!value || typeof value !== "string") return null;
    const trimmed = value.trim();
    if (!trimmed) return null;

    const match = trimmed.match(/(\d{1,2})[:\-.](\d{1,2})(?:[:\-.](\d{1,2}))?/);
    if (match) {
      const hh = Number(match[1]);
      const mm = Number(match[2]);
      const ss = match[3] !== undefined ? Number(match[3]) : 0;
      if (
        Number.isFinite(hh) &&
        Number.isFinite(mm) &&
        Number.isFinite(ss) &&
        hh >= 0 &&
        hh <= 23 &&
        mm >= 0 &&
        mm <= 59 &&
        ss >= 0 &&
        ss <= 59
      ) {
        return `${padTimePart(hh)}:${padTimePart(mm)}:${padTimePart(ss)}`;
      }
    }

    const digits = trimmed.replace(/\D/g, "");
    if (digits.length === 6) {
      const hh = Number(digits.slice(0, 2));
      const mm = Number(digits.slice(2, 4));
      const ss = Number(digits.slice(4, 6));
      if (hh <= 23 && mm <= 59 && ss <= 59) {
        return `${padTimePart(hh)}:${padTimePart(mm)}:${padTimePart(ss)}`;
      }
    }
    if (digits.length === 4) {
      const hh = Number(digits.slice(0, 2));
      const mm = Number(digits.slice(2, 4));
      if (hh <= 23 && mm <= 59) {
        return `${padTimePart(hh)}:${padTimePart(mm)}:00`;
      }
    }

    return null;
  }

  function normalizeTimeHms(value) {
    return parsePastedTime(value) || DEFAULT_TIME;
  }

  function applyPlayerTimeFromInput() {
    if (!playerTimeInput || !selectedDateYmd) return;
    const parsed = parsePastedTime(playerTimeInput.value);
    if (parsed) {
      selectedTimeHm = parsed;
      playerTimeInput.value = parsed;
      return;
    }
    if (playerTimeInput.value.trim()) {
      selectedTimeHm = normalizeTimeHms(playerTimeInput.value);
      playerTimeInput.value = selectedTimeHm;
    }
  }

  function setupPlayerTimeInput() {
    if (!playerTimeInput) return;

    const onTimePaste = (e) => {
      if (!selectedDateYmd) return;
      const text = e.clipboardData?.getData("text");
      if (!text) return;
      const parsed = parsePastedTime(text);
      if (!parsed) return;
      e.preventDefault();
      selectedTimeHm = parsed;
      playerTimeInput.value = parsed;
    };

    playerTimeInput.addEventListener("paste", onTimePaste);
    playerTimeInput.addEventListener("input", () => {
      if (!selectedDateYmd) return;
      applyPlayerTimeFromInput();
    });
    playerTimeInput.addEventListener("change", applyPlayerTimeFromInput);
    playerTimeInput.addEventListener("blur", applyPlayerTimeFromInput);
  }

  function localDateTimeMs(ymd, timeHm) {
    const parts = ymd.split("-");
    if (parts.length !== 3) return null;
    const y = Number(parts[0]);
    const m = Number(parts[1]);
    const d = Number(parts[2]);
    if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
      return null;
    }
    const timeParts = normalizeTimeHms(timeHm).split(":");
    const hh = Number(timeParts[0]);
    const mm = Number(timeParts[1]);
    const ss = Number(timeParts[2]);
    if (!Number.isFinite(hh) || !Number.isFinite(mm) || !Number.isFinite(ss)) {
      return null;
    }
    return new Date(y, m - 1, d, hh, mm, ss, 0).getTime();
  }

  function getCanonicalPathname(pathname) {
    if (pathname.includes("/v2/cameras/player/")) {
      return pathname.replace("/v2/cameras/player/", "/player/");
    }
    if (pathname.includes("/v2/player/")) {
      return pathname.replace("/v2/player/", "/player/");
    }
    return pathname;
  }

  function extractPlayerId(query) {
    if (!query || typeof query !== "string") return null;
    const trimmed = query.trim();
    if (!trimmed) return null;

    try {
      const url = new URL(trimmed);
      const path = getCanonicalPathname(url.pathname);
      const match = path.match(/\/player\/([^/?#]+)\/?$/i);
      if (match) return match[1];
    } catch {}

    const pathLike = trimmed.replace(/^https?:\/\/[^/]+/i, "");
    const pathMatch = pathLike.match(/(?:^|\/)player\/([^/?#]+)\/?$/i);
    if (pathMatch) return pathMatch[1];

    if (/^\d+$/.test(trimmed)) return trimmed;

    return null;
  }

  function getButtonPlayerId(btn) {
    if (!btn || !btn.url) return null;
    try {
      const url = new URL(btn.url);
      const path = getCanonicalPathname(url.pathname);
      const match = path.match(/\/player\/([^/?#]+)\/?$/i);
      return match ? match[1] : null;
    } catch {
      const fallback = String(btn.url).match(/\/player\/([^/?#]+)\/?$/i);
      return fallback ? fallback[1] : null;
    }
  }

  function findButtonBySearch(query) {
    const trimmed = (query || "").trim();
    if (!trimmed) return null;

    const playerId = extractPlayerId(trimmed);
    if (playerId) {
      const byId = buttons.find((btn) => getButtonPlayerId(btn) === playerId);
      if (byId) return byId;
    }

    const lower = trimmed.toLowerCase();
    return (
      buttons.find((btn) => btn.url && btn.url.toLowerCase().includes(lower)) ||
      buttons.find((btn) => btn.label && btn.label.toLowerCase().includes(lower)) ||
      null
    );
  }

  function clearSearchHighlight() {
    searchHighlightedButtonId = null;
  }

  function setSearchStatus(message, type) {
    if (!markerSearchStatus) return;
    markerSearchStatus.textContent = message || "";
    markerSearchStatus.classList.remove("is-found", "is-not-found");
    if (type) markerSearchStatus.classList.add(type);
  }

  function focusOnButton(btn) {
    if (!btn || !backgroundDataUrl) return;
    requestAnimationFrame(() => {
      const vw = viewportEl.clientWidth;
      const vh = viewportEl.clientHeight;
      panX = vw / 2 - btn.x * scale;
      panY = vh / 2 - btn.y * scale;
      applyViewTransform();
    });
  }

  function runMarkerSearch() {
    const query = markerSearchInput ? markerSearchInput.value : "";
    const trimmed = query.trim();

    if (!trimmed) {
      clearSearchHighlight();
      setSearchStatus("", null);
      renderButtons();
      return;
    }

    if (!backgroundDataUrl) {
      setSearchStatus("Сначала загрузите фон или конфиг.", "is-not-found");
      return;
    }

    const found = findButtonBySearch(trimmed);
    if (!found) {
      clearSearchHighlight();
      setSearchStatus("Камера не найдена", "is-not-found");
      renderButtons();
      return;
    }

    searchHighlightedButtonId = found.id;
    renderButtons();
    focusOnButton(found);
    const label = found.label || "Точка";
    setSearchStatus(`Найдено: ${label}`, "is-found");
  }

  function buildOpenUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== "string") return rawUrl;
    let url;
    try {
      url = new URL(rawUrl);
    } catch {
      return rawUrl;
    }

    url.searchParams.delete("date");
    url.pathname = getCanonicalPathname(url.pathname);

    if (selectedDateYmd) {
      const ms = localDateTimeMs(selectedDateYmd, selectedTimeHm);
      if (ms !== null) {
        url.searchParams.set("date", String(ms));
      }
    }

    return url.toString();
  }

  function updatePlayerDateUi() {
    const hasDate = Boolean(selectedDateYmd);
    if (playerDateInput) {
      playerDateInput.value = selectedDateYmd || "";
    }
    if (playerTimeInput) {
      playerTimeInput.disabled = !hasDate;
      playerTimeInput.value = hasDate ? selectedTimeHm || DEFAULT_TIME : DEFAULT_TIME;
    }
    if (playerDateModeLabel) {
      playerDateModeLabel.textContent = hasDate ? "Дата архива" : "Сейчас";
    }
    if (playerDateLabel) {
      playerDateLabel.classList.toggle("has-date", hasDate);
      playerDateLabel.classList.toggle("is-live", !hasDate);
    }
  }

  function resetPlayerDate() {
    selectedDateYmd = null;
    selectedTimeHm = DEFAULT_TIME;
    updatePlayerDateUi();
  }

  function resetPlayerTimeToMidnight() {
    selectedTimeHm = DEFAULT_TIME;
    if (playerTimeInput) {
      playerTimeInput.value = DEFAULT_TIME;
    }
  }

  function normalizeAngle(input, fallback) {
    if (typeof input !== "string") return fallback;
    const trimmed = input.trim().replace(",", ".");
    if (trimmed === "") return fallback;
    const num = Number(trimmed);
    if (!Number.isFinite(num)) return fallback;
    let angle = num % 360;
    if (angle < 0) angle += 360;
    return angle;
  }

  function applyViewTransform() {
    canvasEl.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
  }

  function setScale(next) {
    scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, next));
    applyViewTransform();
    zoomLevelEl.textContent = `${Math.round(scale * 100)}%`;
  }

  function setScaleAt(nextScale, clientX, clientY) {
    const clamped = Math.min(MAX_SCALE, Math.max(MIN_SCALE, nextScale));
    if (clamped === scale) return;

    const rect = viewportEl.getBoundingClientRect();
    const mx = clientX - rect.left;
    const my = clientY - rect.top;
    const canvasX = (mx - panX) / scale;
    const canvasY = (my - panY) / scale;

    scale = clamped;
    panX = mx - canvasX * scale;
    panY = my - canvasY * scale;
    applyViewTransform();
    zoomLevelEl.textContent = `${Math.round(scale * 100)}%`;
  }

  function setCanvasSize(width, height) {
    canvasWidth = Math.min(width, MAX_SIZE);
    canvasHeight = Math.min(height, MAX_SIZE);
    canvasEl.style.width = `${canvasWidth}px`;
    canvasEl.style.height = `${canvasHeight}px`;
    bgSizeEl.textContent = `${canvasWidth} × ${canvasHeight} px`;
  }

  function enterAddMode(on) {
    addMode = on;
    addButtonModeBtn.classList.toggle("btn-toggle-on", addMode);
    addButtonModeBtn.textContent = addMode
      ? "Режим: клик по схеме → новая кнопка"
      : "Режим: добавить кнопку";
    canvasEl.style.cursor = addMode ? "crosshair" : "default";
  }

  function clearCanvasButtons() {
    const existing = canvasEl.querySelectorAll(".map-button");
    existing.forEach((b) => b.remove());
  }

  function renderButtons() {
    clearCanvasButtons();
    for (const btn of buttons) {
      if (typeof btn.angle !== "number") {
        let base = 0;
        if (btn.direction) {
          const dir = btn.direction;
          if (dir === "se") base = 90;
          else if (dir === "sw") base = 180;
          else if (dir === "nw") base = 270;
        }
        btn.angle = base;
      }
      const el = document.createElement("button");
      el.className = "map-button";
      if (btn.id === lastClickedButtonId) {
        el.classList.add("map-button-last-clicked");
      }
      if (btn.id === searchHighlightedButtonId) {
        el.classList.add("map-button-search");
      }
      el.style.left = `${btn.x}px`;
      el.style.top = `${btn.y}px`;
      el.dataset.id = btn.id;
      el.dataset.editable = "true";
      el.style.setProperty("--angle-deg", `${btn.angle}deg`);
      const label = btn.label || "Точка";
      el.title = label;
      el.setAttribute("aria-label", label);

      el.addEventListener("click", (e) => {
        e.stopPropagation();
        if (e.altKey) {
          const shouldDelete = confirm("Удалить эту точку?");
          if (shouldDelete) {
            if (btn.id === lastClickedButtonId) {
              clearLastClickedButton();
            }
            if (btn.id === searchHighlightedButtonId) {
              clearSearchHighlight();
              setSearchStatus("", null);
            }
            buttons = buttons.filter((b) => b.id !== btn.id);
            renderButtons();
          }
          return;
        }
        setLastClickedButton(btn.id);
        renderButtons();
        if (!btn.url) return;
        window.open(buildOpenUrl(btn.url), "_blank", "noopener");
      });

      el.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        const newLabel = prompt("Надпись на точке:", btn.label || "");
        if (newLabel === null) return;
        const newUrl = prompt("Ссылка:", btn.url || "");
        if (newUrl === null) return;
        const currentAngle = typeof btn.angle === "number" ? btn.angle : 0;
        const angleDefault = String(Math.round(currentAngle));
        const newAngleInput = prompt(
          `${ANGLE_PROMPT}\nСейчас: ${angleDefault}`,
          angleDefault
        );
        btn.label = newLabel.trim() || "Точка";
        btn.url = newUrl.trim();
        if (newAngleInput !== null) {
          btn.angle = normalizeAngle(newAngleInput, currentAngle);
        }
        renderButtons();
      });

      canvasEl.appendChild(el);
    }
  }

  function createButtonAt(event) {
    if (!backgroundDataUrl) {
      alert("Сначала загрузите фон.");
      return;
    }
    const rect = canvasEl.getBoundingClientRect();
    const xOnCanvas = (event.clientX - rect.left) / scale;
    const yOnCanvas = (event.clientY - rect.top) / scale;

    if (
      xOnCanvas < 0 ||
      yOnCanvas < 0 ||
      xOnCanvas > canvasWidth ||
      yOnCanvas > canvasHeight
    ) {
      return;
    }

    const label = prompt("Надпись на точке:", "Точка");
    if (label === null) return;
    const url = prompt("Ссылка:", "https://");
    if (url === null) return;
    const angleInput = prompt(ANGLE_PROMPT, "0");

    const id = crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random();
    buttons.push({
      id,
      x: xOnCanvas,
      y: yOnCanvas,
      label: label.trim() || "Точка",
      url: url.trim(),
      angle: normalizeAngle(angleInput || "", 0),
    });
    renderButtons();
  }

  function loadBackgroundFromDataUrl(dataUrl, name) {
    const img = new Image();
    img.onload = () => {
      setCanvasSize(img.naturalWidth, img.naturalHeight);
      canvasEl.style.backgroundImage = `url(${dataUrl})`;
      const placeholder = canvasEl.querySelector(".placeholder");
      if (placeholder) placeholder.remove();
      backgroundDataUrl = dataUrl;
      backgroundName = name || "background";
      setScale(0.5);
      centerCanvasInViewport();
    };
    img.onerror = () => {
      alert("Не удалось загрузить фон. Попробуйте другой файл.");
    };
    img.src = dataUrl;
  }

  function centerCanvasInViewport() {
    requestAnimationFrame(() => {
      const vw = viewportEl.clientWidth;
      const vh = viewportEl.clientHeight;
      const cw = canvasWidth * scale;
      const ch = canvasHeight * scale;
      panX = (vw - cw) / 2;
      panY = (vh - ch) / 2;
      applyViewTransform();
    });
  }

  function handleBackgroundFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target.result;
      loadBackgroundFromDataUrl(dataUrl, file.name);
      buttons = [];
      clearLastClickedButton();
      clearSearchHighlight();
      setSearchStatus("", null);
      if (markerSearchInput) markerSearchInput.value = "";
      renderButtons();
    };
    reader.readAsDataURL(file);
  }

  function buildConfig() {
    return {
      version: 1,
      background: {
        name: backgroundName,
        dataUrl: backgroundDataUrl,
        width: canvasWidth,
        height: canvasHeight,
      },
      view: {
        scale,
      },
      buttons,
      savedAt: new Date().toISOString(),
    };
  }

  function getReleaseViewerCss() {
    return `
*,*::before,*::after{box-sizing:border-box}
html,body{margin:0;padding:0;height:100%;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#111827;background:#f3f4f6}
.app{display:flex;flex:1;min-height:100vh}
.sidebar{width:280px;max-width:100%;padding:16px;background:#fff;border-right:1px solid #e5e7eb;display:flex;flex-direction:column;gap:12px}
.app-title{margin:0;font-size:18px;font-weight:600}
.hint{margin:0;font-size:12px;color:#6b7280;line-height:1.4}
.panel{padding:12px;border-radius:8px;background:#f9fafb;border:1px solid #e5e7eb}
.panel h2{margin:0 0 8px;font-size:14px;font-weight:600}
.small{margin:8px 0 0;font-size:12px;color:#6b7280;line-height:1.5}
.btn{display:inline-flex;align-items:center;justify-content:center;padding:8px 12px;border-radius:8px;border:none;cursor:pointer;font-size:13px;font-weight:500}
.btn-secondary{background:#f5f3ff;color:#5b21b6;border:1px solid #ddd6fe}
.btn-compact{padding:6px 12px;font-size:12px}
.btn-primary{background:#7c3aed;color:#fff}
.search-row{display:flex;gap:8px;align-items:center}
.search-input{flex:1;min-width:0;padding:6px 10px;border-radius:8px;border:1px solid #d1d5db;font-size:13px;font-family:inherit;color:#111827;background:#fff}
.search-status{margin:6px 0 0;font-size:12px;line-height:1.4;min-height:1.2em}
.search-status.is-found{color:#b91c1c;font-weight:500}
.search-status.is-not-found{color:#6b7280}
.datetime-panel{display:flex;flex-direction:column;gap:8px}
.datetime-actions{display:flex;gap:8px;flex-wrap:wrap}
.date-label{display:flex;flex-direction:column;gap:4px;flex:1;min-width:140px;font-size:12px;color:#6b7280}
.date-label span{font-weight:500}
.date-label.has-date span{color:#111827}
.date-label input[type=date],.date-label .time-text-input{padding:6px 10px;border-radius:8px;border:1px solid #d1d5db;font-size:13px;font-family:inherit;color:#111827;background:#fff}
.date-label .time-text-input:disabled{background:#f3f4f6;color:#9ca3af;cursor:not-allowed}
.workspace{flex:1;display:flex;flex-direction:column;padding:14px 16px;min-width:0}
.viewport{flex:1;position:relative;border-radius:8px;background:#e5e7eb;border:1px solid #d1d5db;overflow:hidden;cursor:grab;touch-action:none}
.viewport.is-panning{cursor:grabbing;user-select:none}
.canvas{position:absolute;top:0;left:0;transform-origin:top left;will-change:transform;background-color:#f9fafb;background-size:contain;background-repeat:no-repeat;background-position:top left}
.map-button{position:absolute;transform:translate(-50%,-50%);width:26px;height:26px;padding:0;border:none;background:transparent;cursor:pointer}
.map-button::before{content:"";position:absolute;top:50%;left:50%;width:14px;height:14px;border-radius:50%;background:#16a34a;border:1px solid rgba(22,163,74,.8);transform:translate(-50%,-50%)}
.map-button::after{content:"";position:absolute;top:50%;left:50%;width:20px;height:20px;transform-origin:50% 50%;background:linear-gradient(#16a34a,#16a34a) 0 50%/60% 2px no-repeat,linear-gradient(#16a34a,#16a34a) 50% 0/2px 60% no-repeat;transform:translate(-50%,-50%) rotate(var(--angle-deg,0deg))}
.map-button-last-clicked::before{background:#a855f7;border-color:rgba(147,51,234,.9)}
.map-button-last-clicked::after{background:linear-gradient(#a855f7,#a855f7) 0 50%/60% 2px no-repeat,linear-gradient(#a855f7,#a855f7) 50% 0/2px 60% no-repeat}
@keyframes searchPulse{0%,100%{box-shadow:0 0 0 2px rgba(220,38,38,.7)}50%{box-shadow:0 0 0 4px rgba(220,38,38,.35)}}
.map-button-search::before{background:#dc2626;border-color:rgba(185,28,28,.9);animation:searchPulse 1.4s ease-in-out infinite}
.map-button-search::after{background:linear-gradient(#dc2626,#dc2626) 0 50%/60% 2px no-repeat,linear-gradient(#dc2626,#dc2626) 50% 0/2px 60% no-repeat}
@media(max-width:900px){.app{flex-direction:column}.sidebar{width:100%;border-right:none;border-bottom:1px solid #e5e7eb}}
`.trim();
  }

  function getReleaseViewerScript() {
    return `
(function(){
  var MIN_SCALE=0.1,MAX_SCALE=4,SCALE_STEP=0.1;
  var cfg=window.MAP_CONFIG;
  if(!cfg||!cfg.background||!cfg.background.dataUrl){document.body.innerHTML="<p style=padding:24px>Некорректные данные карты.</p>";return;}
  var viewport=document.getElementById("viewport");
  var canvas=document.getElementById("canvas");
  var zoomLevel=document.getElementById("zoomLevel");
  var playerDateInput=document.getElementById("playerDateInput");
  var playerTimeInput=document.getElementById("playerTimeInput");
  var resetPlayerDateBtn=document.getElementById("resetPlayerDateBtn");
  var resetPlayerTimeBtn=document.getElementById("resetPlayerTimeBtn");
  var playerDateModeLabel=document.getElementById("playerDateModeLabel");
  var playerDateLabel=playerDateInput?playerDateInput.closest(".date-label"):null;
  var resetViewBtn=document.getElementById("resetViewBtn");
  var markerSearchInput=document.getElementById("markerSearchInput");
  var markerSearchBtn=document.getElementById("markerSearchBtn");
  var markerSearchStatus=document.getElementById("markerSearchStatus");
  var buttons=Array.isArray(cfg.buttons)?cfg.buttons:[];
  var canvasWidth=cfg.background.width||800;
  var canvasHeight=cfg.background.height||600;
  var scale=cfg.view&&typeof cfg.view.scale==="number"?cfg.view.scale:0.5;
  var panX=0,panY=0,isPanning=false,panStartX=0,panStartY=0,panOriginX=0,panOriginY=0,activePanPointerId=null;
  var DEFAULT_TIME="00:00:00",selectedDateYmd=null,selectedTimeHm=DEFAULT_TIME,lastClickedButtonId=null,searchHighlightedButtonId=null;
  function padT(n){return String(n).padStart(2,"0");}
  function parsePastedTime(v){if(!v)return null;var t=String(v).trim();if(!t)return null;var m=t.match(/(\\d{1,2})[:\\-.](\\d{1,2})(?:[:\\-.](\\d{1,2}))?/);if(m){var hh=+m[1],mm=+m[2],ss=m[3]!==undefined?+m[3]:0;if(hh>=0&&hh<=23&&mm>=0&&mm<=59&&ss>=0&&ss<=59)return padT(hh)+":"+padT(mm)+":"+padT(ss);}var d=t.replace(/\\D/g,"");if(d.length===6){var h2=+d.slice(0,2),m2=+d.slice(2,4),s2=+d.slice(4,6);if(h2<=23&&m2<=59&&s2<=59)return padT(h2)+":"+padT(m2)+":"+padT(s2);}if(d.length===4){var h3=+d.slice(0,2),m3=+d.slice(2,4);if(h3<=23&&m3<=59)return padT(h3)+":"+padT(m3)+":00";}return null;}
  function normalizeTimeHms(v){return parsePastedTime(v)||DEFAULT_TIME;}
  function applyPlayerTimeFromInput(){if(!playerTimeInput||!selectedDateYmd)return;var p=parsePastedTime(playerTimeInput.value);if(p){selectedTimeHm=p;playerTimeInput.value=p;return;}if(playerTimeInput.value.trim()){selectedTimeHm=normalizeTimeHms(playerTimeInput.value);playerTimeInput.value=selectedTimeHm;}}
  function localDateTimeMs(ymd,timeHm){var p=ymd.split("-");if(p.length!==3)return null;var y=+p[0],m=+p[1],d=+p[2];if(!isFinite(y)||!isFinite(m)||!isFinite(d))return null;var tp=normalizeTimeHms(timeHm).split(":"),hh=+tp[0],mm=+tp[1],ss=+tp[2];if(!isFinite(hh)||!isFinite(mm)||!isFinite(ss))return null;return new Date(y,m-1,d,hh,mm,ss,0).getTime();}
  function getCanonicalPathname(path){if(path.indexOf("/v2/cameras/player/")!==-1)return path.replace("/v2/cameras/player/","/player/");if(path.indexOf("/v2/player/")!==-1)return path.replace("/v2/player/","/player/");return path;}
  function extractPlayerId(query){if(!query)return null;var t=String(query).trim();if(!t)return null;try{var u=new URL(t);var p=getCanonicalPathname(u.pathname),m=p.match(/\\/player\\/([^/?#]+)\\/?$/i);if(m)return m[1];}catch(e){}var pl=t.replace(/^https?:\\/\\/[^/]+/i,""),pm=pl.match(/(?:^|\\/)player\\/([^/?#]+)\\/?$/i);if(pm)return pm[1];if(/^\\d+$/.test(t))return t;return null;}
  function getButtonPlayerId(btn){if(!btn||!btn.url)return null;try{var u=new URL(btn.url),p=getCanonicalPathname(u.pathname),m=p.match(/\\/player\\/([^/?#]+)\\/?$/i);return m?m[1]:null;}catch(e){var f=String(btn.url).match(/\\/player\\/([^/?#]+)\\/?$/i);return f?f[1]:null;}}
  function findButtonBySearch(query){var t=(query||"").trim();if(!t)return null;var pid=extractPlayerId(t);if(pid){var byId=buttons.find(function(b){return getButtonPlayerId(b)===pid;});if(byId)return byId;}var low=t.toLowerCase();return buttons.find(function(b){return b.url&&b.url.toLowerCase().indexOf(low)!==-1;})||buttons.find(function(b){return b.label&&b.label.toLowerCase().indexOf(low)!==-1;})||null;}
  function setSearchStatus(msg,type){if(!markerSearchStatus)return;markerSearchStatus.textContent=msg||"";markerSearchStatus.classList.remove("is-found","is-not-found");if(type)markerSearchStatus.classList.add(type);}
  function focusOnButton(btn){if(!btn)return;requestAnimationFrame(function(){var vw=viewport.clientWidth,vh=viewport.clientHeight;panX=vw/2-btn.x*scale;panY=vh/2-btn.y*scale;applyViewTransform();});}
  function runMarkerSearch(){var q=markerSearchInput?markerSearchInput.value:"",t=q.trim();if(!t){searchHighlightedButtonId=null;setSearchStatus("",null);renderButtons();return;}var found=findButtonBySearch(t);if(!found){searchHighlightedButtonId=null;setSearchStatus("Камера не найдена","is-not-found");renderButtons();return;}searchHighlightedButtonId=found.id;renderButtons();focusOnButton(found);setSearchStatus("Найдено: "+(found.label||"Точка"),"is-found");}
  function buildOpenUrl(raw){if(!raw)return raw;try{var url=new URL(raw);}catch(e){return raw;}url.searchParams.delete("date");url.pathname=getCanonicalPathname(url.pathname);if(selectedDateYmd){var ms=localDateTimeMs(selectedDateYmd,selectedTimeHm);if(ms!==null)url.searchParams.set("date",String(ms));}return url.toString();}
  function applyViewTransform(){canvas.style.transform="translate("+panX+"px,"+panY+"px) scale("+scale+")";}
  function setScale(next){scale=Math.min(MAX_SCALE,Math.max(MIN_SCALE,next));applyViewTransform();if(zoomLevel)zoomLevel.textContent=Math.round(scale*100)+"%";}
  function setScaleAt(next,cx,cy){var c=Math.min(MAX_SCALE,Math.max(MIN_SCALE,next));if(c===scale)return;var r=viewport.getBoundingClientRect(),mx=cx-r.left,my=cy-r.top,canvasX=(mx-panX)/scale,canvasY=(my-panY)/scale;scale=c;panX=mx-canvasX*scale;panY=my-canvasY*scale;applyViewTransform();if(zoomLevel)zoomLevel.textContent=Math.round(scale*100)+"%";}
  function centerCanvas(){requestAnimationFrame(function(){var vw=viewport.clientWidth,vh=viewport.clientHeight,cw=canvasWidth*scale,ch=canvasHeight*scale;panX=(vw-cw)/2;panY=(vh-ch)/2;applyViewTransform();});}
  function updatePlayerDateUi(){var has=!!selectedDateYmd;if(playerDateInput)playerDateInput.value=selectedDateYmd||"";if(playerTimeInput){playerTimeInput.disabled=!has;playerTimeInput.value=has?(selectedTimeHm||DEFAULT_TIME):DEFAULT_TIME;}if(playerDateModeLabel)playerDateModeLabel.textContent=has?"Дата архива":"Сейчас";if(playerDateLabel){playerDateLabel.classList.toggle("has-date",has);playerDateLabel.classList.toggle("is-live",!has);}}
  function normalizeAngle(btn){if(typeof btn.angle!=="number"){var base=0;if(btn.direction==="se")base=90;else if(btn.direction==="sw")base=180;else if(btn.direction==="nw")base=270;btn.angle=base;}}
  function renderButtons(){canvas.querySelectorAll(".map-button").forEach(function(el){el.remove();});buttons.forEach(function(btn){normalizeAngle(btn);var el=document.createElement("button");el.className="map-button";if(btn.id===lastClickedButtonId)el.classList.add("map-button-last-clicked");if(btn.id===searchHighlightedButtonId)el.classList.add("map-button-search");el.style.left=btn.x+"px";el.style.top=btn.y+"px";el.style.setProperty("--angle-deg",(btn.angle||0)+"deg");var label=btn.label||"Точка";el.title=label;el.setAttribute("aria-label",label);el.addEventListener("click",function(e){e.stopPropagation();lastClickedButtonId=btn.id;renderButtons();if(btn.url)window.open(buildOpenUrl(btn.url),"_blank","noopener");});canvas.appendChild(el);});}
  canvas.style.width=canvasWidth+"px";canvas.style.height=canvasHeight+"px";canvas.style.backgroundImage="url("+cfg.background.dataUrl+")";
  renderButtons();setScale(scale);centerCanvas();updatePlayerDateUi();
  if(playerDateInput)playerDateInput.addEventListener("change",function(){selectedDateYmd=playerDateInput.value.trim()||null;if(selectedDateYmd)selectedTimeHm=normalizeTimeHms(selectedTimeHm);updatePlayerDateUi();});
  if(playerTimeInput){playerTimeInput.addEventListener("paste",function(e){if(!selectedDateYmd)return;var txt=e.clipboardData&&e.clipboardData.getData("text");if(!txt)return;var p=parsePastedTime(txt);if(!p)return;e.preventDefault();selectedTimeHm=p;playerTimeInput.value=p;});playerTimeInput.addEventListener("input",applyPlayerTimeFromInput);playerTimeInput.addEventListener("change",applyPlayerTimeFromInput);playerTimeInput.addEventListener("blur",applyPlayerTimeFromInput);}
  if(resetPlayerDateBtn)resetPlayerDateBtn.addEventListener("click",function(){selectedDateYmd=null;selectedTimeHm=DEFAULT_TIME;updatePlayerDateUi();});
  if(resetPlayerTimeBtn)resetPlayerTimeBtn.addEventListener("click",function(){selectedTimeHm=DEFAULT_TIME;if(playerTimeInput)playerTimeInput.value=DEFAULT_TIME;});
  if(resetViewBtn)resetViewBtn.addEventListener("click",function(){setScale(1);centerCanvas();});
  if(markerSearchBtn)markerSearchBtn.addEventListener("click",runMarkerSearch);
  if(markerSearchInput)markerSearchInput.addEventListener("keydown",function(e){if(e.key==="Enter"){e.preventDefault();runMarkerSearch();}});
  viewport.addEventListener("wheel",function(e){e.preventDefault();setScaleAt(scale+(e.deltaY>0?-SCALE_STEP:SCALE_STEP),e.clientX,e.clientY);},{passive:false});
  function startPan(e){if(e.pointerType==="mouse"&&e.button!==0)return;var t=e.target;if(t.closest&&t.closest(".map-button"))return;isPanning=true;activePanPointerId=e.pointerId;viewport.classList.add("is-panning");panStartX=e.clientX;panStartY=e.clientY;panOriginX=panX;panOriginY=panY;if(viewport.setPointerCapture)viewport.setPointerCapture(e.pointerId);e.preventDefault();}
  function movePan(e){if(!isPanning||e.pointerId!==activePanPointerId)return;panX=panOriginX+(e.clientX-panStartX);panY=panOriginY+(e.clientY-panStartY);applyViewTransform();e.preventDefault();}
  function endPan(e){if(!isPanning||e.pointerId!==activePanPointerId)return;isPanning=false;activePanPointerId=null;viewport.classList.remove("is-panning");if(viewport.releasePointerCapture){try{viewport.releasePointerCapture(e.pointerId);}catch(err){}}}
  viewport.addEventListener("pointerdown",startPan);viewport.addEventListener("pointermove",movePan);viewport.addEventListener("pointerup",endPan);viewport.addEventListener("pointercancel",endPan);
})();
`.trim();
  }

  function buildExportHtml(config) {
    const title = (config.background && config.background.name) || "Карта";
    const safeTitle = title.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const configJson = JSON.stringify(config);
    const css = getReleaseViewerCss();
    const script = getReleaseViewerScript();

    return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <title>${safeTitle}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>${css}</style>
</head>
<body>
  <div class="app">
    <aside class="sidebar">
      <h1 class="app-title">${safeTitle}</h1>
      <p class="hint">Колесико — масштаб, ЛКМ — перемещение. Клик по точке — переход.</p>
      <section class="panel">
        <h2>Просмотр</h2>
        <div class="datetime-panel">
          <label class="date-label is-live" for="playerDateInput">
            <span id="playerDateModeLabel">Сейчас</span>
            <input type="date" id="playerDateInput" />
          </label>
          <label class="date-label" for="playerTimeInput">
            <span>Время</span>
            <input type="text" id="playerTimeInput" class="time-text-input" value="00:00:00" placeholder="00:00:00" inputmode="numeric" autocomplete="off" spellcheck="false" disabled />
          </label>
          <div class="datetime-actions">
            <button type="button" id="resetPlayerDateBtn" class="btn btn-secondary btn-compact">Сейчас</button>
            <button type="button" id="resetPlayerTimeBtn" class="btn btn-secondary btn-compact">00:00</button>
          </div>
        </div>
        <p class="small">Дата и время для архива. Можно вставить из буфера.</p>
      </section>
      <section class="panel">
        <h2>Поиск</h2>
        <div class="search-row">
          <input type="search" id="markerSearchInput" class="search-input" placeholder="ID или ссылка" autocomplete="off" />
          <button type="button" id="markerSearchBtn" class="btn btn-primary btn-compact">Найти</button>
        </div>
        <p id="markerSearchStatus" class="search-status"></p>
        <p class="small">ID или ссылка …/player/464536 — точка подсветится.</p>
      </section>
      <section class="panel">
        <h2>Масштаб</h2>
        <button type="button" id="resetViewBtn" class="btn btn-secondary">Сбросить вид</button>
        <p class="small">Масштаб: <span id="zoomLevel">100%</span></p>
      </section>
    </aside>
    <main class="workspace">
      <div id="viewport" class="viewport">
        <div id="canvas" class="canvas"></div>
      </div>
    </main>
  </div>
  <script>window.MAP_CONFIG=${configJson};${script}</script>
</body>
</html>`;
  }

  function saveReleaseToFile() {
    if (!backgroundDataUrl) {
      alert("Нечего экспортировать: загрузите фон и настройте точки.");
      return;
    }
    const html = buildExportHtml(buildConfig());
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = (backgroundName || "map") + "-release.html";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function saveConfigToFile() {
    if (!backgroundDataUrl) {
      alert("Нечего сохранять: загрузите фон и добавьте кнопки.");
      return;
    }
    const config = buildConfig();
    const blob = new Blob([JSON.stringify(config, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = (backgroundName || "layout") + "-layout.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function applyConfig(config) {
    if (!config || !config.background || !config.background.dataUrl) {
      alert("Некорректный конфиг.");
      return;
    }
    clearLastClickedButton();
    clearSearchHighlight();
    setSearchStatus("", null);
    if (markerSearchInput) markerSearchInput.value = "";
    backgroundDataUrl = config.background.dataUrl;
    backgroundName = config.background.name || "background";
    loadBackgroundFromDataUrl(backgroundDataUrl, backgroundName);

    buttons = Array.isArray(config.buttons) ? config.buttons : [];
    renderButtons();

    if (config.view && typeof config.view.scale === "number") {
      setScale(config.view.scale);
    }
  }

  function handleConfigFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const config = JSON.parse(e.target.result);
        applyConfig(config);
      } catch (err) {
        console.error(err);
        alert("Не удалось прочитать конфиг. Проверьте файл.");
      }
    };
    reader.readAsText(file, "utf-8");
  }

  backgroundInput.addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    handleBackgroundFile(file);
    backgroundInput.value = "";
  });

  configInput.addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    handleConfigFile(file);
    configInput.value = "";
  });

  if (playerDateInput) {
    playerDateInput.addEventListener("change", () => {
      const value = playerDateInput.value.trim();
      selectedDateYmd = value || null;
      if (selectedDateYmd) {
        selectedTimeHm = normalizeTimeHms(selectedTimeHm);
      }
      updatePlayerDateUi();
    });
  }

  setupPlayerTimeInput();

  if (resetPlayerDateBtn) {
    resetPlayerDateBtn.addEventListener("click", () => {
      resetPlayerDate();
    });
  }

  if (resetPlayerTimeBtn) {
    resetPlayerTimeBtn.addEventListener("click", () => {
      resetPlayerTimeToMidnight();
    });
  }

  if (markerSearchBtn) {
    markerSearchBtn.addEventListener("click", () => {
      runMarkerSearch();
    });
  }

  if (markerSearchInput) {
    markerSearchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        runMarkerSearch();
      }
    });
  }

  addButtonModeBtn.addEventListener("click", () => {
    enterAddMode(!addMode);
  });

  saveConfigBtn.addEventListener("click", () => {
    saveConfigToFile();
  });

  if (exportReleaseBtn) {
    exportReleaseBtn.addEventListener("click", () => {
      saveReleaseToFile();
    });
  }

  resetViewBtn.addEventListener("click", () => {
    setScale(1);
    centerCanvasInViewport();
  });

  canvasEl.addEventListener("click", (e) => {
    if (!addMode) return;
    createButtonAt(e);
  });

  viewportEl.addEventListener(
    "wheel",
    (e) => {
      if (!backgroundDataUrl) return;
      e.preventDefault();
      const direction = e.deltaY > 0 ? -1 : 1;
      const nextScale = scale + direction * SCALE_STEP;
      setScaleAt(nextScale, e.clientX, e.clientY);
    },
    { passive: false }
  );

  function startPan(e) {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    if (!backgroundDataUrl) return;
    if (addMode) return;
    const target = e.target;
    if (target instanceof HTMLElement && target.closest(".map-button")) return;
    isPanning = true;
    activePanPointerId = e.pointerId;
    viewportEl.classList.add("is-panning");
    panStartX = e.clientX;
    panStartY = e.clientY;
    panOriginX = panX;
    panOriginY = panY;
    if (viewportEl.setPointerCapture) {
      viewportEl.setPointerCapture(e.pointerId);
    }
    e.preventDefault();
  }

  function movePan(e) {
    if (!isPanning || e.pointerId !== activePanPointerId) return;
    panX = panOriginX + (e.clientX - panStartX);
    panY = panOriginY + (e.clientY - panStartY);
    applyViewTransform();
    e.preventDefault();
  }

  function endPan(e) {
    if (!isPanning) return;
    if (e.pointerId !== activePanPointerId) return;
    isPanning = false;
    activePanPointerId = null;
    viewportEl.classList.remove("is-panning");
    if (viewportEl.releasePointerCapture) {
      try {
        viewportEl.releasePointerCapture(e.pointerId);
      } catch {}
    }
  }

  viewportEl.addEventListener("pointerdown", startPan);
  viewportEl.addEventListener("pointermove", movePan);
  viewportEl.addEventListener("pointerup", endPan);
  viewportEl.addEventListener("pointercancel", endPan);

  canvasEl.addEventListener("contextmenu", (e) => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    if (!target.classList.contains("map-button")) return;
    e.preventDefault();
    e.stopPropagation();
    const id = target.dataset.id;
    if (!id) return;
    contextMenuTargetId = id;

    const menuWidth = markerContextMenu.offsetWidth || 180;
    const menuHeight = markerContextMenu.offsetHeight || 100;
    let x = e.clientX;
    let y = e.clientY;

    if (x + menuWidth > window.innerWidth) x = window.innerWidth - menuWidth - 8;
    if (y + menuHeight > window.innerHeight) y = window.innerHeight - menuHeight - 8;

    markerContextMenu.style.left = `${x}px`;
    markerContextMenu.style.top = `${y}px`;
    markerContextMenu.classList.add("visible");
  });

  function closeContextMenu() {
    markerContextMenu.classList.remove("visible");
    contextMenuTargetId = null;
  }

  markerContextMenu.addEventListener("click", (e) => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    const action = target.dataset.action;
    if (!action || !contextMenuTargetId) {
      closeContextMenu();
      return;
    }
    const btn = buttons.find((b) => b.id === contextMenuTargetId);
    if (!btn) {
      closeContextMenu();
      return;
    }

    if (action === "edit-link") {
      const newUrl = prompt("Ссылка:", btn.url || "https://");
      if (newUrl !== null) {
        btn.url = newUrl.trim();
        renderButtons();
      }
    } else if (action === "edit-direction") {
      const currentAngle = typeof btn.angle === "number" ? btn.angle : 0;
      const angleDefault = String(Math.round(currentAngle));
      const newAngleInput = prompt(
        `${ANGLE_PROMPT}\nСейчас: ${angleDefault}`,
        angleDefault
      );
      if (newAngleInput !== null) {
        btn.angle = normalizeAngle(newAngleInput, currentAngle);
        renderButtons();
      }
    } else if (action === "delete") {
      const shouldDelete = confirm("Удалить эту точку?");
      if (shouldDelete) {
        if (btn.id === lastClickedButtonId) {
          clearLastClickedButton();
        }
        if (btn.id === searchHighlightedButtonId) {
          clearSearchHighlight();
          setSearchStatus("", null);
        }
        buttons = buttons.filter((b) => b.id !== btn.id);
        renderButtons();
      }
    }

    closeContextMenu();
  });

  document.addEventListener("click", (e) => {
    const target = e.target;
    if (target instanceof HTMLElement && target.closest("#markerContextMenu")) {
      return;
    }
    if (markerContextMenu.classList.contains("visible")) {
      closeContextMenu();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && markerContextMenu.classList.contains("visible")) {
      closeContextMenu();
    }
  });

  setCanvasSize(canvasWidth, canvasHeight);
  setScale(1);
  applyViewTransform();
  updatePlayerDateUi();
})();

