app    := "Harmony"
target := "aarch64-apple-darwin"
bundle := "src-tauri/target/" + target + "/release/bundle/macos/" + app + ".app"
deploy-root := env_var('HOME') / "Projects/deployed-apps/harmony"

# Build production bundle (aarch64 macOS)
build:
    pnpm tauri build --target {{target}}

# Run in development mode (hot-reload)
run:
    pnpm tauri dev

# Build, install to deployed-apps, and launch
deploy: build
    #!/usr/bin/env bash
    set -euo pipefail
    version=$(python3 -c "import json; print(json.load(open('src-tauri/tauri.conf.json'))['version'])")
    dest="{{deploy-root}}/versions/v${version}"
    mkdir -p "$dest"
    rm -rf "$dest/{{app}}.app"
    cp -R "{{bundle}}" "$dest/"
    ln -sfn "versions/v${version}" "{{deploy-root}}/current"
    echo "Deployed {{app}} v${version} → ${dest}"
    open "${dest}/{{app}}.app"
