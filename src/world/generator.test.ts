import { describe, expect, it } from "vitest";

import {
  deterministicPoints,
  generateWorld,
  hash2D,
  seedFromText,
  terrainHeight,
} from "./generator";

describe("procedural world generation", () => {
  it("reproduces every generated field for the same seed and parameters", () => {
    const first = generateWorld("quiet-alpine-basin", 48, 65);
    const second = generateWorld("quiet-alpine-basin", 48, 65);

    expect(second.seed).toBe(first.seed);
    expect(second.size).toBe(first.size);
    expect(second.resolution).toBe(first.resolution);
    expect(second.spacing).toBe(first.spacing);
    expect(second.terrain).toEqual(first.terrain);
    expect(second.snowDepth).toEqual(first.snowDepth);
    expect(second.exposure).toEqual(first.exposure);
  });

  it("keeps seeded primitives and feature placement deterministic", () => {
    const seed = seedFromText("feature-stream-test");
    const firstPoints = deterministicPoints(seed, 32, 28, 0x7a11);

    expect(seedFromText("feature-stream-test")).toBe(seed);
    expect(hash2D(seed, -17, 23, 0x44)).toBe(hash2D(seed, -17, 23, 0x44));
    expect(terrainHeight(seed, 12.5, -8.25)).toBe(terrainHeight(seed, 12.5, -8.25));
    expect(deterministicPoints(seed, 32, 28, 0x7a11)).toEqual(firstPoints);
  });

  it("uses the seed to produce a distinct untouched world", () => {
    const first = generateWorld("world-a", 32, 33);
    const second = generateWorld("world-b", 32, 33);
    let terrainDifferences = 0;
    let snowDifferences = 0;

    for (let index = 0; index < first.terrain.length; index += 1) {
      if (first.terrain[index] !== second.terrain[index]) terrainDifferences += 1;
      if (first.snowDepth[index] !== second.snowDepth[index]) snowDifferences += 1;
    }

    expect(first.seed).not.toBe(second.seed);
    expect(terrainDifferences).toBeGreaterThan(first.terrain.length * 0.95);
    expect(snowDifferences).toBeGreaterThan(first.snowDepth.length * 0.95);
  });
});
