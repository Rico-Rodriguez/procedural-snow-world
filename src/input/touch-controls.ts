export interface TouchStickState {
  forward: number;
  right: number;
  sprint: boolean;
  visualX: number;
  visualY: number;
}

export function isTouchInputCapable(): boolean {
  const override = new URLSearchParams(window.location.search).get("touch");
  if (override === "1") return true;
  if (override === "0") return false;
  return navigator.maxTouchPoints > 0 || window.matchMedia("(any-pointer: coarse)").matches;
}

export function normalizeTouchStick(
  deltaX: number,
  deltaY: number,
  radius: number,
  deadZone = 0.12,
): TouchStickState {
  const safeRadius = Math.max(1, radius);
  const distance = Math.hypot(deltaX, deltaY);
  const visualScale = distance > safeRadius ? safeRadius / distance : 1;
  const visualX = deltaX * visualScale;
  const visualY = deltaY * visualScale;
  const rawMagnitude = Math.min(1, distance / safeRadius);

  if (distance === 0 || rawMagnitude <= deadZone) {
    return { forward: 0, right: 0, sprint: false, visualX, visualY };
  }

  const magnitude = Math.min(1, (rawMagnitude - deadZone) / Math.max(0.01, 1 - deadZone));
  return {
    forward: (-deltaY / distance) * magnitude,
    right: (deltaX / distance) * magnitude,
    sprint: rawMagnitude >= 0.84,
    visualX,
    visualY,
  };
}
