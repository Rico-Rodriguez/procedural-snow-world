import {
  AbstractEngine,
  Color3,
  Color4,
  CreateBox,
  CreateCylinder,
  CreatePolyhedron,
  CreateSphere,
  DirectionalLight,
  DynamicTexture,
  Engine,
  FreeCamera,
  HemisphericLight,
  Matrix,
  Mesh,
  ParticleSystem,
  Quaternion,
  Ray,
  Scene,
  StandardMaterial,
  Texture,
  TransformNode,
  Vector3,
  VertexBuffer,
  VertexData,
  WebGPUEngine,
} from "@babylonjs/core";
import type { SnowSimulation, WeatherState } from "../simulation/snow-simulation";
import { deterministicPoints, sampleGeneratedWorld, type GeneratedWorld } from "../world/generator";

export interface SnowballRecord {
  x: number;
  y: number;
  z: number;
  mass: number;
  density: number;
  wetness: number;
  held?: boolean;
}

export interface ViewCallbacks {
  onInteract: (x: number, z: number) => void;
  onFootstep: (x: number, z: number, side: -1 | 1, speed: number) => void;
  onBallImpact: (x: number, z: number, requestedMass: number, energy: number) => number;
  onBallGathered: (mass: number) => void;
  onPointerLockChange: (locked: boolean) => void;
  onTouchLookStart: () => void;
  onGrabStateChange: (holding: boolean) => void;
  onAimChange: (x: number, z: number, valid: boolean) => void;
}

interface SnowballVisual {
  id: number;
  mesh: Mesh;
  mass: number;
  density: number;
  wetness: number;
  velocity: Vector3;
  held: boolean;
  placed: boolean;
  impactCooldown: number;
}

export class SnowWorldView {
  readonly backend: "WebGPU" | "WebGL 2";
  readonly engine: AbstractEngine;
  readonly scene: Scene;
  readonly camera: FreeCamera;

  private readonly canvas: HTMLCanvasElement;
  private readonly world: GeneratedWorld;
  private readonly simulation: SnowSimulation;
  private readonly callbacks: ViewCallbacks;
  private readonly snowMesh: Mesh;
  private readonly snowMaterial: StandardMaterial;
  private readonly sun: DirectionalLight;
  private readonly skyLight: HemisphericLight;
  private readonly snowfall: ParticleSystem;
  private readonly powder: ParticleSystem;
  private readonly positions: number[];
  private readonly normals: number[];
  private readonly colors: number[];
  private readonly indices: number[];
  private readonly keys = new Set<string>();
  private readonly snowballs: SnowballVisual[] = [];
  private readonly snowmen = new Set<string>();
  private weather: WeatherState = { snowfallRate: 0.62, airTemperature: -7, windX: 0.42, windZ: 0.12, gustiness: 0.35 };
  private yaw = 0.55;
  private pitch = -0.08;
  private velocity = new Vector3();
  private interactionHeld = false;
  private lastInteractionAt = 0;
  private lastStepAt = 0;
  private stepSide: -1 | 1 = -1;
  private elapsed = 0;
  private meshUpdateAccumulator = 0;
  private activeBallId: number | null = null;
  private nextBallId = 1;
  private destroyed = false;
  private lastAim = { x: 0, z: 0, valid: false };
  private mobileForward = 0;
  private mobileRight = 0;
  private mobileSprint = false;
  private inputEnabled = true;
  private lookPointerId: number | null = null;
  private lastLookX = 0;
  private lastLookY = 0;

  private constructor(
    canvas: HTMLCanvasElement,
    engine: AbstractEngine,
    backend: "WebGPU" | "WebGL 2",
    world: GeneratedWorld,
    simulation: SnowSimulation,
    callbacks: ViewCallbacks,
  ) {
    this.canvas = canvas;
    this.engine = engine;
    this.backend = backend;
    this.world = world;
    this.simulation = simulation;
    this.callbacks = callbacks;
    this.scene = new Scene(engine);
    this.scene.clearColor = new Color4(0.48, 0.63, 0.7, 1);
    this.scene.fogMode = Scene.FOGMODE_EXP2;
    this.scene.fogDensity = 0.0085;
    this.scene.fogColor = new Color3(0.53, 0.65, 0.71);
    this.scene.ambientColor = new Color3(0.24, 0.31, 0.36);

    this.camera = new FreeCamera("explorer-camera", new Vector3(0, 3, -3), this.scene);
    this.camera.minZ = 0.08;
    this.camera.maxZ = 620;
    this.camera.fov = 1.08;
    this.camera.rotation.set(this.pitch, this.yaw, 0);

    this.skyLight = new HemisphericLight("sky-light", new Vector3(0, 1, 0), this.scene);
    this.skyLight.intensity = 0.82;
    this.skyLight.diffuse = new Color3(0.76, 0.84, 0.89);
    this.skyLight.groundColor = new Color3(0.36, 0.46, 0.51);
    this.sun = new DirectionalLight("low-winter-sun", new Vector3(-0.38, -0.72, 0.52), this.scene);
    this.sun.position = new Vector3(24, 44, -30);
    this.sun.intensity = 1.38;
    this.sun.diffuse = new Color3(1, 0.86, 0.68);

    this.createTerrainBed();
    const meshData = this.createSnowMesh();
    this.snowMesh = meshData.mesh;
    this.positions = meshData.positions;
    this.normals = meshData.normals;
    this.colors = meshData.colors;
    this.indices = meshData.indices;
    this.snowMaterial = meshData.material;
    this.createVegetation();
    this.createDistantRidges();
    this.createIceMarker();

    this.snowfall = this.createSnowfall();
    this.powder = this.createPowder();
    this.installInput();
    this.updateSurfaceMesh(true);
    this.setTimeOfDay(0.32);
  }

