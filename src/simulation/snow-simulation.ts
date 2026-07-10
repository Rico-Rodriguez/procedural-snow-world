import type { GeneratedWorld } from "../world/generator";

export type SnowTool = "dig" | "compact" | "deposit" | "smooth" | "roll";

export interface SnowCommand {
  worldId: string;
  actorId: string;
  sequence: number;
  tick: number;
  tool: SnowTool;
  x: number;
  z: number;
  radius: number;
  strength: number;
}

export interface WeatherState {
  snowfallRate: number;
  airTemperature: number;
  windX: number;
  windZ: number;
  gustiness: number;
}

export interface SnowEvent {
  type: "dig" | "compact" | "deposit" | "smooth" | "roll" | "snowfall" | "melt";
  x: number;
  z: number;
  amount: number;
  tick: number;
}

export interface CommandResult {
  accepted: boolean;
  reason?: string;
  massMoved: number;
}

export interface SnowMetrics {
  fieldMass: number;
  carriedMass: number;
  objectMass: number;
  initialMass: number;
  depositedByWeather: number;
  meltedMass: number;
  expectedMass: number;
  errorMass: number;
  errorPercent: number;
  activeCells: number;
  revision: number;
  checksum: string;
}

export interface SnowSnapshot {
  schemaVersion: number;
  simulationVersion: number;
  seed: number;
  revision: number;
  tick: number;
  carriedMass: number;
  objectMass: number;
  depositedByWeather: number;
  meltedMass: number;
  depth: Float32Array;
  density: Float32Array;
  wetness: Float32Array;
  hardness: Float32Array;
  temperature: Float32Array;
}

const MIN_DENSITY = 0.08;
const MAX_DENSITY = 0.72;
const MAX_DEPTH = 4;
const MIN_TEMP = -40;
const MAX_TEMP = 12;
const EPSILON = 1e-8;

export class SnowSimulation {
  readonly world: GeneratedWorld;
  readonly depth: Float32Array;
  readonly density: Float32Array;
  readonly wetness: Float32Array;
  readonly hardness: Float32Array;
  readonly temperature: Float32Array;
  readonly disturbance: Float32Array;
  readonly events: SnowEvent[] = [];

  tick = 0;
  revision = 0;
  carriedMass = 0;
  objectMass = 0;
  depositedByWeather = 0;
  meltedMass = 0;
  readonly initialMass: number;

  private readonly appliedCommands = new Set<string>();
  private readonly massScratch: Float32Array;
  private dirty = true;

  constructor(world: GeneratedWorld) {
    this.world = world;
    const count = world.resolution * world.resolution;
    this.depth = new Float32Array(world.snowDepth);
    this.density = new Float32Array(count);
    this.wetness = new Float32Array(count);
    this.hardness = new Float32Array(count);
    this.temperature = new Float32Array(count);
    this.disturbance = new Float32Array(count);
    this.massScratch = new Float32Array(count);
    for (let index = 0; index < count; index += 1) {
      this.density[index] = 0.16 + world.exposure[index] * 0.035;
      this.temperature[index] = -7 + world.terrain[index] * -0.08;
      this.hardness[index] = 0.08;
      this.wetness[index] = 0.04;
    }
    this.initialMass = this.calculateFieldMass();
  }

  get resolution(): number {
    return this.world.resolution;
  }

  get spacing(): number {
    return this.world.spacing;
  }

  get cellArea(): number {
    return this.spacing * this.spacing;
  }

  consumeDirty(): boolean {
    const result = this.dirty;
    this.dirty = false;
    return result;
  }

  sampleSurface(x: number, z: number): { terrain: number; depth: number; density: number; wetness: number; hardness: number; temperature: number } {
    const gridX = this.worldToGrid(x);
    const gridZ = this.worldToGrid(z);
    return {
      terrain: this.bilinear(this.world.terrain, gridX, gridZ),
      depth: this.bilinear(this.depth, gridX, gridZ),
      density: this.bilinear(this.density, gridX, gridZ),
      wetness: this.bilinear(this.wetness, gridX, gridZ),
      hardness: this.bilinear(this.hardness, gridX, gridZ),
      temperature: this.bilinear(this.temperature, gridX, gridZ),
    };
  }

  surfaceHeight(x: number, z: number): number {
    const sample = this.sampleSurface(x, z);
    return sample.terrain + sample.depth;
  }

