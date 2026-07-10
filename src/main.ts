import "./styles.css";
import { SnowAudio } from "./audio/snow-audio";
import { isTouchInputCapable, normalizeTouchStick } from "./input/touch-controls";
import { SnowWorldView } from "./presentation/snow-world-view";
import { SnowSimulation, type SnowTool, type WeatherState } from "./simulation/snow-simulation";
import { hasSavedWorld, loadWorld, saveWorld, type WorldSave } from "./platform/storage";
import { generateWorld } from "./world/generator";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Application root is missing.");
const touchCapable = isTouchInputCapable();
document.documentElement.classList.toggle("touch-capable", touchCapable);

app.innerHTML = `
  <main class="game-shell">
    <canvas id="world-canvas" aria-label="Interactive procedural snow world"></canvas>
    <div class="atmosphere" aria-hidden="true"></div>
    <div class="vignette" aria-hidden="true"></div>

    <header class="topbar hud-layer" aria-label="World status">
      <div class="brand-lockup">
        <div class="brand-mark" aria-hidden="true"><span></span><span></span><span></span></div>
        <div>
          <div class="brand-name">SILTLANDS</div>
          <div class="brand-subtitle">Snow laboratory <span>01</span></div>
        </div>
      </div>
      <div class="condition-pill glass-panel">
        <span class="condition-icon" aria-hidden="true">❄</span>
        <div><small>ACTIVE WEATHER</small><strong id="condition-label">Powder snowfall</strong></div>
        <span class="condition-separator"></span>
        <div><small>AIR</small><strong id="air-readout">−7.0°C</strong></div>
        <span class="condition-separator"></span>
        <div><small>WIND</small><strong id="wind-readout">7 km/h</strong></div>
      </div>
      <nav class="top-actions">
        <button class="icon-button" id="save-button" type="button" aria-label="Save world" data-tooltip="Save world"><span>⌁</span></button>
        <button class="icon-button" id="weather-button" type="button" aria-label="Weather controls" data-tooltip="Weather"><span>☼</span></button>
        <button class="icon-button" id="diagnostics-button" type="button" aria-label="Simulation diagnostics" data-tooltip="Diagnostics"><span>⌗</span></button>
        <button class="icon-button" id="help-button" type="button" aria-label="Controls and help" data-tooltip="Field guide"><span>?</span></button>
      </nav>
    </header>

    <section class="surface-card glass-panel hud-layer" aria-label="Snow material sample">
      <div class="panel-eyebrow"><span class="live-dot"></span> MATERIAL SAMPLE</div>
      <div class="surface-title-row"><strong id="surface-name">Settled powder</strong><span id="surface-temp">−7.0°</span></div>
      <div class="material-bar"><span id="density-bar"></span></div>
      <dl class="material-grid">
        <div><dt>Depth</dt><dd id="sample-depth">0.82 m</dd></div>
        <div><dt>Density</dt><dd id="sample-density">18%</dd></div>
        <div><dt>Wetness</dt><dd id="sample-wetness">4%</dd></div>
        <div><dt>Hardness</dt><dd id="sample-hardness">8%</dd></div>
      </dl>
      <div class="sample-hint" id="sample-hint"><span>＋</span> Aim at the snow to inspect it</div>
    </section>

    <section class="world-note glass-panel hud-layer">
      <span class="world-note-icon">⌁</span>
      <div><small>FIELD SEED</small><strong id="seed-readout">NORTHSTAR-41</strong></div>
      <span class="world-note-rule"></span>
      <div><small>CHUNK</small><strong id="chunk-readout">+00 / +00</strong></div>
    </section>

    <aside class="drawer glass-panel hud-layer" id="weather-drawer" role="dialog" aria-modal="true" aria-label="Weather controls" aria-hidden="true" inert>
      <div class="drawer-heading">
        <div><span class="panel-eyebrow">REGIONAL SYSTEM</span><h2>Weather</h2></div>
        <button class="drawer-close" data-close="weather-drawer" aria-label="Close weather">×</button>
      </div>
      <label class="control-row"><span><b>Snowfall</b><output id="snowfall-output">62%</output></span><input id="snowfall-control" type="range" min="0" max="100" value="62" /></label>
      <label class="control-row"><span><b>Wind</b><output id="wind-output">42%</output></span><input id="wind-control" type="range" min="0" max="100" value="42" /></label>
      <label class="control-row"><span><b>Air temperature</b><output id="temperature-output">−7°C</output></span><input id="temperature-control" type="range" min="-18" max="6" value="-7" /></label>
      <label class="control-row"><span><b>Time of day</b><output id="time-output">07:40</output></span><input id="time-control" type="range" min="0" max="100" value="32" /></label>
      <div class="weather-presets">
        <button data-preset="calm" type="button"><span>☁</span>Calm</button>
        <button data-preset="storm" type="button"><span>❄</span>Storm</button>
        <button data-preset="thaw" type="button"><span>♨</span>Thaw</button>
      </div>
      <p class="drawer-note">Physical deposition is fixed-step and independent from the number of visual flakes.</p>
    </aside>

    <aside class="diagnostics glass-panel hud-layer" id="diagnostics-panel" role="dialog" aria-modal="true" aria-label="Simulation diagnostics" aria-hidden="true" inert>
      <div class="diagnostic-header">
        <div><span class="panel-eyebrow"><span class="live-dot"></span> SIMULATION HEALTH</span><h2>Mass ledger</h2></div>
        <button class="drawer-close" data-close="diagnostics-panel" aria-label="Close diagnostics">×</button>
      </div>
      <div class="ledger-total"><span>Accounted snow</span><strong id="ledger-total">0.00 t</strong></div>
      <div class="ledger-line"><span>Terrain field</span><b id="ledger-field">0.00 t</b></div>
      <div class="ledger-line"><span>Carried snow</span><b id="ledger-carried">0.00 kg</b></div>
      <div class="ledger-line"><span>Snow objects</span><b id="ledger-objects">0.00 kg</b></div>
      <div class="ledger-line"><span>Weather input</span><b class="positive" id="ledger-weather">+0.00 kg</b></div>
      <div class="ledger-line"><span>Melt output</span><b class="negative" id="ledger-melt">−0.00 kg</b></div>
      <div class="ledger-divider"></div>
      <div class="ledger-line"><span>Numerical drift</span><b id="ledger-error">0.000%</b></div>
      <div class="health-track"><span id="health-track-fill"></span></div>
      <div class="diagnostic-meta">
        <span><small>REVISION</small><b id="revision-readout">0000</b></span>
        <span><small>CHECKSUM</small><b id="checksum-readout">--------</b></span>
        <span><small>TICK</small><b id="tick-readout">0</b></span>
      </div>
      <div class="backend-row"><span id="backend-indicator" class="backend-dot"></span><span id="backend-readout">GPU probing…</span><b id="fps-readout">-- FPS</b></div>
    </aside>

    <div class="pointer-prompt glass-panel hud-layer" id="pointer-prompt">
      <span class="mouse-glyph" aria-hidden="true">◉</span>
      <span class="desktop-control-copy">Click world to look around</span>
      <span class="mobile-control-copy">Drag open snow to look</span>
    </div>

    <div class="reticle hud-layer" id="reticle" aria-hidden="true"><span></span><i></i></div>
    <div class="brush-readout glass-panel hud-layer" id="brush-readout"><span id="tool-action-label">Remove & carry</span><b id="brush-radius-label">0.75 m</b></div>

    <section class="tool-dock hud-layer" aria-label="Snow tools">
      <div class="tool-dock-inner glass-panel">
        <button class="tool-button active" type="button" data-tool="dig" aria-pressed="true"><kbd>1</kbd><span class="tool-icon dig-icon">⌄</span><strong>Dig</strong><small>Scoop</small></button>
        <button class="tool-button" type="button" data-tool="compact"><kbd>2</kbd><span class="tool-icon compact-icon">▥</span><strong>Pack</strong><small>Harden</small></button>
        <button class="tool-button" type="button" data-tool="deposit"><kbd>3</kbd><span class="tool-icon deposit-icon">△</span><strong>Deposit</strong><small>Build</small></button>
        <button class="tool-button" type="button" data-tool="smooth"><kbd>4</kbd><span class="tool-icon smooth-icon">≈</span><strong>Smooth</strong><small>Finish</small></button>
        <button class="tool-button" type="button" data-tool="roll"><kbd>5</kbd><span class="tool-icon roll-icon">●</span><strong>Roll</strong><small>Snowball</small></button>
        <div class="radius-control"><label for="radius-control">BRUSH <output id="radius-output">0.75</output></label><input id="radius-control" type="range" min="35" max="180" value="75" /></div>
      </div>
      <div class="dock-help"><span><kbd>WASD</kbd> Move</span><span><kbd>⇧</kbd> Run</span><span><kbd>E</kbd> Grab / place</span><span><span class="tiny-mouse">◉</span> Use / throw</span><span><kbd>ESC</kbd> Free cursor</span></div>
    </section>

    <div class="carry-meter glass-panel hud-layer">
      <span class="carry-icon">◒</span>
      <div><small>LOOSE SNOW</small><strong id="carry-readout">0.00 kg</strong></div>
      <span class="carry-track"><i id="carry-track-fill"></i></span>
    </div>

    <section class="mobile-controls hud-layer" aria-label="Touch controls">
      <div class="move-control" id="move-control">
        <div class="joystick-base" id="joystick-base" role="group" aria-label="Move; push to the edge to run">
          <span class="joystick-arrows" aria-hidden="true">‹&nbsp;&nbsp;›</span>
          <span class="joystick-knob" id="joystick-knob"></span>
        </div>
        <span class="mobile-control-caption">MOVE <i>EDGE TO RUN</i></span>
      </div>
      <div class="mobile-actions">
        <button class="mobile-action-button grab-action" id="mobile-grab-button" type="button" aria-label="Grab or place snowball">
          <span aria-hidden="true">◇</span><strong id="mobile-grab-label">Grab</strong>
        </button>
        <button class="mobile-action-button primary-action" id="mobile-use-button" type="button" aria-label="Use selected snow tool">
          <span aria-hidden="true">⌖</span><strong id="mobile-use-label">Use</strong><small id="mobile-use-detail">Dig</small>
        </button>
      </div>
    </section>

    <div class="toast-stack hud-layer" id="toast-stack" aria-live="polite"></div>

    <section class="modal-layer intro-layer" id="intro-layer" aria-label="Start snow laboratory">
      <div class="intro-card">
        <div class="intro-copy">
          <div class="intro-kicker"><span>FIELD STUDY / 01</span><i></i><span>SIMULATION READY</span></div>
          <div class="intro-brand"><div class="brand-mark large"><span></span><span></span><span></span></div>SILTLANDS</div>
          <h1>Snow should<br/><em>remember.</em></h1>
          <p>A quiet, procedural wilderness where every track, scoop and snowball changes the same persistent material.</p>
          <ul class="promise-list">
            <li><span>01</span> Snow mass is measured, moved and conserved</li>
            <li><span>02</span> Every seed regenerates the same untouched world</li>
            <li><span>03</span> Your modifications persist in local storage</li>
          </ul>
        </div>
        <div class="expedition-card">
          <div class="expedition-top"><span class="panel-eyebrow">NEW EXPEDITION</span><span class="capability-chip" id="capability-chip"><i></i> Checking GPU</span></div>
          <label class="seed-field"><span>WORLD SEED</span><div><input id="seed-input" value="NORTHSTAR-41" spellcheck="false" maxlength="32"/><button id="random-seed" type="button" aria-label="Randomize seed">↻</button></div></label>
          <div class="world-preview" aria-hidden="true">
            <div class="preview-sun"></div><div class="preview-mountain back"></div><div class="preview-mountain front"></div><div class="preview-trees"></div>
            <span class="preview-coordinate">64 × 64 M TEST RANGE</span>
          </div>
          <button class="primary-button" id="enter-button" type="button"><span>Enter the field</span><b>→</b></button>
          <button class="continue-button" id="continue-button" type="button" hidden><span>Continue saved survey</span><small id="save-time-label">LOCAL SAVE</small></button>
          <div class="expedition-footer"><span>FIXED 30 HZ</span><span>LOCAL SAVE</span><span>DETERMINISTIC</span></div>
        </div>
      </div>
      <div class="intro-footer"><span>PROTOTYPE BUILD 0.1.0</span><span>A SYSTEMIC SNOW STUDY</span></div>
    </section>

    <section class="modal-layer loading-layer hidden" id="loading-layer" aria-label="Generating world">
      <div class="loading-content">
        <div class="loading-symbol"><span></span><span></span><span></span></div>
        <span class="panel-eyebrow">PREPARING EXPEDITION</span>
        <h2 id="loading-title">Reading the terrain</h2>
        <div class="loading-track"><i id="loading-progress"></i></div>
        <p id="loading-detail">Deriving continental structure from the world seed…</p>
      </div>
    </section>

    <section class="modal-layer guide-layer hidden" id="guide-layer" role="dialog" aria-modal="true" aria-label="Field guide" aria-hidden="true">
      <div class="guide-card glass-panel">
        <button class="modal-close" id="guide-close" aria-label="Close field guide">×</button>
        <span class="panel-eyebrow">FIELD GUIDE / SNOW LAB 01</span>
        <h2>Leave evidence.</h2>
        <p>Walk through deep powder to make persistent tracks. Aim at the surface and choose a material operation.</p>
        <div class="touch-guide" aria-label="Touch controls">
          <article><span>01</span><b>Move</b><small>Push the left stick. Reach its edge to run.</small></article>
          <article><span>02</span><b>Look</b><small>Drag any open part of the snow scene.</small></article>
          <article><span>03</span><b>Use</b><small>Hold the large action button to shape snow.</small></article>
          <article><span>04</span><b>Grab</b><small>Pick up, place, then use again to throw.</small></article>
        </div>
        <div class="guide-grid">
          <article><kbd>1</kbd><h3>Dig</h3><p>Removes snow into your loose-snow reserve. Nothing is silently deleted.</p></article>
          <article><kbd>2</kbd><h3>Pack</h3><p>Raises density and hardness. The surface lowers as the same mass compacts.</p></article>
          <article><kbd>3</kbd><h3>Deposit</h3><p>Returns carried mass to the surface to build banks, ramps and forms.</p></article>
          <article><kbd>4</kbd><h3>Smooth</h3><p>Conservatively redistributes nearby snow into a softer surface.</p></article>
          <article><kbd>5</kbd><h3>Roll</h3><p>Collects real ground snow into a growing ball. Grab it to carry or stack it.</p></article>
          <article><kbd>⌁</kbd><h3>Throw</h3><p>Grab a snowball, then use your primary action. Impact energy decides how much breaks back into the field.</p></article>
        </div>
        <div class="guide-callout"><span>TIP</span> Stack three placed snowballs and the construction recognizer will finish your snowman.</div>
      </div>
    </section>
  </main>
`;

