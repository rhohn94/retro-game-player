// AuraApp shell root. W2 wraps this in the AuraProvider + router (master
// contract §1.1); for W1 it proves the end-to-end IPC round-trip by calling
// `ping` and rendering the reply.
//
// The top strip carries `data-tauri-drag-region` so the frameless window
// (titleBarStyle "Overlay" + hiddenTitle, D2 §1/§5) can be dragged. Interactive
// children must NOT inherit the drag region — keep controls off the strip.
import { useEffect, useState } from "react";
import { isAppError, ping } from "./ipc/commands";

// Left inset reserves room for the native traffic-light controls so the top bar
// content never renders under them (D2 §5: ~78x28pt controls → 72-80px inset).
const TRAFFIC_LIGHT_INSET_PX = 80;
const DRAG_STRIP_HEIGHT_PX = 36;

function App() {
  const [pong, setPong] = useState<string>("…");

  useEffect(() => {
    let cancelled = false;
    ping()
      .then((reply) => {
        if (!cancelled) setPong(reply);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const detail = isAppError(err) ? err.detail : String(err);
        setPong(`ping failed: ${detail}`);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <div
        data-tauri-drag-region
        style={{
          height: DRAG_STRIP_HEIGHT_PX,
          paddingLeft: TRAFFIC_LIGHT_INSET_PX,
          width: "100%",
        }}
      />
      <main style={{ padding: 24 }}>
        <h1>Harmony</h1>
        <p>IPC round-trip: {pong}</p>
      </main>
    </div>
  );
}

export default App;
