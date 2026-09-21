const form = document.querySelector("#wish-form");
const wishInput = document.querySelector("#wish");
const submitButton = form.querySelector("button");
const flyingWish = document.querySelector("#flying-wish");
const paperName = document.querySelector("#paper-name");
const paperWish = document.querySelector("#paper-wish");
const statusMessage = document.querySelector("#status-message");
const wishCount = document.querySelector("#wish-count");
const moon = document.querySelector("#moon");
const sharePanel = document.querySelector("#share-panel");
const saveWishImageButton = document.querySelector("#save-wish-image");
const shareWishImageButton = document.querySelector("#share-wish-image");
const newWishButton = document.querySelector("#new-wish");
const includeNameCheckbox = document.querySelector("#include-name");
const sharePreview = document.querySelector("#share-preview");

const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const allowsParallax = window.matchMedia("(pointer: fine)");
const counterStorageKey = "harvestMoonWishCount";
const counterApiBase = "https://countapi.mileshilliard.com/api/v1";
const counterApiKey = "wish2harvestmoon-io-wishes";
let sessionWishCount = 0;
let lastWishForSharing = null;
let shareImageBlob = null;
let shareImageUrl = "";
let sharePreviewKey = "";
let pendingParallaxFrame = 0;
let pendingParallaxEvent = null;
const imageCache = new Map();
const blockedTerms = [
  "asshole",
  "bitch",
  "bullshit",
  "cunt",
  "dick",
  "fag",
  "faggot",
  "fuck",
  "kike",
  "nazi",
  "nigga",
  "nigger",
  "piss",
  "pussy",
  "retard",
  "shit",
  "slut",
  "spic",
  "tranny",
  "whore",
];
const blockedPhrases = [
  "fuck off",
  "fuck you",
  "go kill yourself",
  "kill yourself",
  "screw you",
];
const blockedTermPatterns = blockedTerms.map((term) => ({
  compact: term.replace(/[^a-z0-9]+/g, ""),
  boundary: new RegExp(`(^|[^a-z0-9])${term}([^a-z0-9]|$)`),
}));

function readStoredCounter() {
  try {
    return window.localStorage?.getItem(counterStorageKey) ?? null;
  } catch {
    return null;
  }
}

function writeStoredCounter(count) {
  try {
    window.localStorage?.setItem(counterStorageKey, String(count));
  } catch {
    sessionWishCount = count;
  }
}

function getStoredWishCount() {
  const savedCount = Number.parseInt(readStoredCounter(), 10);
  return Number.isFinite(savedCount) && savedCount > 0 ? savedCount : sessionWishCount;
}

function renderWishCount(count) {
  const noun = count === 1 ? "wish has" : "wishes have";
  wishCount.textContent = `${count.toLocaleString()} ${noun} reached the moon.`;
}

function syncLocalCounter(count) {
  sessionWishCount = count;
  writeStoredCounter(count);
}

