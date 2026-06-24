// Typed wrappers + DTOs for the `fleet` domain (W11). Mirrors the Rust
// FleetStatus contract (architecture-design.md §2.7). The Rust side serializes
// snake_case; Tauri's invoke returns those keys verbatim, so the DTO uses
// camelCase aliases via explicit field mapping is NOT applied here — the wire
// shape is snake_case. We therefore model the wire shape and expose it as-is.

import { invoke } from "./invoke";

/** Overall instance health, mirroring the Rust `FleetHealth` union. */
export type FleetHealth = "ok" | "degraded";

/** A declared dependency edge (RetroArch, a libretro core, …). */
export interface DependencyEdge {
  name: string;
  present: boolean;
}

/**
 * Live fleet status payload. `schema_version` is an INTEGER (`1`) per the Fleet
 * Status Contract v1 — never a string. Field names are the snake_case wire form
 * the Rust `FleetStatus` serializes.
 */
export interface FleetStatus {
  schema_version: number;
  instance_id: string;
  version: string;
  status: FleetHealth;
  uptime_seconds: number;
  dependencies: DependencyEdge[];
}

/** Fetch the current fleet status for this instance. */
export function getFleetStatus(): Promise<FleetStatus> {
  return invoke<FleetStatus>("get_fleet_status");
}
