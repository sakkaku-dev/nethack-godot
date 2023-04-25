## Nethack port for Web

Nethack for the web using godot as the UI.

### Build


Build NetHack for WASM by following steps in `Cross-compiling`.
Emscripten should be installed. I needed the patch in `lib/fixes.diff`.
Current build is from `db90e7907` and using emscripten v2.0.34

`tile.c` has to be generated using `tilemap.c`:

- compile: `gcc tilemap.c -I ../../include -o ../tilemap.o`
- run: `../tilemap.o`

Build nethack

- `pushd sys/unix && ./setup.sh hints/linux.370 && popd`
- `make fetch-lua`
- `make CROSS_TO_WASM=1`
- replace the export in `nethack.js` with `export default Module`

### Deploy

Godot needs specific headers from the web server

Apache:

```
Header set Cross-Origin-Opener-Policy "same-origin"
Header set Cross-Origin-Embedder-Policy "require-corp"
```
