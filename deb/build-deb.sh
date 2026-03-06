#!/bin/bash
# Build xiboplayer-electron DEB from pre-built Electron app
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ELECTRON_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
source "${PKG_LIB_DEB:-${SCRIPT_DIR}/scripts/packaging/lib-deb.sh}"

# ── Configuration ─────────────────────────────────────────────────────
PKG_NAME="xiboplayer-electron"
PKG_DEPENDS="libgtk-3-0, libnss3, libasound2, libgbm1, libatspi2.0-0, libxtst6, xdg-utils"
PKG_CONFLICTS="xiboplayer-pwa"
PKG_DESCRIPTION="Xibo digital signage player (Electron)"
PKG_DESCRIPTION_LONG=" Xibo Player wrapped in Electron for desktop and kiosk digital signage.
 Provides a native application with built-in HTTP server, offline support,
 system tray integration, and automatic launch via systemd."
PKG_SRC_BUILD_DEPENDS="debhelper (>= 12), nodejs, npm"

DIST_DIR="$ELECTRON_DIR/dist-packages"

# ── Architecture & build artifact detection ───────────────────────────
pkg_detect_arch
pkg_parse_version "$@"

if [ -d "$ELECTRON_DIR/dist-packages/linux-unpacked" ]; then
    LINUX_UNPACKED="linux-unpacked"
elif [ -d "$ELECTRON_DIR/dist-packages/linux-${ELECTRON_ARCH}-unpacked" ]; then
    LINUX_UNPACKED="linux-${ELECTRON_ARCH}-unpacked"
else
    echo "ERROR: Build artifacts not found!"
    echo "       Expected: dist-packages/linux-unpacked/ or dist-packages/linux-${ELECTRON_ARCH}-unpacked/"
    echo "       Run 'pnpm run build:linux' first"
    exit 1
fi
echo "==> Using build artifacts from: $LINUX_UNPACKED"

# ── Create package tree ───────────────────────────────────────────────
BUILD_ROOT="$ELECTRON_DIR/deb-pkg"
pkg_create_deb_tree
mkdir -p "$PKGDIR/usr/lib/xiboplayer"

echo "==> Installing files..."

# Copy Electron app bundle
cp -a "$ELECTRON_DIR/dist-packages/$LINUX_UNPACKED/"* "$PKGDIR/usr/lib/xiboplayer/"

# Wrapper script
cat > "$PKGDIR/usr/bin/xiboplayer" << 'WRAPPER'
#!/bin/bash
# Xibo Player (Electron) — launcher
exec /usr/lib/xiboplayer/xiboplayer "$@"
WRAPPER
chmod 755 "$PKGDIR/usr/bin/xiboplayer"

# Desktop entry
cat > "$PKGDIR/usr/share/applications/xiboplayer.desktop" << 'DESKTOP'
[Desktop Entry]
Name=Xibo Player
Comment=Digital Signage Player for Xibo CMS
Exec=xiboplayer
Icon=xiboplayer
Terminal=false
Type=Application
Categories=AudioVideo;Player;
Keywords=signage;digital;kiosk;xibo;
StartupWMClass=xiboplayer
DESKTOP

# Config and docs
mkdir -p "$PKGDIR/usr/share/$PKG_NAME"
install -m644 "$ELECTRON_DIR/config.json" "$PKGDIR/usr/share/$PKG_NAME/config.json"
cp "$ELECTRON_DIR/config.json.example" "$PKGDIR/usr/share/doc/$PKG_NAME/"
cp "$ELECTRON_DIR/CONFIG.md" "$PKGDIR/usr/share/doc/$PKG_NAME/"
cp "$ELECTRON_DIR/README.md" "$PKGDIR/usr/share/doc/$PKG_NAME/"

# Icon
if [ -f "$PKGDIR/usr/lib/xiboplayer/resources/app.asar.unpacked/resources/pwa/favicon.png" ]; then
    cp "$PKGDIR/usr/lib/xiboplayer/resources/app.asar.unpacked/resources/pwa/favicon.png" \
       "$PKGDIR/usr/share/icons/hicolor/256x256/apps/xiboplayer.png"
else
    echo "Warning: Icon not found in unpacked resources, skipping"
fi

# Systemd user service
cat > "$PKGDIR/usr/lib/systemd/user/xiboplayer.service" << 'SERVICE'
[Unit]
Description=Xibo Player - Digital Signage (Electron)
After=graphical-session.target
Wants=graphical-session.target
PartOf=graphical-session.target
Documentation=https://github.com/xibo-players/xiboplayer-electron

[Service]
Type=simple
ExecStart=/usr/bin/xiboplayer --no-sandbox
Restart=always
RestartSec=10
Environment=NODE_ENV=production
TimeoutStopSec=10
KillMode=mixed
KillSignal=SIGTERM
StandardOutput=journal
StandardError=journal
SyslogIdentifier=xiboplayer

[Install]
WantedBy=graphical-session.target
SERVICE

# ── Package ───────────────────────────────────────────────────────────
pkg_write_control
pkg_build_binary_deb
pkg_show_result_deb

# ── Source package ────────────────────────────────────────────────────
populate_electron_source() {
    local orig_dir="$1"
    tar czf "$orig_dir/../${PKG_NAME}_${VERSION}.orig.tar.gz" \
        -C "$ELECTRON_DIR" \
        --exclude=dist-packages --exclude=deb-pkg --exclude=deb-src \
        --exclude=deb/_srcbuild --exclude=node_modules --exclude=.git \
        --transform="s|^\.|${PKG_NAME}-${VERSION}|" .
    # Extract into orig_dir for dpkg-source
    cd "$orig_dir/.."
    rm -rf "$orig_dir"
    tar xf "${PKG_NAME}_${VERSION}.orig.tar.gz"
}

PKG_ARCH="any"
pkg_build_source_deb populate_electron_source any
