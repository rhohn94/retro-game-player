// ControllersPane — stub placeholder (the binding editor is W14).

export function ControllersPane() {
  return (
    <div className="settings-pane" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h3 style={{ margin: 0 }}>Controller Bindings</h3>
      <p style={{ color: "var(--aura-on-surface-muted)", margin: 0, fontSize: 13 }}>
        Controller binding editor — implemented by W14 (controller-input-design.md).
        This pane will host the binding table once the spatial-nav layer ships.
      </p>
    </div>
  );
}