const byId = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing interface element: ${id}`);
  return element as T;
};

const canvas = byId<HTMLCanvasElement>("world-canvas");
const introLayer = byId<HTMLElement>("intro-layer");
const loadingLayer = byId<HTMLElement>("loading-layer");
const guideLayer = byId<HTMLElement>("guide-layer");
const seedInput = byId<HTMLInputElement>("seed-input");
const enterButton = byId<HTMLButtonElement>("enter-button");
const continueButton = byId<HTMLButtonElement>("continue-button");
const audio = new SnowAudio();

let currentTool: SnowTool = "dig";
let brushRadius = 0.75;
let commandSequence = 1;
let simulation: SnowSimulation | null = null;
let view: SnowWorldView | null = null;
let worldSeedText = seedInput.value;
let playTimeSeconds = 0;
let timeOfDay = 0.32;
let selectedQuality = 1;
let currentSave: WorldSave | null = null;
let gameLoopHandle = 0;
let holdingSnowball = false;
let resetTouchControls = (): void => view?.setMoveInput(0, 0, false);
let weather: WeatherState = { snowfallRate: 0.62, airTemperature: -7, windX: 0.42, windZ: 0.12, gustiness: 0.35 };

const toolCopy: Record<SnowTool, { action: string; toast: string }> = {
  dig: { action: "Remove & carry", toast: "Scoop mode — removed mass enters your reserve" },
  compact: { action: "Compress in place", toast: "Pack mode — density rises, mass stays" },
  deposit: { action: "Return loose snow", toast: "Deposit mode — build with carried snow" },
  smooth: { action: "Redistribute softly", toast: "Smooth mode — conservative local transfer" },
  roll: { action: "Gather into object", toast: "Roll mode — snow leaves the field and joins the ball" },
};

function formatTemperature(value: number, precision = 0): string {
  return `${value < 0 ? "−" : ""}${Math.abs(value).toFixed(precision)}°${precision ? "C" : ""}`;
}

function formatMass(value: number, preferTons = false): string {
  const kilograms = value * 1000;
  if (preferTons || kilograms >= 1000) return `${value.toFixed(2)} t`;
  return `${kilograms.toFixed(kilograms < 10 ? 2 : 1)} kg`;
}

function toast(message: string, tone: "default" | "success" | "warning" = "default"): void {
  const stack = byId("toast-stack");
  const item = document.createElement("div");
  item.className = `toast ${tone}`;
  item.innerHTML = `<i></i><span>${message}</span>`;
  stack.append(item);
  requestAnimationFrame(() => item.classList.add("show"));
  window.setTimeout(() => {
    item.classList.remove("show");
    window.setTimeout(() => item.remove(), 300);
  }, 2600);
}

function interfaceIsOpen(): boolean {
  return !guideLayer.classList.contains("hidden") || Boolean(document.querySelector(".drawer.open, .diagnostics.open"));
}

function updateInputGate(): void {
  const blocked = interfaceIsOpen();
  document.body.classList.toggle("ui-open", blocked);
  view?.setInputEnabled(!blocked);
  if (blocked) resetTouchControls();
}

function openPanel(id: string): void {
  document.exitPointerLock?.();
  document.querySelectorAll<HTMLElement>(".drawer.open, .diagnostics.open").forEach((open) => {
    open.classList.remove("open");
    open.setAttribute("aria-hidden", "true");
    open.setAttribute("inert", "");
  });
  guideLayer.classList.add("hidden");
  guideLayer.setAttribute("aria-hidden", "true");
  const panel = byId(id);
  panel.classList.add("open");
  panel.setAttribute("aria-hidden", "false");
  panel.removeAttribute("inert");
  updateInputGate();
  panel.querySelector<HTMLButtonElement>(".drawer-close")?.focus({ preventScroll: true });
}

function closePanel(id: string): void {
  const panel = byId(id);
  panel.classList.remove("open");
  panel.setAttribute("aria-hidden", "true");
  panel.setAttribute("inert", "");
  updateInputGate();
}

function openGuide(): void {
  document.exitPointerLock?.();
  document.querySelectorAll<HTMLElement>(".drawer.open, .diagnostics.open").forEach((panel) => closePanel(panel.id));
  guideLayer.classList.remove("hidden");
  guideLayer.setAttribute("aria-hidden", "false");
  updateInputGate();
  byId<HTMLButtonElement>("guide-close").focus({ preventScroll: true });
}

function closeGuide(): void {
  guideLayer.classList.add("hidden");
  guideLayer.setAttribute("aria-hidden", "true");
  updateInputGate();
}

function updateMobileGrabState(holding: boolean): void {
  holdingSnowball = holding;
  byId("mobile-grab-label").textContent = holding ? "Place" : "Grab";
  byId("mobile-use-label").textContent = holding ? "Throw" : "Use";
  byId("mobile-use-detail").textContent = holding ? "Snowball" : currentTool[0].toUpperCase() + currentTool.slice(1);
  byId("mobile-grab-button").setAttribute("aria-label", holding ? "Place held snowball" : "Grab nearby snowball");
  byId("mobile-use-button").setAttribute("aria-label", holding ? "Throw held snowball" : `Use ${currentTool} tool`);
}

function setTool(tool: SnowTool, announce = true): void {
  currentTool = tool;
  document.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach((button) => {
    const selected = button.dataset.tool === tool;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  byId("tool-action-label").textContent = toolCopy[tool].action;
  byId("reticle").dataset.tool = tool;
  if (!holdingSnowball) {
    byId("mobile-use-detail").textContent = tool[0].toUpperCase() + tool.slice(1);
    byId("mobile-use-button").setAttribute("aria-label", `Use ${tool} tool`);
  }
  if (announce) toast(toolCopy[tool].toast);
}

function updateWeatherInterface(): void {
  const snowPercent = Math.round(weather.snowfallRate * 100);
  const windStrength = Math.hypot(weather.windX, weather.windZ);
  const windPercent = Math.round(windStrength * 100);
  byId("snowfall-output").textContent = `${snowPercent}%`;
  byId("wind-output").textContent = `${windPercent}%`;
  byId("temperature-output").textContent = `${formatTemperature(weather.airTemperature)}C`;
  byId("air-readout").textContent = formatTemperature(weather.airTemperature, 1);
  byId("wind-readout").textContent = `${Math.round(windStrength * 17)} km/h`;
  byId("condition-label").textContent = weather.airTemperature > 0 ? "Active thaw" : snowPercent > 78 ? "Driving snowfall" : snowPercent < 15 ? "High overcast" : "Powder snowfall";
  view?.setWeather(weather);
  audio.setWind(windStrength);
}

function updateTimeInterface(): void {
  const totalMinutes = Math.round(timeOfDay * 24 * 60) % (24 * 60);
  const hours = Math.floor(totalMinutes / 60).toString().padStart(2, "0");
  const minutes = (totalMinutes % 60).toString().padStart(2, "0");
  byId("time-output").textContent = `${hours}:${minutes}`;
  view?.setTimeOfDay(timeOfDay);
}

function updateSample(x: number, z: number, valid: boolean): void {
  if (!simulation || !valid) {
    byId("sample-hint").classList.remove("active");
    byId("reticle").classList.remove("valid");
    return;
  }
  byId("sample-hint").classList.add("active");
  byId("reticle").classList.add("valid");
  const sample = simulation.sampleSurface(x, z);
  const densityPercent = Math.round(sample.density * 100);
  const wetnessPercent = Math.round(sample.wetness * 100);
  const hardnessPercent = Math.round(sample.hardness * 100);
  byId("surface-name").textContent = sample.wetness > 0.5 ? "Wet granular snow" : sample.hardness > 0.55 ? "Frozen crust" : sample.density > 0.3 ? "Packed snow" : "Settled powder";
  byId("surface-temp").textContent = formatTemperature(sample.temperature, 1);
  byId("sample-depth").textContent = `${sample.depth.toFixed(2)} m`;
  byId("sample-density").textContent = `${densityPercent}%`;
  byId("sample-wetness").textContent = `${wetnessPercent}%`;
  byId("sample-hardness").textContent = `${hardnessPercent}%`;
  byId<HTMLElement>("density-bar").style.width = `${Math.max(4, densityPercent)}%`;
  byId("sample-hint").innerHTML = `<span>⌖</span> ${x.toFixed(1)} / ${z.toFixed(1)} metres`;
}

function useTool(x: number, z: number): void {
  if (!simulation || !view) return;
  const sample = simulation.sampleSurface(x, z);
  const result = simulation.applyCommand({
    worldId: worldSeedText,
    actorId: "local-explorer",
    sequence: commandSequence,
    tick: simulation.tick,
    tool: currentTool,
    x,
    z,
    radius: brushRadius,
    strength: currentTool === "smooth" ? 0.62 : 0.82,
  });
  commandSequence += 1;
  if (!result.accepted) return;
  if (currentTool === "roll") {
    if (result.massMoved <= 0.00001) {
      toast("Not enough loose snow here", "warning");
      return;
    }
    simulation.addObjectMass(result.massMoved);
    view.growSnowball(x, z, result.massMoved, Math.max(0.2, sample.density + 0.08), sample.wetness);
  } else {
    view.burstPowder(x, z, currentTool === "compact" ? 0.012 : Math.max(0.018, result.massMoved));
    audio.play(currentTool === "smooth" ? "compact" : currentTool, sample.wetness, sample.hardness, 0.72);
  }
  if (currentTool === "deposit" && result.massMoved <= 0.00001) toast("Dig first to collect loose snow", "warning");
}

function updateHud(): void {
  if (!simulation || !view) return;
  const metrics = simulation.metrics();
  byId("ledger-total").textContent = formatMass(metrics.fieldMass + metrics.carriedMass + metrics.objectMass, true);
  byId("ledger-field").textContent = formatMass(metrics.fieldMass, true);
  byId("ledger-carried").textContent = formatMass(metrics.carriedMass);
  byId("ledger-objects").textContent = formatMass(metrics.objectMass);
  byId("ledger-weather").textContent = `+${formatMass(metrics.depositedByWeather)}`;
  byId("ledger-melt").textContent = `−${formatMass(metrics.meltedMass)}`;
  byId("ledger-error").textContent = `${Math.abs(metrics.errorPercent).toFixed(4)}%`;
  byId("ledger-error").className = Math.abs(metrics.errorPercent) > 0.05 ? "negative" : "positive";
  byId<HTMLElement>("health-track-fill").style.width = `${Math.max(4, 100 - Math.abs(metrics.errorPercent) * 80)}%`;
  byId("revision-readout").textContent = metrics.revision.toString().padStart(4, "0");
  byId("checksum-readout").textContent = metrics.checksum.toUpperCase();
  byId("tick-readout").textContent = simulation.tick.toLocaleString();
  byId("carry-readout").textContent = formatMass(metrics.carriedMass);
  byId<HTMLElement>("carry-track-fill").style.width = `${Math.min(100, metrics.carriedMass * 850)}%`;
  const player = view.getPlayerState();
  byId("chunk-readout").textContent = `${player.x >= 0 ? "+" : "−"}${Math.abs(Math.floor(player.x / 64)).toString().padStart(2, "0")} / ${player.z >= 0 ? "+" : "−"}${Math.abs(Math.floor(player.z / 64)).toString().padStart(2, "0")}`;
  byId("fps-readout").textContent = `${Math.round(view.engine.getFps())} FPS`;
}

async function startWorld(save: WorldSave | null): Promise<void> {
  enterButton.disabled = true;
  continueButton.disabled = true;
  currentSave = save;
  worldSeedText = (save?.seedText ?? (seedInput.value.trim() || "NORTHSTAR-41")).toUpperCase();
  seedInput.value = worldSeedText;
  introLayer.classList.add("leaving");
  loadingLayer.classList.remove("hidden");
  const progress = byId<HTMLElement>("loading-progress");
  const loadingTitle = byId("loading-title");
  const loadingDetail = byId("loading-detail");
  const stages = [
    ["Reading the terrain", "Deriving ridge, basin and exposure fields from the world seed…"],
    ["Laying down snow", "Packing depth, density, wetness and hardness into the active field…"],
    ["Planting the tree line", "Applying deterministic spatial sampling and slope limits…"],
    ["Starting fixed time", "Opening the command ledger and weather deposition loop…"],
  ];
  for (let index = 0; index < stages.length; index += 1) {
    loadingTitle.textContent = stages[index][0];
    loadingDetail.textContent = stages[index][1];
    progress.style.width = `${(index + 0.35) / stages.length * 100}%`;
    await new Promise((resolve) => window.setTimeout(resolve, 190));
    if (index === 0) {
      const generated = generateWorld(worldSeedText);
      simulation = new SnowSimulation(generated);
      if (save && !simulation.restore(save.snapshot)) {
        toast("Saved snow data did not match this generator", "warning");
      }
      view = await SnowWorldView.create(canvas, generated, simulation, {
        onInteract: useTool,
        onFootstep: (x, z, side, speed) => {
          if (!simulation || !view) return;
          simulation.applyFootprint(x, z, 0.17, Math.min(1, speed / 5.2));
          const sample = simulation.sampleSurface(x, z);
          audio.play("step", sample.wetness, sample.hardness, Math.min(1, speed / 4));
          view.burstPowder(x + side * 0.02, z, 0.008 + speed * 0.0014);
        },
        onBallImpact: (x, z, requestedMass, energy) => {
          if (!simulation) return 0;
          const radius = Math.max(0.35, Math.min(1.5, Math.cbrt(requestedMass + 0.02) * 1.5));
          const released = simulation.releaseObjectMass(x, z, requestedMass, radius);
          const sample = simulation.sampleSurface(x, z);
          audio.play("impact", sample.wetness, sample.hardness, Math.min(1, energy / 8));
          return released;
        },
        onBallGathered: () => {
          const aim = view?.getAimPoint();
          const sample = aim && simulation ? simulation.sampleSurface(aim.x, aim.z) : null;
          audio.play("compact", sample?.wetness ?? 0.05, sample?.hardness ?? 0.1, 0.45);
        },
        onPointerLockChange: (locked) => byId("pointer-prompt").classList.toggle("hidden", locked),
        onTouchLookStart: () => byId("pointer-prompt").classList.add("hidden"),
        onGrabStateChange: updateMobileGrabState,
        onAimChange: updateSample,
      });
      view.setInputEnabled(false);
      if (save) {
        view.setPlayerState(save.player);
        view.restoreSnowballs(save.snowballs);
        weather = save.weather;
        playTimeSeconds = save.playTimeSeconds;
        byId<HTMLInputElement>("snowfall-control").value = String(Math.round(weather.snowfallRate * 100));
        byId<HTMLInputElement>("wind-control").value = String(Math.round(Math.hypot(weather.windX, weather.windZ) * 100));
        byId<HTMLInputElement>("temperature-control").value = String(weather.airTemperature);
      }
      view.setWeather(weather);
      view.setParticleQuality(selectedQuality);
    }
  }
  progress.style.width = "100%";
  byId("seed-readout").textContent = worldSeedText;
  byId("backend-readout").textContent = `${view?.backend ?? "GPU"} · fixed 30 Hz`;
  byId("backend-indicator").classList.add("ready");
  updateWeatherInterface();
  updateTimeInterface();
  await new Promise((resolve) => window.setTimeout(resolve, 260));
  introLayer.classList.add("hidden");
  loadingLayer.classList.add("hidden");
  loadingLayer.classList.remove("leaving");
  document.body.classList.add("in-world");
  view?.start();
  view?.setInputEnabled(true);
  startSimulationLoop();
  updateHud();
  toast(save ? "Saved survey restored" : `Field ${worldSeedText} generated`, "success");
}

function startSimulationLoop(): void {
  let previous = performance.now();
  let accumulator = 0;
  let hudAccumulator = 0;
  const fixedDt = 1 / 30;
  const frame = (now: number) => {
    const elapsed = Math.min(0.15, (now - previous) / 1000);
    previous = now;
    accumulator += elapsed;
    hudAccumulator += elapsed;
    playTimeSeconds += elapsed;
    while (accumulator >= fixedDt) {
      simulation?.step(fixedDt, weather);
      accumulator -= fixedDt;
    }
    if (hudAccumulator > 0.32) {
      updateHud();
      hudAccumulator = 0;
    }
    gameLoopHandle = requestAnimationFrame(frame);
  };
  cancelAnimationFrame(gameLoopHandle);
  gameLoopHandle = requestAnimationFrame(frame);
}

async function persistWorld(): Promise<void> {
  if (!simulation || !view) return;
  const button = byId<HTMLButtonElement>("save-button");
  button.classList.add("working");
  try {
    await saveWorld({
      id: "autosave",
      name: `Field ${worldSeedText}`,
      seedText: worldSeedText,
      savedAt: Date.now(),
      playTimeSeconds,
      player: view.getPlayerState(),
      weather,
      snowballs: view.serializeSnowballs(),
      snapshot: simulation.snapshot(),
    });
    toast("World delta saved locally", "success");
  } catch (error) {
    console.error(error);
    toast("Could not save this world", "warning");
  } finally {
    button.classList.remove("working");
  }
}

function bindTouchControls(): void {
  const joystick = byId<HTMLElement>("joystick-base");
  const knob = byId<HTMLElement>("joystick-knob");
  const primaryButton = byId<HTMLButtonElement>("mobile-use-button");
  const grabButton = byId<HTMLButtonElement>("mobile-grab-button");
  let stickPointerId: number | null = null;
  let primaryPointerId: number | null = null;

  const updateStick = (event: PointerEvent): void => {
    const rect = joystick.getBoundingClientRect();
    const radius = Math.max(32, rect.width * 0.36);
    const state = normalizeTouchStick(event.clientX - (rect.left + rect.width * 0.5), event.clientY - (rect.top + rect.height * 0.5), radius);
    knob.style.transform = `translate(${state.visualX}px, ${state.visualY}px)`;
    joystick.classList.toggle("running", state.sprint);
    view?.setMoveInput(state.forward, state.right, state.sprint);
  };

  const resetStick = (): void => {
    const pointerId = stickPointerId;
    stickPointerId = null;
    if (pointerId !== null && joystick.hasPointerCapture(pointerId)) joystick.releasePointerCapture(pointerId);
    knob.style.transform = "translate(0, 0)";
    joystick.classList.remove("running");
    view?.setMoveInput(0, 0, false);
  };

  const releasePrimary = (): void => {
    const pointerId = primaryPointerId;
    primaryPointerId = null;
    if (pointerId !== null && primaryButton.hasPointerCapture(pointerId)) primaryButton.releasePointerCapture(pointerId);
    primaryButton.classList.remove("pressed");
    view?.setPrimaryAction(false);
  };

  resetTouchControls = () => {
    resetStick();
    releasePrimary();
  };

  joystick.addEventListener("pointerdown", (event) => {
    if (stickPointerId !== null || !view) return;
    event.preventDefault();
    audio.ensureStarted();
    stickPointerId = event.pointerId;
    joystick.setPointerCapture(event.pointerId);
    updateStick(event);
  });
  joystick.addEventListener("pointermove", (event) => {
    if (event.pointerId !== stickPointerId) return;
    event.preventDefault();
    updateStick(event);
  });
  for (const eventName of ["pointerup", "pointercancel", "lostpointercapture"] as const) {
    joystick.addEventListener(eventName, (event) => {
      if (event.pointerId === stickPointerId) resetStick();
    });
  }

  primaryButton.addEventListener("pointerdown", (event) => {
    if (primaryPointerId !== null || !view) return;
    event.preventDefault();
    audio.ensureStarted();
    primaryPointerId = event.pointerId;
    primaryButton.setPointerCapture(event.pointerId);
    primaryButton.classList.add("pressed");
    const result = view.setPrimaryAction(true);
    if (result === "thrown") audio.play("throw", 0.05, 0.2, 0.7);
  });
  for (const eventName of ["pointerup", "pointercancel", "lostpointercapture"] as const) {
    primaryButton.addEventListener(eventName, (event) => {
      if (event.pointerId === primaryPointerId) releasePrimary();
    });
  }

  grabButton.addEventListener("click", () => {
    audio.ensureStarted();
    const result = view?.toggleGrab() ?? "none";
    if (result === "grabbed") toast("Snowball in hand — place it or throw it", "success");
    if (result === "placed") toast("Snowball placed", "success");
    if (result === "none") toast("Move closer to a snowball", "warning");
  });
}

function bindInterface(): void {
  bindTouchControls();
  enterButton.addEventListener("click", () => {
    audio.ensureStarted();
    void startWorld(null);
  });
  continueButton.addEventListener("click", () => {
    audio.ensureStarted();
    void startWorld(currentSave);
  });
  byId("random-seed").addEventListener("click", () => {
    const north = ["AURORA", "RIME", "EMBER", "TUNDRA", "POLAR", "MICA", "SILVER"];
    const land = ["BASIN", "RIDGE", "HOLLOW", "FIELD", "PASS", "DRIFT", "VALE"];
    seedInput.value = `${north[Math.floor(Math.random() * north.length)]}-${land[Math.floor(Math.random() * land.length)]}-${Math.floor(10 + Math.random() * 89)}`;
  });
  document.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach((button) => button.addEventListener("click", () => setTool(button.dataset.tool as SnowTool)));
  const radiusControl = byId<HTMLInputElement>("radius-control");
  radiusControl.addEventListener("input", () => {
    brushRadius = Number(radiusControl.value) / 100;
    byId("radius-output").textContent = brushRadius.toFixed(2);
    byId("brush-radius-label").textContent = `${brushRadius.toFixed(2)} m`;
  });

  byId("save-button").addEventListener("click", () => void persistWorld());
  byId("weather-button").addEventListener("click", () => openPanel("weather-drawer"));
  byId("diagnostics-button").addEventListener("click", () => openPanel("diagnostics-panel"));
  byId("help-button").addEventListener("click", openGuide);
  byId("guide-close").addEventListener("click", closeGuide);
  document.querySelectorAll<HTMLButtonElement>("[data-close]").forEach((button) => button.addEventListener("click", () => closePanel(button.dataset.close ?? "")));

  const snowfallControl = byId<HTMLInputElement>("snowfall-control");
  snowfallControl.addEventListener("input", () => {
    weather = { ...weather, snowfallRate: Number(snowfallControl.value) / 100 };
    updateWeatherInterface();
  });
  const windControl = byId<HTMLInputElement>("wind-control");
  windControl.addEventListener("input", () => {
    const strength = Number(windControl.value) / 100;
    weather = { ...weather, windX: strength * 0.94, windZ: strength * 0.28, gustiness: 0.2 + strength * 0.45 };
    updateWeatherInterface();
  });
  const temperatureControl = byId<HTMLInputElement>("temperature-control");
  temperatureControl.addEventListener("input", () => {
    weather = { ...weather, airTemperature: Number(temperatureControl.value) };
    updateWeatherInterface();
  });
  const timeControl = byId<HTMLInputElement>("time-control");
  timeControl.addEventListener("input", () => {
    timeOfDay = Number(timeControl.value) / 100;
    updateTimeInterface();
  });
  document.querySelectorAll<HTMLButtonElement>("[data-preset]").forEach((button) => button.addEventListener("click", () => {
    const preset = button.dataset.preset;
    if (preset === "calm") weather = { snowfallRate: 0.12, airTemperature: -9, windX: 0.08, windZ: 0.02, gustiness: 0.1 };
    if (preset === "storm") weather = { snowfallRate: 1, airTemperature: -12, windX: 0.92, windZ: 0.27, gustiness: 0.82 };
    if (preset === "thaw") weather = { snowfallRate: 0, airTemperature: 4, windX: 0.18, windZ: 0.05, gustiness: 0.12 };
    snowfallControl.value = String(Math.round(weather.snowfallRate * 100));
    windControl.value = String(Math.round(Math.hypot(weather.windX, weather.windZ) * 100));
    temperatureControl.value = String(weather.airTemperature);
    updateWeatherInterface();
    toast(preset === "thaw" ? "Thaw cycle started — snow mass will melt" : `${preset?.[0].toUpperCase()}${preset?.slice(1)} weather applied`);
  }));

  window.addEventListener("keydown", (event) => {
    const target = event.target as HTMLElement;
    if (event.code === "Escape" && interfaceIsOpen()) {
      document.querySelectorAll<HTMLElement>(".drawer.open, .diagnostics.open").forEach((panel) => closePanel(panel.id));
      if (!guideLayer.classList.contains("hidden")) closeGuide();
      return;
    }
    if (target.matches("input, textarea")) return;
    const shortcuts: Record<string, SnowTool> = { Digit1: "dig", Digit2: "compact", Digit3: "deposit", Digit4: "smooth", Digit5: "roll" };
    if (shortcuts[event.code]) setTool(shortcuts[event.code], false);
    if (event.code === "KeyH") openGuide();
  });
  window.addEventListener("resize", () => view?.resize());
  window.addEventListener("orientationchange", () => view?.resize());
  window.visualViewport?.addEventListener("resize", () => view?.resize());
  window.addEventListener("blur", resetTouchControls);
  window.addEventListener("beforeunload", () => cancelAnimationFrame(gameLoopHandle));
}

async function initializeLanding(): Promise<void> {
  bindInterface();
  const capabilityChip = byId("capability-chip");
  if ("gpu" in navigator) {
    capabilityChip.innerHTML = `<i></i> WebGPU available`;
    capabilityChip.classList.add("ready");
    selectedQuality = Math.min(1.2, window.devicePixelRatio > 1.5 ? 0.9 : 1);
  } else {
    capabilityChip.innerHTML = `<i></i> WebGL fallback`;
    capabilityChip.classList.add("fallback");
    selectedQuality = 0.72;
  }
  try {
    if (await hasSavedWorld()) {
      currentSave = await loadWorld();
      if (currentSave) {
        continueButton.hidden = false;
        const ageMinutes = Math.max(0, Math.round((Date.now() - currentSave.savedAt) / 60000));
        byId("save-time-label").textContent = ageMinutes < 1 ? "JUST NOW" : `${ageMinutes} MIN AGO`;
      }
    }
  } catch (error) {
    console.warn("Local persistence is unavailable.", error);
  }
}

void initializeLanding();
