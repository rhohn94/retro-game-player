/**
 * Phase 4 SERP health memory — track consecutive unhealthy outcomes per
 * provider and soft-skip flaky sources on later searches until they succeed
 * again (or the user resumes them).
 *
 * Uses localStorage when available; falls back to an in-memory map (tests /
 * private mode). Empty results alone do not count as unhealthy (a niche title
 * can legitimately return nothing); captcha / JS-shell / error do.
 */

import type { ProviderResults, SerpHealth } from "../../ipc/search";
import { providerHealth } from "./providerHealth";

const MEMORY_KEY = "rgp.search.providerHealthMemory";
/** Soft-skip after this many consecutive hard failures. */
export const HEALTH_FAIL_THRESHOLD = 3;

export interface ProviderHealthRecord {
  /** Consecutive captcha / js_shell / error outcomes. */
  failStreak: number;
  /** Last recorded health label. */
  lastHealth: string;
  /** Epoch ms of last update. */
  updatedAt: number;
  /** User explicitly resumed — stays until next hard failure. */
  resumed?: boolean;
}

export type HealthMemoryMap = Record<string, ProviderHealthRecord>;

/** In-memory store used when localStorage is missing (node tests). */
let memoryFallback: HealthMemoryMap = {};

function isHardFailure(health: SerpHealth | string): boolean {
  return health === "captcha" || health === "js_shell" || health === "error";
}

function storageAvailable(): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage !== null;
  } catch {
    return false;
  }
}

export function loadHealthMemory(): HealthMemoryMap {
  if (!storageAvailable()) {
    return { ...memoryFallback };
  }
  try {
    const raw = localStorage.getItem(MEMORY_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as HealthMemoryMap;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return { ...memoryFallback };
  }
}

export function saveHealthMemory(map: HealthMemoryMap): void {
  memoryFallback = { ...map };
  if (!storageAvailable()) return;
  try {
    localStorage.setItem(MEMORY_KEY, JSON.stringify(map));
  } catch {
    // ignore quota / private mode
  }
}

/** Provider ids currently soft-skipped (streak ≥ threshold, not resumed). */
export function listSoftSkippedProviderIds(map: HealthMemoryMap = loadHealthMemory()): number[] {
  const out: number[] = [];
  for (const [id, rec] of Object.entries(map)) {
    if (rec.resumed) continue;
    if (rec.failStreak >= HEALTH_FAIL_THRESHOLD) {
      const n = Number(id);
      if (Number.isFinite(n)) out.push(n);
    }
  }
  return out;
}

export function isSoftSkipped(
  providerId: number,
  map: HealthMemoryMap = loadHealthMemory()
): boolean {
  const rec = map[String(providerId)];
  if (!rec || rec.resumed) return false;
  return rec.failStreak >= HEALTH_FAIL_THRESHOLD;
}

/** Mark a provider as usable again until the next hard failure. */
export function resumeProvider(providerId: number): HealthMemoryMap {
  const map = loadHealthMemory();
  const key = String(providerId);
  const prev = map[key];
  map[key] = {
    failStreak: 0,
    lastHealth: prev?.lastHealth ?? "ok",
    updatedAt: Date.now(),
    resumed: true,
  };
  saveHealthMemory(map);
  return map;
}

/** Clear all health memory (testing / power-user reset). */
export function clearHealthMemory(): void {
  memoryFallback = {};
  if (!storageAvailable()) return;
  try {
    localStorage.removeItem(MEMORY_KEY);
  } catch {
    // ignore
  }
}

/**
 * Fold a search's provider groups into memory. Hard failures increment the
 * streak; ok/empty resets it. Returns the updated map.
 */
export function recordSearchHealth(groups: ProviderResults[]): HealthMemoryMap {
  const map = loadHealthMemory();
  const now = Date.now();
  for (const g of groups) {
    const health = providerHealth(g);
    const key = String(g.providerId);
    const prev = map[key];
    if (isHardFailure(health)) {
      const streak = (prev?.resumed ? 0 : prev?.failStreak ?? 0) + 1;
      map[key] = {
        failStreak: streak,
        lastHealth: health,
        updatedAt: now,
        resumed: false,
      };
    } else {
      // Success or empty SERP — clear streak.
      map[key] = {
        failStreak: 0,
        lastHealth: health,
        updatedAt: now,
        resumed: false,
      };
    }
  }
  saveHealthMemory(map);
  return map;
}
