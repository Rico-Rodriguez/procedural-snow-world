import { describe, expect, it } from "vitest";

import { generateWorld } from "../world/generator";
import { SnowSimulation, type SnowCommand, type SnowTool } from "./snow-simulation";

function pseudoRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

function expectFiniteValuesInRange(field: Float32Array, minimum: number, maximum: number): void {
  for (const value of field) {
    expect(Number.isFinite(value)).toBe(true);
    expect(value).toBeGreaterThanOrEqual(minimum);
    expect(value).toBeLessThanOrEqual(maximum);
  }
}

function command(sequence: number, tool: SnowTool, overrides: Partial<SnowCommand> = {}): SnowCommand {
  return {
    worldId: "test-world",
    actorId: "test-actor",
    sequence,
    tick: sequence,
    tool,
    x: 0,
    z: 0,
    radius: 1.5,
    strength: 0.65,
    ...overrides,
  };
}

describe("SnowSimulation invariants", () => {
  it("applies a command identity at most once", () => {
    const simulation = new SnowSimulation(generateWorld("idempotency", 32, 33));
    const dig = command(42, "dig", { x: 2.25, z: -1.5 });
    const first = simulation.applyCommand(dig);
    const stateAfterFirst = simulation.snapshot();
    const metricsAfterFirst = simulation.metrics();
    const eventCountAfterFirst = simulation.events.length;

    const duplicate = simulation.applyCommand(dig);

    expect(first.accepted).toBe(true);
    expect(first.massMoved).toBeGreaterThan(0);
    expect(duplicate).toEqual({ accepted: false, reason: "duplicate", massMoved: 0 });
    expect(simulation.snapshot()).toEqual(stateAfterFirst);
    expect(simulation.metrics()).toEqual(metricsAfterFirst);
    expect(simulation.events).toHaveLength(eventCountAfterFirst);
  });

  it("keeps all snow fields finite, non-negative, and bounded after randomized interactions", () => {
    const simulation = new SnowSimulation(generateWorld("randomized-invariants", 32, 33));
    const random = pseudoRandom(0x5eeda11);
    const tools: readonly SnowTool[] = ["dig", "compact", "deposit", "smooth", "roll"];

    for (let sequence = 1; sequence <= 360; sequence += 1) {
      const tool = tools[Math.floor(random() * tools.length)];
      simulation.applyCommand(command(sequence, tool, {
        x: (random() - 0.5) * 30,
        z: (random() - 0.5) * 30,
        radius: 0.08 + random() * 3.42,
        strength: 0.01 + random() * 0.99,
      }));

      if (sequence % 7 === 0) {
        simulation.applyFootprint(
          (random() - 0.5) * 30,
          (random() - 0.5) * 30,
          0.15 + random() * 0.65,
          0.1 + random() * 0.9,
        );
      }

      simulation.step(1 / 30, {
        snowfallRate: random() * 0.8,
        airTemperature: -18 + random() * 24,
        windX: (random() - 0.5) * 4,
        windZ: (random() - 0.5) * 4,
        gustiness: random(),
      });
    }

    expectFiniteValuesInRange(simulation.depth, 0, 4);
    expectFiniteValuesInRange(simulation.density, 0.08, 0.72);
    expectFiniteValuesInRange(simulation.wetness, 0, 1);
    expectFiniteValuesInRange(simulation.hardness, 0, 1);
    expectFiniteValuesInRange(simulation.temperature, -40, 12);
    expectFiniteValuesInRange(simulation.disturbance, 0, 1);
    expect(simulation.carriedMass).toBeGreaterThanOrEqual(0);
    expect(simulation.objectMass).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(simulation.metrics().fieldMass)).toBe(true);
  });

  it("approximately conserves tracked mass through reshaping and weather", () => {
    const simulation = new SnowSimulation(generateWorld("mass-ledger", 32, 33));
    const random = pseudoRandom(0xc011ec7);
    const reshapingTools: readonly SnowTool[] = ["dig", "deposit", "compact", "smooth"];

    for (let sequence = 1; sequence <= 240; sequence += 1) {
      const tool = reshapingTools[Math.floor(random() * reshapingTools.length)];
      simulation.applyCommand(command(sequence, tool, {
        x: (random() - 0.5) * 28,
        z: (random() - 0.5) * 28,
        radius: 0.2 + random() * 2.4,
        strength: 0.05 + random() * 0.9,
      }));

      simulation.step(1 / 30, {
        snowfallRate: random() * 0.5,
        airTemperature: -5 + random() * 10,
        windX: (random() - 0.5) * 2,
        windZ: (random() - 0.5) * 2,
        gustiness: random(),
      });
    }

    const metrics = simulation.metrics();
    const actualMass = metrics.fieldMass + metrics.carriedMass + metrics.objectMass;

    expect(metrics.expectedMass).toBeCloseTo(
      metrics.initialMass + metrics.depositedByWeather - metrics.meltedMass,
      10,
    );
    expect(actualMass).toBeCloseTo(metrics.expectedMass, 3);
    expect(Math.abs(metrics.errorPercent)).toBeLessThan(0.01);
  });
});