function parseCounterValue(data) {
  const value = Number.parseInt(data?.value, 10);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

async function requestSharedCounter(action) {
  const response = await fetch(`${counterApiBase}/${action}/${counterApiKey}`, {
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Shared counter unavailable");

  const value = parseCounterValue(await response.json());
  if (value === null) throw new Error("Shared counter response invalid");

  syncLocalCounter(value);
  renderWishCount(value);
  return value;
}

async function loadWishCount() {
  renderWishCount(getStoredWishCount());

  try {
    await requestSharedCounter("get");
  } catch {
    renderWishCount(getStoredWishCount());
  }
}

async function recordWishArrival() {
  try {
    return await requestSharedCounter("hit");
  } catch {
    // GitHub Pages cannot persist data by itself, so keep a private device fallback.
  }

  const nextCount = getStoredWishCount() + 1;
  syncLocalCounter(nextCount);
  renderWishCount(nextCount);
  return nextCount;
}

function resetFlyingWish() {
  flyingWish.classList.remove("active");
  moon.classList.remove("arrived");
  void flyingWish.offsetWidth;
}

function setStatus(message, type = "") {
  statusMessage.textContent = message;
  statusMessage.classList.toggle("error", type === "error");
}

function normalizeForModeration(text) {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[@]/g, "a")
    .replace(/[!1|]/g, "i")
    .replace(/[$5]/g, "s")
    .replace(/[0]/g, "o")
    .replace(/[3]/g, "e")
    .replace(/[7]/g, "t");
}

function containsBlockedLanguage(text) {
  const normalized = normalizeForModeration(text);
  const spaced = normalized.replace(/[^a-z0-9]+/g, " ").trim();
  const compact = normalized.replace(/[^a-z0-9]+/g, "");

  if (blockedPhrases.some((phrase) => spaced.includes(phrase))) return true;

  return blockedTermPatterns.some((term) => term.boundary.test(spaced) || compact.includes(term.compact));
}

function markWishInvalid(message) {
  wishInput.classList.add("is-invalid");
  wishInput.setAttribute("aria-invalid", "true");
  wishInput.focus();
  setStatus(message, "error");
}

function clearShareImageUrl() {
  if (shareImageUrl) {
    URL.revokeObjectURL(shareImageUrl);
    shareImageUrl = "";
  }
}

async function prepareSharePreview() {
  if (!lastWishForSharing) return;

  const previewKey = JSON.stringify({
    ...lastWishForSharing,
    includeName: includeNameCheckbox.checked,
  });
  if (shareImageBlob && sharePreviewKey === previewKey) return;

  sharePreview.hidden = true;
  sharePreview.removeAttribute("src");
  clearShareImageUrl();
  shareImageBlob = await buildWishImage({
    ...lastWishForSharing,
    includeName: includeNameCheckbox.checked,
  });
  sharePreviewKey = previewKey;
  shareImageUrl = URL.createObjectURL(shareImageBlob);
  sharePreview.src = shareImageUrl;
  sharePreview.hidden = false;
}

async function completeWishJourney(button) {
  setStatus("Your wish has reached the moon. Happy Mid-Autumn Festival.");
  await recordWishArrival();
  form.reset();
  paperName.textContent = "";
  paperWish.textContent = "";
  sharePanel.hidden = false;
  button.disabled = false;
  queueSharePreview();
}

function wrapCanvasText(context, text, x, y, maxWidth, lineHeight, maxLines) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = "";

  words.forEach((word) => {
    const testLine = line ? `${line} ${word}` : word;
    if (context.measureText(testLine).width <= maxWidth) {
      line = testLine;
      return;
    }

    if (line) lines.push(line);
    line = word;
  });

  if (line) lines.push(line);

  const visibleLines = lines.slice(0, maxLines);
  visibleLines.forEach((canvasLine, index) => {
    const displayLine = index === maxLines - 1 && lines.length > maxLines ? `${canvasLine}...` : canvasLine;
    context.fillText(displayLine, x, y + index * lineHeight);
  });
  return visibleLines.length;
}

function loadImage(src) {
  if (imageCache.has(src)) return imageCache.get(src);

  const imagePromise = new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
  imageCache.set(src, imagePromise);
  return imagePromise;
}

function drawImageCover(context, image, width, height) {
  const scale = Math.max(width / image.width, height / image.height);
  const scaledWidth = image.width * scale;
  const scaledHeight = image.height * scale;
  const offsetX = (width - scaledWidth) / 2;
  const offsetY = (height - scaledHeight) / 2;
  context.drawImage(image, offsetX, offsetY, scaledWidth, scaledHeight);
}

async function buildWishImage({ name, wish, includeName }) {
  const canvas = document.createElement("canvas");
  const width = 1080;
  const height = 1350;
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  const skyImage = await loadImage("assets/harvest-sky.png");
  const ksaLanternImage = await loadImage("assets/ksa-lantern.png");
  const kairosLanternImage = await loadImage("assets/kairos-lantern.png");
  const smallLanternsImage = await loadImage("assets/small-lanterns.png");

  drawImageCover(context, skyImage, width, height);

  const skyGlow = context.createRadialGradient(760, 280, 50, 760, 280, 480);
  skyGlow.addColorStop(0, "rgba(255, 225, 139, 0.45)");
  skyGlow.addColorStop(1, "rgba(255, 225, 139, 0)");
  context.fillStyle = skyGlow;
  context.fillRect(0, 0, width, height);

  context.beginPath();
  context.arc(760, 280, 150, 0, Math.PI * 2);
  context.fillStyle = "#ffe49a";
  context.shadowColor = "rgba(255, 219, 133, 0.85)";
  context.shadowBlur = 70;
  context.fill();
  context.shadowBlur = 0;

  context.globalAlpha = 0.88;
  context.drawImage(ksaLanternImage, 70, 100, 250, 334);
  context.globalAlpha = 0.8;
  context.drawImage(kairosLanternImage, 805, 430, 210, 279);
  context.globalAlpha = 0.58;
  context.drawImage(smallLanternsImage, 545, 700, 130, 189);
  context.globalAlpha = 0.48;
  context.drawImage(smallLanternsImage, 890, 795, 105, 153);
  context.globalAlpha = 1;

  context.fillStyle = "rgba(255, 243, 207, 0.94)";
  context.beginPath();
  context.roundRect(95, 600, 890, 540, 24);
  context.fill();

  context.fillStyle = "#7b4d37";
  context.font = "700 30px system-ui, sans-serif";
  context.fillText("WISHES TO THE HARVEST MOON", 150, 680);

  context.fillStyle = "#3c2636";
  context.font = "700 68px Georgia, serif";
  const titleLines = wrapCanvasText(context, "Wishes to the Harvest Moon", 150, 770, 780, 76, 2);

  context.font = "48px Georgia, serif";
  wrapCanvasText(context, wish, 150, 820 + titleLines * 76, 780, 70, 4);

  if (includeName && name) {
    context.fillStyle = "#6b4148";
    context.font = "600 34px system-ui, sans-serif";
    context.fillText(`- ${name}`, 150, 1110);
  }

  context.fillStyle = "rgba(67, 32, 61, 0.86)";
  context.font = "700 28px system-ui, sans-serif";
  context.fillText("Sent privately from my device", 150, 1215);
  context.fillStyle = "rgba(67, 32, 61, 0.58)";
  context.font = "500 22px system-ui, sans-serif";
  context.fillText(new Date().toLocaleString([], { dateStyle: "medium", timeStyle: "short" }), 150, 1252);

  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

async function saveWishImage() {
  if (!lastWishForSharing) return;

  saveWishImageButton.disabled = true;
  saveWishImageButton.textContent = "Preparing image...";

  try {
    if (!shareImageBlob) await prepareSharePreview();
    const imageUrl = URL.createObjectURL(shareImageBlob);
    const link = document.createElement("a");
    link.href = imageUrl;
    link.download = "harvest-moon-wish.png";
    link.rel = "noopener";
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(imageUrl), 1000);
    setStatus("Your wish image is ready to share.");
  } catch {
    setStatus("The image could not be prepared. Please try again.", "error");
  } finally {
    saveWishImageButton.disabled = false;
    saveWishImageButton.textContent = "Save image";
  }
}

async function shareWishImage() {
  if (!lastWishForSharing) return;

  shareWishImageButton.disabled = true;
  shareWishImageButton.textContent = "Preparing...";

  try {
    if (!shareImageBlob) await prepareSharePreview();
    const file = new File([shareImageBlob], "harvest-moon-wish.png", { type: "image/png" });
    const shareData = {
      title: "Wishes to the Harvest Moon",
      text: "A wish sent to the Harvest Moon.",
      files: [file],
    };

    if (navigator.canShare?.(shareData) && navigator.share) {
      await navigator.share(shareData);
      setStatus("Your wish image is ready to share.");
    } else {
      await saveWishImage();
      setStatus("Sharing is not available here, so the image was saved instead.");
    }
  } catch (error) {
    if (error?.name !== "AbortError") {
      setStatus("Sharing is not available here. You can still save the image.", "error");
    }
  } finally {
    shareWishImageButton.disabled = false;
    shareWishImageButton.textContent = "Share";
  }
}

function startNewWish() {
  sharePanel.hidden = true;
  lastWishForSharing = null;
  shareImageBlob = null;
  sharePreviewKey = "";
  clearShareImageUrl();
  sharePreview.hidden = true;
  sharePreview.removeAttribute("src");
  setStatus("");
  form.reset();
  wishInput.classList.remove("is-invalid");
  wishInput.removeAttribute("aria-invalid");
  wishInput.focus();
}

form.addEventListener("submit", (event) => {
  event.preventDefault();

  const data = new FormData(form);
  const name = data.get("name").trim();
  const wish = data.get("wish").trim();

  if (!wish) {
    markWishInvalid("Write a wish before sending it to the moon.");
    return;
  }

  if (containsBlockedLanguage(`${name} ${wish}`)) {
    markWishInvalid("Please rewrite your wish with kinder language before sending it to the moon.");
    return;
  }

  submitButton.disabled = true;
  wishInput.classList.remove("is-invalid");
  wishInput.removeAttribute("aria-invalid");
  setStatus("Folding your wish...");
  sharePanel.hidden = true;
  shareImageBlob = null;
  sharePreviewKey = "";
  clearShareImageUrl();
  lastWishForSharing = { name, wish };
  paperName.textContent = name ? `From ${name}` : "A quiet anonymous wish";
  paperWish.textContent = wish;
  resetFlyingWish();

  if (prefersReducedMotion.matches) {
    completeWishJourney(submitButton).catch(() => {
      submitButton.disabled = false;
      setStatus("Your wish reached the moon, but the share preview could not be prepared.", "error");
    });
    return;
  }

  flyingWish.classList.add("active");

  window.setTimeout(() => {
    moon.classList.add("arrived");
    completeWishJourney(submitButton).catch(() => {
      submitButton.disabled = false;
      setStatus("Your wish reached the moon, but the share preview could not be prepared.", "error");
    });
  }, 4300);
});

saveWishImageButton.addEventListener("click", saveWishImage);
shareWishImageButton.addEventListener("click", shareWishImage);
newWishButton.addEventListener("click", startNewWish);
includeNameCheckbox.addEventListener("change", () => {
  shareImageBlob = null;
  sharePreviewKey = "";
  prepareSharePreview().catch(() => {
    setStatus("The preview could not be refreshed. Please try again.", "error");
  });
});
flyingWish.addEventListener("animationend", (event) => {
  if (event.animationName === "wishFlight") {
    flyingWish.classList.remove("active");
  }
});

function queueSharePreview() {
  const prepare = () => {
    prepareSharePreview().catch(() => {
      setStatus("Your wish reached the moon, but the share preview could not be prepared.", "error");
    });
  };

  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(prepare, { timeout: 900 });
    return;
  }

  window.setTimeout(prepare, 80);
}

function preloadShareAssets() {
  const preload = () => {
    loadImage("assets/harvest-sky.png").catch(() => {});
    loadImage("assets/ksa-lantern.png").catch(() => {});
    loadImage("assets/kairos-lantern.png").catch(() => {});
    loadImage("assets/small-lanterns.png").catch(() => {});
  };

  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(preload, { timeout: 1500 });
    return;
  }

  window.setTimeout(preload, 300);
}

function updateParallax() {
  pendingParallaxFrame = 0;
  if (!pendingParallaxEvent) return;

  const x = (pendingParallaxEvent.clientX / window.innerWidth - 0.5) * 6;
  const y = (pendingParallaxEvent.clientY / window.innerHeight - 0.5) * 6;
  document.documentElement.style.setProperty("--parallax-x", `${x}px`);
  document.documentElement.style.setProperty("--parallax-y", `${y}px`);
  pendingParallaxEvent = null;
}

window.addEventListener("pointermove", (event) => {
  if (prefersReducedMotion.matches || !allowsParallax.matches) return;

  pendingParallaxEvent = event;
  if (!pendingParallaxFrame) {
    pendingParallaxFrame = window.requestAnimationFrame(updateParallax);
  }
}, { passive: true });

loadWishCount();
preloadShareAssets();
