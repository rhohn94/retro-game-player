// Typed wrappers for the `health` domain (W1 stub). Establishes the per-domain
// wrapper-module pattern every later item follows: one module per backend
// domain, each thin function calling `invoke` with the command name + args.

import { invoke } from "./invoke";

/** Round-trips a liveness check through the backend; returns its reply string. */
export function ping(): Promise<string> {
  return invoke<string>("ping");
}