  applyCommand(command: SnowCommand): CommandResult {
    const key = `${command.worldId}:${command.actorId}:${command.sequence}`;
    if (this.appliedCommands.has(key)) return { accepted: false, reason: "duplicate", massMoved: 0 };
    if (!Number.isFinite(command.x + command.z + command.radius + command.strength)) {
      return { accepted: false, reason: "non-finite command", massMoved: 0 };
    }
    if (command.radius < 0.08 || command.radius > 3.5 || command.strength <= 0 || command.strength > 1) {
      return { accepted: false, reason: "brush outside limits", massMoved: 0 };
    }
    const half = this.world.size * 0.5;
    if (Math.abs(command.x) > half || Math.abs(command.z) > half) {
      return { accepted: false, reason: "outside active chunk", massMoved: 0 };
    }

    this.appliedCommands.add(key);
    let massMoved = 0;
    switch (command.tool) {
      case "dig":
        massMoved = this.dig(command.x, command.z, command.radius, command.strength);
        this.carriedMass += massMoved;
        break;
      case "deposit":
        massMoved = this.deposit(command.x, command.z, command.radius, command.strength);
        break;
      case "compact":
        massMoved = this.compact(command.x, command.z, command.radius, command.strength, false);
        break;
      case "smooth":
        massMoved = this.smooth(command.x, command.z, command.radius, command.strength);
        break;
      case "roll":
        massMoved = this.dig(command.x, command.z, command.radius, command.strength * 0.32);
        break;
    }
    if (massMoved > EPSILON || command.tool === "compact" || command.tool === "smooth") {
      this.revision += 1;
      this.dirty = true;
      this.events.push({ type: command.tool, x: command.x, z: command.z, amount: massMoved, tick: this.tick });
      if (this.events.length > 96) this.events.splice(0, this.events.length - 96);
    }
    this.clampAll();
    return { accepted: true, massMoved };
  }

  applyFootprint(x: number, z: number, radius: number, strength: number): void {
    this.compact(x, z, radius, strength, true);
    this.revision += 1;
    this.dirty = true;
  }

  addObjectMass(amount: number): void {
    this.objectMass = Math.max(0, this.objectMass + amount);
  }

  releaseObjectMass(x: number, z: number, amount: number, radius: number): number {
    const available = Math.min(this.objectMass, Math.max(0, amount));
    if (available <= 0) return 0;
    this.objectMass -= available;
    const deposited = this.depositExact(x, z, radius, available);
    const difference = available - deposited;
    this.objectMass += difference;
    this.revision += 1;
    this.dirty = true;
    return deposited;
  }

  step(dt: number, weather: WeatherState): void {
    this.tick += 1;
    if (this.tick % 5 === 0) this.applyWeather(dt * 5, weather);
    if (this.tick % 12 === 0) this.applyWind(weather);
    if (this.tick % 30 === 0) this.ageSurface(weather, dt * 30);
  }

  calculateFieldMass(): number {
    let mass = 0;
    for (let index = 0; index < this.depth.length; index += 1) {
      mass += this.depth[index] * this.density[index] * this.cellArea;
    }
    return mass;
  }

  metrics(): SnowMetrics {
    const fieldMass = this.calculateFieldMass();
    const actualMass = fieldMass + this.carriedMass + this.objectMass;
    const expectedMass = this.initialMass + this.depositedByWeather - this.meltedMass;
    const errorMass = actualMass - expectedMass;
    return {
      fieldMass,
      carriedMass: this.carriedMass,
      objectMass: this.objectMass,
      initialMass: this.initialMass,
      depositedByWeather: this.depositedByWeather,
      meltedMass: this.meltedMass,
      expectedMass,
      errorMass,
      errorPercent: expectedMass > EPSILON ? (errorMass / expectedMass) * 100 : 0,
      activeCells: this.depth.reduce((sum, value) => sum + (value > 0.002 ? 1 : 0), 0),
      revision: this.revision,
      checksum: this.checksum(),
    };
  }

  snapshot(): SnowSnapshot {
    return {
      schemaVersion: 1,
      simulationVersion: 1,
      seed: this.world.seed,
      revision: this.revision,
      tick: this.tick,
      carriedMass: this.carriedMass,
      objectMass: this.objectMass,
      depositedByWeather: this.depositedByWeather,
      meltedMass: this.meltedMass,
      depth: new Float32Array(this.depth),
      density: new Float32Array(this.density),
      wetness: new Float32Array(this.wetness),
      hardness: new Float32Array(this.hardness),
      temperature: new Float32Array(this.temperature),
    };
  }

