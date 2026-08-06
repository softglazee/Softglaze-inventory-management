Product and branding images live here at runtime (the server writes uploads into
this folder; UPLOAD_DIR in .env points at it).

This folder is bundled into the desktop build by apps/desktop/electron-builder.cjs
and restored into %APPDATA%/@softglaze/desktop/uploads on launch.

  - Generic product build: leave this folder empty (only this file). New shops
    upload their own images.
  - Client / data-preloaded build: copy the shop's uploads/ contents here BEFORE
    running `npm run dist -w apps/desktop`, so the photos referenced by
    apps/server/dist/initial-data.sql actually ship with the installer.

The images themselves are intentionally not committed (see .gitignore).
