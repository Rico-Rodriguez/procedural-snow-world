import { describe, expect, it } from "vitest";
import { normalizeTouchStick } from "./touch-controls";

describe("normalizeTouchStick", () => {
  it("filters movement inside the dead zone", () => {
    expect(normalizeTouchStick(3, -2, 50)).toMatchObject({ forward: 0, right: 0, sprint: false });
  });

  it("maps upward and rightward movement to game axes", () => {
    const input = normalizeTouchStick(30, -40, 50);
    expect(input.forward).toBeCloseTo(0.8, 1);
    expect(input.right).toBeCloseTo(0.6, 1);
    expect(input.sprint).toBe(true);
  });

  it("clamps the visual knob and analog magnitude to the stick radius", () => {
    const input = normalizeTouchStick(200, 0, 50);
    expect(input.visualX).toBe(50);
    expect(input.visualY).toBe(0);
    expect(input.right).toBe(1);
  });
});