  restore(snapshot: SnowSnapshot): boolean {
    if (snapshot.schemaVersion !== 1 || snapshot.simulationVersion !== 1 || snapshot.seed !== this.world.seed) return false;
    if (snapshot.depth.length !== this.depth.length) return false;
    this.depth.set(snapshot.depth);
    this.density.set(snapshot.density);
    this.wetness.set(snapshot.wetness);
    this.hardness.set(snapshot.hardness);
    this.temperature.set(snapshot.temperature);
    this.revision = snapshot.revision;
    this.tick = snapshot.tick;
    this.carriedMass = snapshot.carriedMass;
    this.objectMass = snapshot.objectMass;
    this.depositedByWeather = snapshot.depositedByWeather;
    this.meltedMass = snapshot.meltedMass;
    this.appliedCommands.clear();
    this.clampAll();
    this.dirty = true;
    return true;
  }

  checksum(): string {
    let hash = 2166136261;
    for (let index = 0; index < this.depth.length; index += 1) {
      hash ^= Math.round(this.depth[index] * 4096);
      hash = Math.imul(hash, 16777619);
      hash ^= Math.round(this.density[index] * 4096);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  private worldToGrid(value: number): number {
    return Math.max(0, Math.min(this.resolution - 1, (value + this.world.size * 0.5) / this.spacing));
  }

  private bilinear(field: Float32Array, x: number, z: number): number {
    const x0 = Math.floor(x);
    const z0 = Math.floor(z);
    const x1 = Math.min(this.resolution - 1, x0 + 1);
    const z1 = Math.min(this.resolution - 1, z0 + 1);
    const tx = x - x0;
    const tz = z - z0;
    const a = field[z0 * this.resolution + x0] * (1 - tx) + field[z0 * this.resolution + x1] * tx;
    const b = field[z1 * this.resolution + x0] * (1 - tx) + field[z1 * this.resolution + x1] * tx;
    return a * (1 - tz) + b * tz;
  }

  private forBrush(x: number, z: number, radius: number, callback: (index: number, falloff: number) => void): void {
    const centerX = this.worldToGrid(x);
    const centerZ = this.worldToGrid(z);
    const gridRadius = radius / this.spacing;
    const minX = Math.max(0, Math.floor(centerX - gridRadius - 1));
    const maxX = Math.min(this.resolution - 1, Math.ceil(centerX + gridRadius + 1));
    const minZ = Math.max(0, Math.floor(centerZ - gridRadius - 1));
    const maxZ = Math.min(this.resolution - 1, Math.ceil(centerZ + gridRadius + 1));
    for (let gridZ = minZ; gridZ <= maxZ; gridZ += 1) {
      for (let gridX = minX; gridX <= maxX; gridX += 1) {
        const distance = Math.hypot((gridX - centerX) * this.spacing, (gridZ - centerZ) * this.spacing);
        if (distance > radius) continue;
        const normalized = 1 - distance / Math.max(radius, EPSILON);
        callback(gridZ * this.resolution + gridX, normalized * normalized * (3 - 2 * normalized));
      }
    }
  }

  private dig(x: number, z: number, radius: number, strength: number): number {
    let removedMass = 0;
    this.forBrush(x, z, radius, (index, falloff) => {
      const removeDepth = Math.min(this.depth[index], strength * falloff * 0.075);
      const mass = removeDepth * this.density[index] * this.cellArea;
      this.depth[index] -= removeDepth;
      this.disturbance[index] = Math.min(1, this.disturbance[index] + falloff * 0.7);
      removedMass += mass;
    });
    return removedMass;
  }

  private compact(x: number, z: number, radius: number, strength: number, footprint: boolean): number {
    let affectedMass = 0;
    this.forBrush(x, z, radius, (index, falloff) => {
      const oldDensity = this.density[index];
      const mass = this.depth[index] * oldDensity * this.cellArea;
      const densityGain = strength * falloff * (footprint ? 0.11 : 0.075);
      const newDensity = Math.min(MAX_DENSITY, oldDensity + densityGain);
      this.density[index] = newDensity;
      this.depth[index] = mass / Math.max(EPSILON, newDensity * this.cellArea);
      this.hardness[index] = Math.min(1, this.hardness[index] + densityGain * 1.8);
      this.disturbance[index] = Math.min(1, this.disturbance[index] + falloff * 0.5);
      affectedMass += mass * falloff;
    });
    return affectedMass;
  }

  private deposit(x: number, z: number, radius: number, strength: number): number {
    const desired = Math.min(this.carriedMass, Math.max(0.004, strength * 0.12));
    if (desired <= EPSILON) return 0;
    const deposited = this.depositExact(x, z, radius, desired);
    this.carriedMass -= deposited;
    return deposited;
  }

  private depositExact(x: number, z: number, radius: number, mass: number): number {
    let totalWeight = 0;
    this.forBrush(x, z, radius, (_index, falloff) => { totalWeight += falloff; });
    if (totalWeight <= EPSILON) return 0;
    let deposited = 0;
    this.forBrush(x, z, radius, (index, falloff) => {
      const cellMass = mass * (falloff / totalWeight);
      const density = Math.min(MAX_DENSITY, Math.max(MIN_DENSITY, this.density[index] * 0.82));
      const availableDepth = MAX_DEPTH - this.depth[index];
      const desiredDepth = cellMass / (density * this.cellArea);
      const addedDepth = Math.max(0, Math.min(availableDepth, desiredDepth));
      const addedMass = addedDepth * density * this.cellArea;
      const existingMass = this.depth[index] * this.density[index] * this.cellArea;
      this.depth[index] += addedDepth;
      if (this.depth[index] > EPSILON) this.density[index] = (existingMass + addedMass) / (this.depth[index] * this.cellArea);
      this.hardness[index] *= 0.92;
      this.disturbance[index] = Math.min(1, this.disturbance[index] + falloff);
      deposited += addedMass;
    });
    return deposited;
  }

  private smooth(x: number, z: number, radius: number, strength: number): number {
    this.massScratch.fill(Number.NaN);
    let moved = 0;
    this.forBrush(x, z, radius, (index, falloff) => {
      const gridX = index % this.resolution;
      const gridZ = Math.floor(index / this.resolution);
      let neighborMass = 0;
      let count = 0;
      for (const [offsetX, offsetZ] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
        const nx = gridX + offsetX;
        const nz = gridZ + offsetZ;
        if (nx < 0 || nz < 0 || nx >= this.resolution || nz >= this.resolution) continue;
        const neighbor = nz * this.resolution + nx;
        neighborMass += this.depth[neighbor] * this.density[neighbor] * this.cellArea;
        count += 1;
      }
      const currentMass = this.depth[index] * this.density[index] * this.cellArea;
      const targetMass = count > 0 ? neighborMass / count : currentMass;
      const nextMass = currentMass + (targetMass - currentMass) * strength * falloff * 0.18;
      this.massScratch[index] = Math.max(0, nextMass);
      moved += Math.abs(nextMass - currentMass) * 0.5;
    });

    let before = 0;
    let after = 0;
    this.forBrush(x, z, radius, (index) => {
      before += this.depth[index] * this.density[index] * this.cellArea;
      after += Number.isNaN(this.massScratch[index]) ? 0 : this.massScratch[index];
    });
    const correction = after > EPSILON ? before / after : 1;
    this.forBrush(x, z, radius, (index, falloff) => {
      const mass = (Number.isNaN(this.massScratch[index]) ? 0 : this.massScratch[index]) * correction;
      this.depth[index] = mass / (this.density[index] * this.cellArea);
      this.disturbance[index] = Math.min(1, this.disturbance[index] + falloff * 0.15);
    });
    return moved;
  }

  private applyWeather(dt: number, weather: WeatherState): void {
    const snowRate = Math.max(0, weather.snowfallRate) * 0.00014 * dt;
    const meltRate = Math.max(0, weather.airTemperature) * 0.000055 * dt;
    let deposited = 0;
    let melted = 0;
    if (snowRate <= EPSILON && meltRate <= EPSILON) return;
    for (let index = 0; index < this.depth.length; index += 1) {
      if (snowRate > EPSILON) {
        const retention = Math.max(0.1, 1 - this.world.exposure[index] * 0.28);
        const addedDepth = Math.min(MAX_DEPTH - this.depth[index], snowRate * retention);
        const oldMass = this.depth[index] * this.density[index] * this.cellArea;
        const addedMass = addedDepth * 0.11 * this.cellArea;
        this.depth[index] += addedDepth;
        if (this.depth[index] > EPSILON) this.density[index] = (oldMass + addedMass) / (this.depth[index] * this.cellArea);
        deposited += addedMass;
      }
      if (meltRate > EPSILON && this.depth[index] > 0) {
        const removedDepth = Math.min(this.depth[index], meltRate * (0.7 + this.world.exposure[index] * 0.4));
        const removedMass = removedDepth * this.density[index] * this.cellArea;
        this.depth[index] -= removedDepth;
        this.wetness[index] = Math.min(1, this.wetness[index] + meltRate * 24);
        melted += removedMass;
      }
    }
    this.depositedByWeather += deposited;
    this.meltedMass += melted;
    this.dirty = true;
    if (this.tick % 60 === 0) {
      if (deposited > 0) this.events.push({ type: "snowfall", x: 0, z: 0, amount: deposited, tick: this.tick });
      if (melted > 0) this.events.push({ type: "melt", x: 0, z: 0, amount: melted, tick: this.tick });
    }
  }

  private applyWind(weather: WeatherState): void {
    const magnitude = Math.hypot(weather.windX, weather.windZ);
    if (magnitude < 0.08) return;
    const stepX = Math.abs(weather.windX) >= Math.abs(weather.windZ) ? Math.sign(weather.windX) : 0;
    const stepZ = stepX === 0 ? Math.sign(weather.windZ) : 0;
    this.massScratch.fill(0);
    const startX = stepX > 0 ? 0 : this.resolution - 1;
    const endX = stepX > 0 ? this.resolution : -1;
    const incrementX = stepX > 0 ? 1 : -1;
    const startZ = stepZ > 0 ? 0 : this.resolution - 1;
    const endZ = stepZ > 0 ? this.resolution : -1;
    const incrementZ = stepZ > 0 ? 1 : -1;

    for (let z = startZ; z !== endZ; z += incrementZ) {
      for (let x = startX; x !== endX; x += incrementX) {
        const targetX = x + stepX;
        const targetZ = z + stepZ;
        if (targetX < 0 || targetZ < 0 || targetX >= this.resolution || targetZ >= this.resolution) continue;
        const index = z * this.resolution + x;
        const target = targetZ * this.resolution + targetX;
        const sourceMass = this.depth[index] * this.density[index] * this.cellArea;
        const looseness = 1 - Math.min(1, this.hardness[index] * 0.74 + this.wetness[index] * 0.6);
        const exposure = this.world.exposure[index];
        const shelterDeposit = Math.max(0, exposure - this.world.exposure[target]);
        const transfer = Math.min(sourceMass * 0.012, sourceMass * looseness * exposure * magnitude * 0.0018 * (1 + shelterDeposit * 3));
        this.massScratch[index] -= transfer;
        this.massScratch[target] += transfer;
      }
    }

    for (let index = 0; index < this.depth.length; index += 1) {
      const mass = Math.max(0, this.depth[index] * this.density[index] * this.cellArea + this.massScratch[index]);
      this.depth[index] = mass / Math.max(EPSILON, this.density[index] * this.cellArea);
    }
    this.dirty = true;
  }

  private ageSurface(weather: WeatherState, dt: number): void {
    for (let index = 0; index < this.depth.length; index += 1) {
      this.temperature[index] += (weather.airTemperature - this.temperature[index]) * Math.min(1, dt * 0.02);
      if (this.temperature[index] < -2 && this.wetness[index] > 0.15) {
        this.hardness[index] = Math.min(1, this.hardness[index] + this.wetness[index] * dt * 0.003);
        this.wetness[index] = Math.max(0, this.wetness[index] - dt * 0.002);
      }
      this.disturbance[index] *= Math.pow(0.998, dt);
    }
  }

  private clampAll(): void {
    for (let index = 0; index < this.depth.length; index += 1) {
      this.depth[index] = Math.min(MAX_DEPTH, Math.max(0, Number.isFinite(this.depth[index]) ? this.depth[index] : 0));
      this.density[index] = Math.min(MAX_DENSITY, Math.max(MIN_DENSITY, Number.isFinite(this.density[index]) ? this.density[index] : MIN_DENSITY));
      this.wetness[index] = Math.min(1, Math.max(0, Number.isFinite(this.wetness[index]) ? this.wetness[index] : 0));
      this.hardness[index] = Math.min(1, Math.max(0, Number.isFinite(this.hardness[index]) ? this.hardness[index] : 0));
      this.temperature[index] = Math.min(MAX_TEMP, Math.max(MIN_TEMP, Number.isFinite(this.temperature[index]) ? this.temperature[index] : -5));
    }
  }
}
