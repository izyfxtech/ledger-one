# App icons

Generate real icons before your first `tauri build`:

```bash
pnpm dlx @tauri-apps/cli icon path/to/source.png
```

This will populate `32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.png`,
`icon.icns` (macOS) and `icon.ico` (Windows) referenced from
`../tauri.conf.json`.
