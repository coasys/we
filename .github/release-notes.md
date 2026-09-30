Desktop build of WE for Linux (x64 AppImage). The ad4m executor is bundled, so there is nothing else to install. macOS builds are paused until the ad4m executor can be compiled there again.

### Requirements

**Ubuntu 24.04, Linux Mint 22, or newer.** The bundled executor needs glibc 2.39, so it will not start on Ubuntu 22.04 (glibc 2.35) or Debian 12 (2.36). Check yours with `ldd --version`.

### Running it

    chmod +x WE-*-linux-x86_64.AppImage
    ./WE-*-linux-x86_64.AppImage --appimage-extract-and-run

`--appimage-extract-and-run` avoids needing FUSE 2, which 24.04-era distributions do not install.

Do **not** run `apt install fuse` to get FUSE 2. On Linux Mint it removes the Cinnamon desktop, Flatpak and the desktop portals. If you want the AppImage to run without the flag, install `libfuse2t64` instead.