  static async create(
    canvas: HTMLCanvasElement,
    world: GeneratedWorld,
    simulation: SnowSimulation,
    callbacks: ViewCallbacks,
  ): Promise<SnowWorldView> {
    let engine: AbstractEngine;
    let backend: "WebGPU" | "WebGL 2" = "WebGL 2";
    const forceWebGL = new URLSearchParams(window.location.search).get("renderer") === "webgl";
    try {
      if (!forceWebGL && await WebGPUEngine.IsSupportedAsync) {
        const webgpu = new WebGPUEngine(canvas, { antialias: true, adaptToDeviceRatio: true });
        await webgpu.initAsync();
        engine = webgpu;
        backend = "WebGPU";
      } else {
        engine = new Engine(canvas, true, { preserveDrawingBuffer: false, stencil: true, adaptToDeviceRatio: true });
      }
    } catch {
      engine = new Engine(canvas, true, { preserveDrawingBuffer: false, stencil: true, adaptToDeviceRatio: true });
    }
    return new SnowWorldView(canvas, engine, backend, world, simulation, callbacks);
  }

  start(): void {
    this.engine.runRenderLoop(() => {
      if (this.destroyed) return;
      const dt = Math.min(0.05, this.engine.getDeltaTime() / 1000);
      this.elapsed += dt;
      this.meshUpdateAccumulator += dt;
      this.updatePlayer(dt);
      this.updateAim();
      this.updateInteraction();
      this.updateSnowballs(dt);
      this.updateWeatherPresentation();
      if (this.meshUpdateAccumulator > 0.09 && this.simulation.consumeDirty()) {
        this.updateSurfaceMesh(false);
        this.meshUpdateAccumulator = 0;
      }
      this.scene.render();
    });
  }

  destroy(): void {
    this.destroyed = true;
    this.engine.stopRenderLoop();
    this.scene.dispose();
    this.engine.dispose();
  }

  resize(): void {
    this.engine.resize();
  }

  setWeather(weather: WeatherState): void {
    this.weather = weather;
  }

  setTimeOfDay(value: number): void {
    const angle = value * Math.PI * 2 - Math.PI * 0.15;
    const elevation = Math.sin(angle);
    this.sun.direction.set(Math.cos(angle) * -0.62, -Math.max(0.08, Math.abs(elevation)), Math.sin(angle) * 0.62);
    const daylight = Math.min(1, Math.max(0.08, elevation * 1.2 + 0.38));
    const dusk = 1 - Math.min(1, Math.abs(elevation) * 2.4);
    this.sun.intensity = daylight * 1.35;
    this.skyLight.intensity = 0.18 + daylight * 0.7;
    this.scene.clearColor = Color4.FromColor3(Color3.Lerp(new Color3(0.025, 0.055, 0.1), new Color3(0.48 + dusk * 0.06, 0.63, 0.7), daylight));
    this.scene.fogColor = Color3.Lerp(new Color3(0.04, 0.08, 0.13), new Color3(0.53 + dusk * 0.04, 0.65, 0.71), daylight);
    this.snowMaterial.diffuseColor = Color3.Lerp(new Color3(0.43, 0.56, 0.68), new Color3(0.94, 0.985, 1), daylight);
  }

  setParticleQuality(multiplier: number): void {
    this.snowfall.emitRate = Math.round((180 + this.weather.snowfallRate * 1550) * multiplier);
  }

  setMoveInput(forward: number, right: number, sprint: boolean): void {
    this.mobileForward = Math.max(-1, Math.min(1, forward));
    this.mobileRight = Math.max(-1, Math.min(1, right));
    this.mobileSprint = sprint;
  }

  setPrimaryAction(active: boolean): "using" | "thrown" | "idle" {
    if (!this.inputEnabled) return "idle";
    if (!active) {
      this.interactionHeld = false;
      return "idle";
    }
    if (this.throwHeldBall()) return "thrown";
    this.interactionHeld = true;
    this.triggerInteraction();
    return "using";
  }

  setInputEnabled(enabled: boolean): void {
    this.inputEnabled = enabled;
    if (enabled) return;
    this.keys.clear();
    this.interactionHeld = false;
    this.setMoveInput(0, 0, false);
    this.releaseLookPointer();
  }

  getPlayerState(): { x: number; z: number; yaw: number } {
    return { x: this.camera.position.x, z: this.camera.position.z, yaw: this.yaw };
  }

  setPlayerState(state: { x: number; z: number; yaw: number }): void {
    this.camera.position.x = state.x;
    this.camera.position.z = state.z;
    this.yaw = state.yaw;
  }

  getAimPoint(): { x: number; z: number; valid: boolean } {
    return { ...this.lastAim };
  }

  burstPowder(x: number, z: number, amount: number): void {
    const y = this.simulation.surfaceHeight(x, z) + 0.08;
    this.powder.emitter = new Vector3(x, y, z);
    this.powder.manualEmitCount = Math.max(4, Math.min(70, Math.round(amount * 420)));
  }

