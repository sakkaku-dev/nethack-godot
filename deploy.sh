#!/bin/sh

# npm run setup:nethack
# npm run build:nethack
# npm run copy:nethack
# npm run fix:nethack

# npm run build:godot
# npm run build:web
# npx rollup -c rollup.config.js

sudo mkdir -p /srv/http/nethack
sudo cp build/* /srv/http/nethack