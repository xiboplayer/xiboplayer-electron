#!/bin/bash
#
# Post-remove script for xiboplayer
# This script runs after the package is removed
#

set -e

USER_HOME="$HOME"
SYSTEMD_USER_DIR="$USER_HOME/.config/systemd/user"
SERVICE_FILE="$SYSTEMD_USER_DIR/xibo-player.service"

echo "xiboplayer post-removal script"

# Stop and disable service if running
if [ -f "$SERVICE_FILE" ]; then
    if [ -n "$DBUS_SESSION_BUS_ADDRESS" ]; then
        echo "Stopping and disabling xibo-player service"
        systemctl --user stop xibo-player.service 2>/dev/null || true
        systemctl --user disable xibo-player.service 2>/dev/null || true
    fi

    echo "Removing systemd service file"
    rm -f "$SERVICE_FILE"

    if [ -n "$DBUS_SESSION_BUS_ADDRESS" ]; then
        systemctl --user daemon-reload || true
    fi
fi

# Remove desktop entry
DESKTOP_FILE="$USER_HOME/.local/share/applications/xibo-player.desktop"
if [ -f "$DESKTOP_FILE" ]; then
    echo "Removing desktop entry"
    rm -f "$DESKTOP_FILE"

    # Update desktop database
    if command -v update-desktop-database > /dev/null 2>&1; then
        update-desktop-database "$USER_HOME/.local/share/applications" || true
    fi
fi

echo ""
echo "xiboplayer has been removed."
echo ""
echo "Note: Configuration files in ~/.config/xibo-player/ were preserved."
echo "To remove them manually, run:"
echo "  rm -rf ~/.config/xibo-player"
echo ""

exit 0