  growSnowball(x: number, z: number, mass: number, density: number, wetness: number): void {
    if (mass <= 0) return;
    let ball = this.snowballs.find((candidate) => candidate.id === this.activeBallId);
    if (!ball || ball.held || ball.placed) {
      ball = this.createSnowball({ x, y: this.simulation.surfaceHeight(x, z) + 0.18, z, mass: 0, density, wetness });
      this.activeBallId = ball.id;
    }
    const total = ball.mass + mass;
    ball.density = total > 0 ? (ball.density * ball.mass + density * mass) / total : density;
    ball.wetness = total > 0 ? (ball.wetness * ball.mass + wetness * mass) / total : wetness;
    ball.mass = total;
    ball.placed = false;
    const target = new Vector3(x, 0, z);
    const delta = target.subtract(ball.mesh.position);
    delta.y = 0;
    if (delta.lengthSquared() > 0.01) {
      delta.normalize();
      ball.mesh.position.addInPlace(delta.scale(Math.min(0.75, 0.16 + mass * 5)));
      ball.mesh.rotation.z += 0.24;
      ball.mesh.rotation.x += 0.12;
    }
    this.updateSnowballScale(ball);
    ball.mesh.position.y = this.simulation.surfaceHeight(ball.mesh.position.x, ball.mesh.position.z) + this.ballRadius(ball);
    this.callbacks.onBallGathered(mass);
  }

  serializeSnowballs(): SnowballRecord[] {
    return this.snowballs.map((ball) => ({
      x: ball.mesh.position.x,
      y: ball.mesh.position.y,
      z: ball.mesh.position.z,
      mass: ball.mass,
      density: ball.density,
      wetness: ball.wetness,
      held: ball.held,
    }));
  }

  restoreSnowballs(records: SnowballRecord[]): void {
    for (const existing of this.snowballs) existing.mesh.dispose();
    this.snowballs.length = 0;
    for (const record of records) {
      const ball = this.createSnowball(record);
      ball.held = false;
      ball.placed = true;
    }
    this.activeBallId = this.snowballs.at(-1)?.id ?? null;
    this.recognizeSnowmen();
  }

  toggleGrab(): "grabbed" | "placed" | "none" {
    if (!this.inputEnabled) return "none";
    const held = this.snowballs.find((ball) => ball.held);
    if (held) {
      held.held = false;
      held.placed = true;
      const aim = this.pickSnow();
      if (aim) {
        held.mesh.position.x = aim.x;
        held.mesh.position.z = aim.z;
      }
      this.placeOnSurfaceOrBall(held);
      this.activeBallId = held.id;
      this.recognizeSnowmen();
      this.callbacks.onGrabStateChange(false);
      return "placed";
    }
    const candidate = this.findGrabbableBall();
    if (!candidate) return "none";
    candidate.held = true;
    candidate.placed = false;
    candidate.velocity.setAll(0);
    this.activeBallId = candidate.id;
    this.callbacks.onGrabStateChange(true);
    return "grabbed";
  }

  throwHeldBall(): boolean {
    const ball = this.snowballs.find((candidate) => candidate.held);
    if (!ball) return false;
    ball.held = false;
    ball.placed = false;
    const direction = this.camera.getForwardRay().direction.normalize();
    ball.velocity = direction.scale(10.5 + Math.min(5, ball.mass * 4));
    ball.velocity.y += 2.4;
    ball.impactCooldown = 0.12;
    this.activeBallId = ball.id;
    this.callbacks.onGrabStateChange(false);
    return true;
  }

  private createTerrainBed(): void {
    const resolution = this.world.resolution;
    const positions: number[] = [];
    const indices: number[] = [];
    const normals: number[] = [];
    const half = this.world.size * 0.5;
    for (let z = 0; z < resolution; z += 1) {
      for (let x = 0; x < resolution; x += 1) {
        const index = z * resolution + x;
        positions.push(x * this.world.spacing - half, this.world.terrain[index] - 0.06, z * this.world.spacing - half);
      }
    }
    this.buildGridIndices(indices);
    VertexData.ComputeNormals(positions, indices, normals);
    const mesh = new Mesh("terrain-bed", this.scene);
    const vertexData = new VertexData();
    vertexData.positions = positions;
    vertexData.indices = indices;
    vertexData.normals = normals;
    vertexData.applyToMesh(mesh);
    const material = new StandardMaterial("terrain-bed-material", this.scene);
    material.diffuseColor = new Color3(0.18, 0.25, 0.24);
    material.specularColor = new Color3(0.025, 0.03, 0.028);
    material.roughness = 0.92;
    mesh.material = material;
    mesh.receiveShadows = true;
    mesh.isVisible = false;
  }

  private createSnowMesh(): { mesh: Mesh; positions: number[]; normals: number[]; colors: number[]; indices: number[]; material: StandardMaterial } {
    const positions: number[] = [];
    const normals: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    const half = this.world.size * 0.5;
    for (let z = 0; z < this.world.resolution; z += 1) {
      for (let x = 0; x < this.world.resolution; x += 1) {
        const index = z * this.world.resolution + x;
        positions.push(x * this.world.spacing - half, this.world.terrain[index] + this.simulation.depth[index], z * this.world.spacing - half);
        colors.push(0.91, 0.965, 1, 1);
      }
    }
    this.buildGridIndices(indices);
    VertexData.ComputeNormals(positions, indices, normals);
    const mesh = new Mesh("snow-surface", this.scene);
    const vertexData = new VertexData();
    vertexData.positions = positions;
    vertexData.indices = indices;
    vertexData.normals = normals;
    vertexData.colors = colors;
    vertexData.applyToMesh(mesh, true);
    const material = new StandardMaterial("snow-material", this.scene);
    material.diffuseColor = new Color3(0.94, 0.985, 1);
    material.specularColor = new Color3(0.32, 0.42, 0.48);
    material.specularPower = 72;
    material.roughness = 0.76;
    material.emissiveColor = new Color3(0.13, 0.17, 0.2);
    mesh.material = material;
    mesh.receiveShadows = true;
    mesh.isPickable = true;
    return { mesh, positions, normals, colors, indices, material };
  }

