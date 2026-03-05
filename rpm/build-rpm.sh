#!/bin/bash
# Build xiboplayer-electron RPM from pre-built Electron app
set -e

SPEC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ELECTRON_DIR="$(cd "$SPEC_DIR/.." && pwd)"
SCRIPT_DIR="$SPEC_DIR"
source "${PKG_LIB_RPM:-${SPEC_DIR}/scripts/packaging/lib-rpm.sh}"

PKG_NAME="xiboplayer-electron"
VERSION="${1:-0.6.4}"
DIST_DIR="$ELECTRON_DIR/dist-packages"

echo "==> Building $PKG_NAME RPM v$VERSION"

# ── Detect architecture and build artifacts ───────────────────────────
case "$(uname -m)" in
    x86_64)  ELECTRON_ARCH="x64" ;;
    aarch64) ELECTRON_ARCH="arm64" ;;
    *)       echo "ERROR: Unsupported architecture: $(uname -m)"; exit 1 ;;
esac

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

# ── Create RPM build tree ────────────────────────────────────────────
mkdir -p ~/rpmbuild/{SOURCES,SPECS,BUILD,RPMS,SRPMS}

echo "==> Creating source tarball..."
TARBALL="$HOME/rpmbuild/SOURCES/$PKG_NAME-$VERSION-linux-unpacked.tar.gz"

# Copy icon, config, and docs into build artifacts for the tarball
cp "$ELECTRON_DIR/resources/icon.png" "$ELECTRON_DIR/dist-packages/$LINUX_UNPACKED/icon.png"
cp "$ELECTRON_DIR/config.json" "$ELECTRON_DIR/dist-packages/$LINUX_UNPACKED/"
cp "$ELECTRON_DIR/config.json.example" "$ELECTRON_DIR/dist-packages/$LINUX_UNPACKED/"
cp "$ELECTRON_DIR/CONFIG.md" "$ELECTRON_DIR/dist-packages/$LINUX_UNPACKED/"
cp "$ELECTRON_DIR/README.md" "$ELECTRON_DIR/dist-packages/$LINUX_UNPACKED/"

if [ "$LINUX_UNPACKED" = "linux-unpacked" ]; then
    tar czf "$TARBALL" -C "$ELECTRON_DIR/dist-packages" linux-unpacked
else
    tar czf "$TARBALL" -C "$ELECTRON_DIR/dist-packages" --transform="s|$LINUX_UNPACKED|linux-unpacked|" "$LINUX_UNPACKED"
fi
echo "    $TARBALL ($(du -h "$TARBALL" | cut -f1))"

# ── Build RPM ─────────────────────────────────────────────────────────
cp "$SPEC_DIR/xiboplayer-electron.spec" ~/rpmbuild/SPECS/
echo "==> Running rpmbuild..."
rpmbuild -ba ~/rpmbuild/SPECS/xiboplayer-electron.spec \
    --define "_version $VERSION"

# ── Collect and display results ───────────────────────────────────────
pkg_collect_rpms ~/rpmbuild
pkg_show_result_rpm
