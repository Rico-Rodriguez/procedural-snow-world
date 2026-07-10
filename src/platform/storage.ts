import type { SnowSnapshot } from "../simulation/snow-simulation";

export interface WorldSave {
  id: string;
  name: string;
  seedText: string;
  savedAt: number;
  playTimeSeconds: number;
  player: { x: number; z: number; yaw: number };
  weather: { snowfallRate: number; airTemperature: number; windX: number; windZ: number; gustiness: number };
  snowballs: Array<{ x: number; y: number; z: number; mass: number; density: number; wetness: number }>;
  snapshot: SnowSnapshot;
}

const DATABASE_NAME = "siltlands-snow-laboratory";
const STORE_NAME = "world-saves";
const DATABASE_VERSION = 1;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open snow-world storage."));
  });
}

export async function saveWorld(save: WorldSave): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(save);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Could not save world."));
    transaction.onabort = () => reject(transaction.error ?? new Error("World save was aborted."));
  });
  database.close();
}

export async function loadWorld(id = "autosave"): Promise<WorldSave | null> {
  const database = await openDatabase();
  const result = await new Promise<WorldSave | null>((resolve, reject) => {
    const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(id);
    request.onsuccess = () => resolve((request.result as WorldSave | undefined) ?? null);
    request.onerror = () => reject(request.error ?? new Error("Could not load world."));
  });
  database.close();
  return result;
}

export async function hasSavedWorld(id = "autosave"): Promise<boolean> {
  const database = await openDatabase();
  const result = await new Promise<boolean>((resolve, reject) => {
    const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).count(id);
    request.onsuccess = () => resolve(request.result > 0);
    request.onerror = () => reject(request.error ?? new Error("Could not inspect world saves."));
  });
  database.close();
  return result;
}
