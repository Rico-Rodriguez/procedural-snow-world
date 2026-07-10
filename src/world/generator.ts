export interface GeneratedWorld {
  readonly seed: number;
  readonly size: number;
  readonly resolution: number;
  readonly spacing: number;
  readonly terrain: Float32Array;
  readonly snowDepth: Float32Array;
  readonly exposure: Float32Array;
}

export interface WorldSample {
  height: number;
  slope: number;
  exposure: number;
}

const TAU = Math.PI * 2;

export function seedFromText(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function hash2D(seed: number, x: number, z: number, namespace = 0): number {
  let hash = seed ^ Math.imul(x, 0x9e3779b1) ^ Math.imul(z, 0x85ebca77) ^ namespace;
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b);
  hash ^= hash >>> 16;
  return (hash >>> 0) / 4294967295;
}

function smooth(value: number): number {
  return value * value * (3 - 2 * value);
}

function valueNoise(seed: number, x: number, z: number, namespace: number): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const tx = smooth(x - x0);
  const tz = smooth(z - z0);
  const a = hash2D(seed, x0, z0, namespace) * 2 - 1;
  const b = hash2D(seed, x0 + 1, z0, namespace) * 2 - 1;
  const c = hash2D(seed, x0, z0 + 1, namespace) * 2 - 1;
  const d = hash2D(seed, x0 + 1, z0 + 1, namespace) * 2 - 1;
  const top = a + (b - a) * tx;
  const bottom = c + (d - c) * tx;
  return top + (bottom - top) * tz;
}

function fbm(seed: number, x: number, z: number, namespace: number, octaves = 4): number {
  let value = 0;
  let amplitude = 0.55;
  let frequency = 1;
  let totalAmplitude = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    value += valueNoise(seed, x * frequency, z * frequency, namespace + octave * 137) * amplitude;
    totalAmplitude += amplitude;
    amplitude *= 0.5;
    frequency *= 2.03;
  }
  return value / totalAmplitude;
}

export function terrainHeight(seed: number, x: number, z: number): number {
  const warpX = fbm(seed, x / 21, z / 21, 0x71a3, 3) * 4.8;
  const warpZ = fbm(seed, x / 23, z / 23, 0x91c7, 3) * 4.8;
  const broad = fbm(seed, (x + warpX) / 26, (z + warpZ) / 26, 0x1011, 4) * 4.1;
  const ridgeNoise = Math.abs(fbm(seed, (x - warpZ) / 18, (z + warpX) / 18, 0x2017, 4));
  const ridge = Math.pow(ridgeNoise, 1.7) * 5.5;
  const detail = fbm(seed, x / 6, z / 6, 0x3019, 3) * 0.46;
  const radial = Math.hypot(x, z) / 32;
  const arenaRim = Math.max(0, radial - 0.64) ** 2 * 13;
  const shelteredCenter = -Math.exp(-(x * x + z * z) / 150) * 0.8;
  return broad + ridge + detail + arenaRim + shelteredCenter;
}

function calculateExposure(terrain: Float32Array, resolution: number, index: number): number {
  const x = index % resolution;
  const z = Math.floor(index / resolution);
  const left = terrain[z * resolution + Math.max(0, x - 1)];
  const right = terrain[z * resolution + Math.min(resolution - 1, x + 1)];
  const down = terrain[Math.max(0, z - 1) * resolution + x];
  const up = terrain[Math.min(resolution - 1, z + 1) * resolution + x];
  const slope = Math.hypot(right - left, up - down);
  const height = terrain[index];
  return Math.min(1, Math.max(0.08, 0.42 + height * 0.035 + slope * 0.18));
}

export function generateWorld(seedText: string, size = 64, resolution = 129): GeneratedWorld {
  const seed = seedFromText(seedText);
  const spacing = size / (resolution - 1);
  const count = resolution * resolution;
  const terrain = new Float32Array(count);
  const snowDepth = new Float32Array(count);
  const exposure = new Float32Array(count);
  const half = size * 0.5;

  for (let zIndex = 0; zIndex < resolution; zIndex += 1) {
    for (let xIndex = 0; xIndex < resolution; xIndex += 1) {
      const index = zIndex * resolution + xIndex;
      const x = xIndex * spacing - half;
      const z = zIndex * spacing - half;
      terrain[index] = terrainHeight(seed, x, z);
    }
  }

  for (let index = 0; index < count; index += 1) {
    exposure[index] = calculateExposure(terrain, resolution, index);
    const xIndex = index % resolution;
    const zIndex = Math.floor(index / resolution);
    const patch = valueNoise(seed, xIndex / 18, zIndex / 18, 0x4501);
    const shelter = 1 - exposure[index] * 0.44;
    snowDepth[index] = Math.max(0.18, 0.64 + patch * 0.16 + shelter * 0.42);
  }

  return { seed, size, resolution, spacing, terrain, snowDepth, exposure };
}

export function deterministicPoints(seed: number, count: number, radius: number, namespace: number): Array<{ x: number; z: number; scale: number; rotation: number }> {
  const points: Array<{ x: number; z: number; scale: number; rotation: number }> = [];
  const minimumDistance = Math.sqrt((Math.PI * radius * radius) / Math.max(1, count)) * 0.43;
  for (let attempt = 0; attempt < count * 18 && points.length < count; attempt += 1) {
    const angle = hash2D(seed, attempt, namespace, 0x17) * TAU;
    const distance = Math.sqrt(hash2D(seed, attempt, namespace, 0x29)) * radius;
    const x = Math.cos(angle) * distance;
    const z = Math.sin(angle) * distance;
    if (Math.hypot(x, z) < 7.5) continue;
    if (points.some((point) => Math.hypot(point.x - x, point.z - z) < minimumDistance)) continue;
    points.push({
      x,
      z,
      scale: 0.72 + hash2D(seed, attempt, namespace, 0x31) * 0.68,
      rotation: hash2D(seed, attempt, namespace, 0x41) * TAU,
    });
  }
  return points;
}

export function sampleGeneratedWorld(world: GeneratedWorld, x: number, z: number): WorldSample {
  const half = world.size * 0.5;
  const gridX = Math.max(0, Math.min(world.resolution - 1, (x + half) / world.spacing));
  const gridZ = Math.max(0, Math.min(world.resolution - 1, (z + half) / world.spacing));
  const x0 = Math.floor(gridX);
  const z0 = Math.floor(gridZ);
  const x1 = Math.min(world.resolution - 1, x0 + 1);
  const z1 = Math.min(world.resolution - 1, z0 + 1);
  const tx = gridX - x0;
  const tz = gridZ - z0;
  const sample = (field: Float32Array) => {
    const a = field[z0 * world.resolution + x0] * (1 - tx) + field[z0 * world.resolution + x1] * tx;
    const b = field[z1 * world.resolution + x0] * (1 - tx) + field[z1 * world.resolution + x1] * tx;
    return a * (1 - tz) + b * tz;
  };
  const height = sample(world.terrain);
  const epsilon = world.spacing;
  const left = terrainHeight(world.seed, x - epsilon, z);
  const right = terrainHeight(world.seed, x + epsilon, z);
  const down = terrainHeight(world.seed, x, z - epsilon);
  const up = terrainHeight(world.seed, x, z + epsilon);
  return { height, slope: Math.hypot(right - left, up - down) / (epsilon * 2), exposure: sample(world.exposure) };
}