  private buildGridIndices(indices: number[]): void {
    for (let z = 0; z < this.world.resolution - 1; z += 1) {
      for (let x = 0; x < this.world.resolution - 1; x += 1) {
        const a = z * this.world.resolution + x;
        const b = a + 1;
        const c = a + this.world.resolution;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
  }

  private updateSurfaceMesh(force: boolean): void {
    const count = this.world.resolution * this.world.resolution;
    for (let index = 0; index < count; index += 1) {
      this.positions[index * 3 + 1] = this.world.terrain[index] + this.simulation.depth[index];
      const packed = Math.min(1, (this.simulation.density[index] - 0.12) * 2.1);
      const disturbed = this.simulation.disturbance[index];
      const wet = this.simulation.wetness[index];
      this.colors[index * 4] = 0.91 - wet * 0.12 - disturbed * 0.045;
      this.colors[index * 4 + 1] = 0.965 - wet * 0.1 - packed * 0.018;
      this.colors[index * 4 + 2] = 1 - packed * 0.035;
      this.colors[index * 4 + 3] = 1;
    }
    VertexData.ComputeNormals(this.positions, this.indices, this.normals);
    if (force) return;
    this.snowMesh.updateVerticesData(VertexBuffer.PositionKind, this.positions, false, false);
    this.snowMesh.updateVerticesData(VertexBuffer.NormalKind, this.normals, false, false);
    this.snowMesh.updateVerticesData(VertexBuffer.ColorKind, this.colors, false, false);
    this.snowMesh.refreshBoundingInfo();
  }

  private createVegetation(): void {
    const treePoints = deterministicPoints(this.world.seed, 55, 29, 0x7a11);
    const trunk = CreateCylinder("tree-trunk", { height: 3.1, diameterTop: 0.18, diameterBottom: 0.34, tessellation: 7 }, this.scene);
    const trunkMaterial = new StandardMaterial("trunk-material", this.scene);
    trunkMaterial.diffuseColor = new Color3(0.16, 0.13, 0.115);
    trunkMaterial.specularColor = Color3.Black();
    trunk.material = trunkMaterial;
    trunk.isVisible = false;
    const branchMaterial = new StandardMaterial("needles-material", this.scene);
    branchMaterial.diffuseColor = new Color3(0.075, 0.19, 0.17);
    branchMaterial.specularColor = new Color3(0.015, 0.03, 0.028);
    branchMaterial.emissiveColor = new Color3(0.012, 0.028, 0.025);
    const snowCapMaterial = new StandardMaterial("branch-snow-material", this.scene);
    snowCapMaterial.diffuseColor = new Color3(0.84, 0.92, 0.95);
    snowCapMaterial.specularColor = new Color3(0.11, 0.15, 0.18);

    const layers = [
      CreateCylinder("pine-low", { height: 2.3, diameterTop: 0, diameterBottom: 3.15, tessellation: 8 }, this.scene),
      CreateCylinder("pine-mid", { height: 2.15, diameterTop: 0, diameterBottom: 2.55, tessellation: 8 }, this.scene),
      CreateCylinder("pine-top", { height: 2.05, diameterTop: 0, diameterBottom: 1.8, tessellation: 8 }, this.scene),
    ];
    for (const layer of layers) {
      layer.material = branchMaterial;
      layer.isVisible = false;
    }
    const snowCap = CreateCylinder("pine-snow-cap", { height: 0.24, diameterTop: 0, diameterBottom: 2.4, tessellation: 8 }, this.scene);
    snowCap.material = snowCapMaterial;
    snowCap.isVisible = false;

    const trunkMatrices: Matrix[] = [];
    const layerMatrices: Matrix[][] = [[], [], []];
    const capMatrices: Matrix[] = [];
    for (const point of treePoints) {
      const sample = sampleGeneratedWorld(this.world, point.x, point.z);
      if (sample.slope > 1.25) continue;
      const ground = this.simulation.surfaceHeight(point.x, point.z);
      const scale = point.scale;
      const rotation = Quaternion.RotationAxis(Vector3.Up(), point.rotation);
      trunkMatrices.push(Matrix.Compose(new Vector3(scale, scale, scale), rotation, new Vector3(point.x, ground + 1.45 * scale, point.z)));
      const heights = [2.5, 3.75, 4.85];
      for (let layerIndex = 0; layerIndex < 3; layerIndex += 1) {
        layerMatrices[layerIndex].push(Matrix.Compose(new Vector3(scale, scale, scale), rotation, new Vector3(point.x, ground + heights[layerIndex] * scale, point.z)));
      }
      capMatrices.push(Matrix.Compose(new Vector3(scale, scale, scale), rotation, new Vector3(point.x - 0.08, ground + 3.23 * scale, point.z + 0.05)));
    }
    const applyMatrices = (mesh: Mesh, matrices: Matrix[]) => {
      mesh.isVisible = true;
      for (const matrix of matrices) mesh.thinInstanceAdd(matrix);
    };
    applyMatrices(trunk, trunkMatrices);
    layers.forEach((layer, index) => applyMatrices(layer, layerMatrices[index]));
    applyMatrices(snowCap, capMatrices);

    const rock = CreatePolyhedron("rock", { type: 1, size: 1 }, this.scene);
    const rockMaterial = new StandardMaterial("rock-material", this.scene);
    rockMaterial.diffuseColor = new Color3(0.25, 0.31, 0.32);
    rockMaterial.specularColor = new Color3(0.03, 0.04, 0.04);
    rock.material = rockMaterial;
    rock.isVisible = false;
    for (const point of deterministicPoints(this.world.seed, 18, 27, 0x5b13)) {
      const ground = this.simulation.surfaceHeight(point.x, point.z);
      const scale = point.scale * 0.74;
      rock.thinInstanceAdd(Matrix.Compose(
        new Vector3(scale * 1.3, scale * 0.72, scale),
        Quaternion.RotationAxis(Vector3.Up(), point.rotation),
        new Vector3(point.x, ground - scale * 0.25, point.z),
      ));
    }
    rock.isVisible = true;
  }

  private createDistantRidges(): void {
    const material = new StandardMaterial("distant-ridge-material", this.scene);
    material.diffuseColor = new Color3(0.22, 0.34, 0.39);
    material.specularColor = Color3.Black();
    material.alpha = 0.78;
    for (let index = 0; index < 16; index += 1) {
      const angle = (index / 16) * Math.PI * 2;
      const distance = 105 + (index % 3) * 8;
      const height = 25 + (index % 5) * 6;
      const ridge = CreateCylinder(`distant-ridge-${index}`, { height, diameterTop: 0, diameterBottom: 44 + (index % 4) * 8, tessellation: 5 }, this.scene);
      ridge.position.set(Math.cos(angle) * distance, -4 + height * 0.5, Math.sin(angle) * distance);
      ridge.rotation.y = angle * 0.7;
      ridge.material = material;
      ridge.isPickable = false;
    }
  }

  private createIceMarker(): void {
    const postMaterial = new StandardMaterial("marker-material", this.scene);
    postMaterial.diffuseColor = new Color3(0.92, 0.39, 0.18);
    postMaterial.emissiveColor = new Color3(0.09, 0.02, 0.005);
    const x = 2.8;
    const z = 3.4;
    const y = this.simulation.surfaceHeight(x, z);
    const post = CreateCylinder("survey-post", { height: 1.5, diameter: 0.07, tessellation: 6 }, this.scene);
    post.position.set(x, y + 0.68, z);
    post.material = postMaterial;
    const flag = CreateBox("survey-flag", { width: 0.64, height: 0.25, depth: 0.025 }, this.scene);
    flag.position.set(x + 0.3, y + 1.25, z);
    flag.material = postMaterial;
  }

  private createSnowfall(): ParticleSystem {
    const texture = this.makeFlakeTexture("flake-texture", false);
    const particles = new ParticleSystem("falling-snow", 9000, this.scene);
    particles.particleTexture = texture;
    particles.emitter = new Vector3(0, 13, 0);
    particles.minEmitBox = new Vector3(-24, -2, -24);
    particles.maxEmitBox = new Vector3(24, 15, 24);
    particles.color1 = new Color4(0.92, 0.97, 1, 0.88);
    particles.color2 = new Color4(0.72, 0.86, 0.94, 0.68);
    particles.colorDead = new Color4(0.75, 0.86, 0.92, 0);
    particles.minSize = 0.025;
    particles.maxSize = 0.11;
    particles.minLifeTime = 3.2;
    particles.maxLifeTime = 6.5;
    particles.emitRate = 1150;
    particles.minEmitPower = 0.2;
    particles.maxEmitPower = 0.7;
    particles.direction1 = new Vector3(-0.35, -1, -0.1);
    particles.direction2 = new Vector3(0.35, -0.65, 0.1);
    particles.gravity = new Vector3(0.18, -0.58, 0.04);
    particles.updateSpeed = 0.015;
    particles.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    particles.start();
    return particles;
  }

  private createPowder(): ParticleSystem {
    const texture = this.makeFlakeTexture("powder-texture", true);
    const particles = new ParticleSystem("powder-bursts", 1600, this.scene);
    particles.particleTexture = texture;
    particles.emitter = Vector3.Zero();
    particles.manualEmitCount = 0;
    particles.color1 = new Color4(0.88, 0.95, 1, 0.76);
    particles.color2 = new Color4(0.7, 0.84, 0.91, 0.5);
    particles.colorDead = new Color4(0.62, 0.76, 0.84, 0);
    particles.minSize = 0.025;
    particles.maxSize = 0.11;
    particles.minLifeTime = 0.25;
    particles.maxLifeTime = 0.8;
    particles.direction1 = new Vector3(-1.2, 0.35, -1.2);
    particles.direction2 = new Vector3(1.2, 1.8, 1.2);
    particles.minEmitPower = 0.3;
    particles.maxEmitPower = 1.2;
    particles.gravity = new Vector3(0, -2.8, 0);
    particles.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    particles.start();
    return particles;
  }

  private makeFlakeTexture(name: string, soft: boolean): Texture {
    const texture = new DynamicTexture(name, { width: 64, height: 64 }, this.scene, false);
    const context = texture.getContext();
    context.clearRect(0, 0, 64, 64);
    const gradient = context.createRadialGradient(32, 32, soft ? 1 : 5, 32, 32, 30);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(soft ? 0.24 : 0.55, "rgba(235,248,255,0.9)");
    gradient.addColorStop(1, "rgba(220,242,255,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 64);
    texture.update();
    return texture;
  }

  private installInput(): void {
    this.canvas.addEventListener("click", (event) => {
      if (!this.inputEnabled || event instanceof PointerEvent && event.pointerType === "touch") return;
      if (!window.matchMedia("(any-hover: hover) and (any-pointer: fine)").matches) return;
      if (document.pointerLockElement !== this.canvas) void this.canvas.requestPointerLock().catch(() => undefined);
    });
    document.addEventListener("pointerlockchange", () => this.callbacks.onPointerLockChange(document.pointerLockElement === this.canvas));
    document.addEventListener("mousemove", (event) => {
      if (!this.inputEnabled || document.pointerLockElement !== this.canvas) return;
      this.applyLookDelta(event.movementX, event.movementY, 0.00185);
    });
    window.addEventListener("keydown", (event) => {
      if (!this.inputEnabled) return;
      this.keys.add(event.code);
      if (event.code === "KeyE" && !event.repeat) this.toggleGrab();
    });
    window.addEventListener("keyup", (event) => this.keys.delete(event.code));
    this.canvas.addEventListener("mousedown", (event) => {
      if (!this.inputEnabled || event.button !== 0) return;
      if (this.throwHeldBall()) return;
      this.interactionHeld = true;
      this.triggerInteraction();
    });
    window.addEventListener("mouseup", (event) => {
      if (event.button === 0) this.interactionHeld = false;
    });
    this.canvas.addEventListener("contextmenu", (event) => event.preventDefault());
    this.canvas.addEventListener("pointerdown", (event) => {
      if (!this.inputEnabled || event.pointerType !== "touch" || this.lookPointerId !== null) return;
      event.preventDefault();
      this.lookPointerId = event.pointerId;
      this.lastLookX = event.clientX;
      this.lastLookY = event.clientY;
      this.canvas.setPointerCapture(event.pointerId);
      this.callbacks.onTouchLookStart();
    });
    this.canvas.addEventListener("pointermove", (event) => {
      if (!this.inputEnabled || event.pointerId !== this.lookPointerId) return;
      event.preventDefault();
      const deltaX = event.clientX - this.lastLookX;
      const deltaY = event.clientY - this.lastLookY;
      this.lastLookX = event.clientX;
      this.lastLookY = event.clientY;
      this.applyLookDelta(deltaX, deltaY, 0.0042);
    });
    for (const eventName of ["pointerup", "pointercancel", "lostpointercapture"] as const) {
      this.canvas.addEventListener(eventName, (event) => {
        if (event.pointerId === this.lookPointerId) this.releaseLookPointer();
      });
    }
    window.addEventListener("blur", () => this.resetTransientInput());
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.resetTransientInput();
    });
  }

  private applyLookDelta(deltaX: number, deltaY: number, sensitivity: number): void {
    this.yaw += deltaX * sensitivity;
    this.pitch = Math.max(-1.22, Math.min(1.22, this.pitch + deltaY * sensitivity * 0.9));
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }

  private releaseLookPointer(): void {
    const pointerId = this.lookPointerId;
    this.lookPointerId = null;
    if (pointerId !== null && this.canvas.hasPointerCapture(pointerId)) this.canvas.releasePointerCapture(pointerId);
  }

  private resetTransientInput(): void {
    this.keys.clear();
    this.interactionHeld = false;
    this.setMoveInput(0, 0, false);
    this.releaseLookPointer();
  }

  private updatePlayer(dt: number): void {
    const keyboardForward = (this.keys.has("KeyW") || this.keys.has("ArrowUp") ? 1 : 0) - (this.keys.has("KeyS") || this.keys.has("ArrowDown") ? 1 : 0);
    const keyboardRight = (this.keys.has("KeyD") || this.keys.has("ArrowRight") ? 1 : 0) - (this.keys.has("KeyA") || this.keys.has("ArrowLeft") ? 1 : 0);
    const forwardInput = this.inputEnabled ? Math.max(-1, Math.min(1, keyboardForward + this.mobileForward)) : 0;
    const rightInput = this.inputEnabled ? Math.max(-1, Math.min(1, keyboardRight + this.mobileRight)) : 0;
    const sprinting = this.inputEnabled && (this.keys.has("ShiftLeft") || this.keys.has("ShiftRight") || this.mobileSprint);
    const input = new Vector3(
      Math.sin(this.yaw) * forwardInput + Math.cos(this.yaw) * rightInput,
      0,
      Math.cos(this.yaw) * forwardInput - Math.sin(this.yaw) * rightInput,
    );
    if (input.lengthSquared() > 1) input.normalize();
    const surface = this.simulation.sampleSurface(this.camera.position.x, this.camera.position.z);
    const depthPenalty = Math.min(0.46, surface.depth * (1 - surface.density) * 0.42);
    const speed = (sprinting ? 6.2 : 3.65) * (1 - depthPenalty);
    const target = input.scale(speed);
    const smoothing = 1 - Math.exp(-dt * (input.lengthSquared() > 0 ? 9 : 13));
    this.velocity.x += (target.x - this.velocity.x) * smoothing;
    this.velocity.z += (target.z - this.velocity.z) * smoothing;
    const nextX = Math.max(-30.5, Math.min(30.5, this.camera.position.x + this.velocity.x * dt));
    const nextZ = Math.max(-30.5, Math.min(30.5, this.camera.position.z + this.velocity.z * dt));
    const nextGround = this.simulation.surfaceHeight(nextX, nextZ);
    const currentGround = this.simulation.surfaceHeight(this.camera.position.x, this.camera.position.z);
    if (nextGround - currentGround < 0.82) {
      this.camera.position.x = nextX;
      this.camera.position.z = nextZ;
    } else {
      this.velocity.scaleInPlace(0.3);
    }
    const bob = input.lengthSquared() > 0.01 ? Math.sin(this.elapsed * (sprinting ? 12 : 8.5)) * 0.025 : 0;
    const targetY = this.simulation.surfaceHeight(this.camera.position.x, this.camera.position.z) + 1.68 + bob;
    this.camera.position.y += (targetY - this.camera.position.y) * Math.min(1, dt * 16);

    const planarSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    const stepInterval = sprinting ? 0.31 : 0.48;
    if (planarSpeed > 0.65 && this.elapsed - this.lastStepAt > stepInterval) {
      this.lastStepAt = this.elapsed;
      const side = new Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw)).scale(this.stepSide * 0.12);
      const behind = new Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).scale(0.12);
      const position = this.camera.position.add(side).add(behind);
      this.callbacks.onFootstep(position.x, position.z, this.stepSide, planarSpeed);
      this.stepSide = this.stepSide === -1 ? 1 : -1;
    }
  }

  private updateInteraction(): void {
    if (!this.interactionHeld) return;
    if (performance.now() - this.lastInteractionAt < 82) return;
    this.triggerInteraction();
  }

  private triggerInteraction(): void {
    const hit = this.pickSnow();
    if (!hit) return;
    const distance = Vector3.Distance(this.camera.position, new Vector3(hit.x, hit.y, hit.z));
    if (distance > 7.5) return;
    this.lastInteractionAt = performance.now();
    this.callbacks.onInteract(hit.x, hit.z);
  }

  private updateAim(): void {
    const hit = this.pickSnow();
    const valid = Boolean(hit && Vector3.Distance(this.camera.position, new Vector3(hit.x, hit.y, hit.z)) <= 7.5);
    const x = hit?.x ?? 0;
    const z = hit?.z ?? 0;
    if (valid !== this.lastAim.valid || Math.hypot(x - this.lastAim.x, z - this.lastAim.z) > 0.2) {
      this.lastAim = { x, z, valid };
      this.callbacks.onAimChange(x, z, valid);
    }
  }

  private pickSnow(): { x: number; y: number; z: number } | null {
    const direction = this.camera.getForwardRay().direction;
    const ray = new Ray(this.camera.position.clone(), direction, 9);
    const pick = this.scene.pickWithRay(ray, (mesh) => mesh === this.snowMesh, false);
    if (!pick?.hit || !pick.pickedPoint) return null;
    return { x: pick.pickedPoint.x, y: pick.pickedPoint.y, z: pick.pickedPoint.z };
  }

  private updateWeatherPresentation(): void {
    const cameraPosition = this.camera.position;
    this.snowfall.emitter = new Vector3(cameraPosition.x, cameraPosition.y + 9, cameraPosition.z);
    this.snowfall.emitRate = 120 + this.weather.snowfallRate * 1650;
    const gust = 1 + Math.sin(this.elapsed * 0.73) * this.weather.gustiness * 0.35;
    this.snowfall.gravity.set(this.weather.windX * gust * 0.7, -0.54, this.weather.windZ * gust * 0.7);
    this.scene.fogDensity = 0.0068 + this.weather.snowfallRate * 0.0052;
  }

  private createSnowball(record: SnowballRecord): SnowballVisual {
    const mesh = CreateSphere(`snowball-${this.nextBallId}`, { diameter: 1, segments: 16 }, this.scene);
    const material = new StandardMaterial(`snowball-material-${this.nextBallId}`, this.scene);
    material.diffuseColor = new Color3(0.88 - record.wetness * 0.08, 0.94 - record.wetness * 0.06, 0.98);
    material.specularColor = new Color3(0.16 + record.wetness * 0.25, 0.2 + record.wetness * 0.25, 0.23 + record.wetness * 0.25);
    material.specularPower = 38;
    material.roughness = 0.82 - record.wetness * 0.25;
    mesh.material = material;
    mesh.position.set(record.x, record.y, record.z);
    mesh.receiveShadows = true;
    const ball: SnowballVisual = {
      id: this.nextBallId,
      mesh,
      mass: record.mass,
      density: Math.max(0.16, record.density),
      wetness: record.wetness,
      velocity: new Vector3(),
      held: record.held ?? false,
      placed: false,
      impactCooldown: 0,
    };
    this.nextBallId += 1;
    this.snowballs.push(ball);
    this.updateSnowballScale(ball);
    return ball;
  }

  private ballRadius(ball: SnowballVisual): number {
    const volume = ball.mass / Math.max(0.13, ball.density);
    return Math.max(0.12, Math.min(1.35, Math.cbrt((volume * 3) / (4 * Math.PI))));
  }

  private updateSnowballScale(ball: SnowballVisual): void {
    const radius = this.ballRadius(ball);
    ball.mesh.scaling.setAll(radius * 2);
  }

  private updateSnowballs(dt: number): void {
    for (const ball of [...this.snowballs]) {
      const radius = this.ballRadius(ball);
      ball.impactCooldown = Math.max(0, ball.impactCooldown - dt);
      if (ball.held) {
        const forward = this.camera.getForwardRay().direction;
        const target = this.camera.position.add(forward.scale(1.25 + radius));
        target.y -= 0.18;
        ball.mesh.position = Vector3.Lerp(ball.mesh.position, target, Math.min(1, dt * 18));
        ball.mesh.rotation.y += dt * 0.7;
        continue;
      }
      if (ball.placed) continue;
      if (ball.velocity.lengthSquared() < 0.006) {
        ball.velocity.setAll(0);
        continue;
      }
      ball.velocity.y -= 9.81 * dt;
      ball.mesh.position.addInPlace(ball.velocity.scale(dt));
      ball.mesh.rotation.x += ball.velocity.z * dt / Math.max(radius, 0.1);
      ball.mesh.rotation.z -= ball.velocity.x * dt / Math.max(radius, 0.1);
      const ground = this.simulation.surfaceHeight(ball.mesh.position.x, ball.mesh.position.z) + radius;
      if (ball.mesh.position.y <= ground) {
        ball.mesh.position.y = ground;
        const energy = ball.velocity.lengthSquared() * ball.mass * 0.5;
        if (ball.impactCooldown <= 0 && energy > 0.18) {
          const requested = Math.min(ball.mass * 0.55, energy * 0.018 + ball.mass * (0.08 + (1 - ball.wetness) * 0.16));
          const released = this.callbacks.onBallImpact(ball.mesh.position.x, ball.mesh.position.z, requested, energy);
          ball.mass = Math.max(0, ball.mass - released);
          this.updateSnowballScale(ball);
          this.burstPowder(ball.mesh.position.x, ball.mesh.position.z, released * 2.8);
          ball.impactCooldown = 0.24;
        }
        ball.velocity.y = Math.abs(ball.velocity.y) * (0.12 + ball.wetness * 0.08);
        ball.velocity.x *= 0.72;
        ball.velocity.z *= 0.72;
        if (ball.velocity.lengthSquared() < 0.04) ball.velocity.setAll(0);
      }
      if (ball.mass < 0.002) {
        ball.mesh.dispose();
        this.snowballs.splice(this.snowballs.indexOf(ball), 1);
      }
    }
  }

  private findGrabbableBall(): SnowballVisual | null {
    let best: SnowballVisual | null = null;
    let bestDistance = 2.6;
    for (const ball of this.snowballs) {
      const distance = Vector3.Distance(this.camera.position, ball.mesh.position);
      if (distance < bestDistance) {
        best = ball;
        bestDistance = distance;
      }
    }
    return best;
  }

  private placeOnSurfaceOrBall(ball: SnowballVisual): void {
    const radius = this.ballRadius(ball);
    let baseY = this.simulation.surfaceHeight(ball.mesh.position.x, ball.mesh.position.z) + radius;
    for (const other of this.snowballs) {
      if (other === ball || other.held) continue;
      const otherRadius = this.ballRadius(other);
      const horizontal = Math.hypot(other.mesh.position.x - ball.mesh.position.x, other.mesh.position.z - ball.mesh.position.z);
      if (horizontal < (radius + otherRadius) * 0.62 && other.mesh.position.y + otherRadius <= ball.mesh.position.y + radius * 2.8) {
        const vertical = other.mesh.position.y + otherRadius + radius * 0.92;
        if (vertical > baseY) {
          baseY = vertical;
          ball.mesh.position.x = other.mesh.position.x;
          ball.mesh.position.z = other.mesh.position.z;
        }
      }
    }
    ball.mesh.position.y = baseY;
  }

  private recognizeSnowmen(): void {
    const placed = this.snowballs.filter((ball) => ball.placed && !ball.held);
    for (const head of placed) {
      const stack = placed.filter((ball) => Math.hypot(ball.mesh.position.x - head.mesh.position.x, ball.mesh.position.z - head.mesh.position.z) < 0.45)
        .sort((a, b) => a.mesh.position.y - b.mesh.position.y);
      if (stack.length < 3) continue;
      const top = stack.at(-1)!;
      const key = `${stack[0].id}:${stack[1].id}:${top.id}`;
      if (this.snowmen.has(key)) continue;
      this.snowmen.add(key);
      const root = new TransformNode(`awakened-snowman-${key}`, this.scene);
      root.position.copyFrom(top.mesh.position);
      const eyeMaterial = new StandardMaterial(`coal-${key}`, this.scene);
      eyeMaterial.diffuseColor = new Color3(0.045, 0.06, 0.065);
      eyeMaterial.specularColor = Color3.Black();
      const carrotMaterial = new StandardMaterial(`carrot-${key}`, this.scene);
      carrotMaterial.diffuseColor = new Color3(0.96, 0.28, 0.06);
      const topRadius = this.ballRadius(top);
      for (const side of [-1, 1]) {
        const eye = CreateSphere(`eye-${key}-${side}`, { diameter: topRadius * 0.18, segments: 7 }, this.scene);
        eye.position.set(top.mesh.position.x + side * topRadius * 0.28, top.mesh.position.y + topRadius * 0.22, top.mesh.position.z - topRadius * 0.9);
        eye.material = eyeMaterial;
      }
      const nose = CreateCylinder(`nose-${key}`, { height: topRadius * 0.72, diameterTop: 0, diameterBottom: topRadius * 0.25, tessellation: 8 }, this.scene);
      nose.rotation.x = Math.PI * 0.5;
      nose.position.set(top.mesh.position.x, top.mesh.position.y - topRadius * 0.02, top.mesh.position.z - topRadius * 1.12);
      nose.material = carrotMaterial;
    }
  }
}
