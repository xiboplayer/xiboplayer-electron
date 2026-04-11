%global debug_package %{nil}
%global _electron_dir /opt/XiboPlayer

Name:           xibo-player
Version:        0.1.0
Release:        1%{?dist}
Summary:        Electron-based digital signage player for Xibo CMS

License:        AGPL-3.0-or-later
URL:            https://github.com/xibo/xibo-players
Source0:        %{name}-%{version}-linux-x64.tar.gz

Requires:       gtk3
Requires:       libnotify
Requires:       nss
Requires:       libXScrnSaver
Requires:       libXtst
Requires:       xdg-utils
Requires:       at-spi2-core
Requires:       libuuid
Requires:       mesa-dri-drivers
Requires:       mesa-libgbm
Requires:       alsa-lib
Requires:       libva
Recommends:     libva-nvidia-driver
Recommends:     libva-intel-media-driver
Recommends:     libva-utils

%description
Xibo Player is an Electron-based digital signage player that provides
a full-featured kiosk mode experience for Xibo CMS. It wraps the PWA
player in a native Electron application with system integration,
offline support, and automatic launch capabilities.

Features:
- Fullscreen kiosk mode with navigation protection
- Built-in HTTP server (no external web server needed)
- CORS-enabled for proper XMDS communication
- Auto-start on boot via systemd user service
- System tray menu for configuration
- Persistent configuration storage

%prep
%setup -q -n %{name}-%{version}-linux-x64

%build
# Pre-built binary, nothing to build

%install
# Install Electron app directory
install -dm755 %{buildroot}%{_electron_dir}
cp -a * %{buildroot}%{_electron_dir}/

# Create launcher script
install -Dm755 /dev/stdin %{buildroot}%{_bindir}/xibo-player << 'EOF'
#!/bin/bash
# Xibo Player launcher script
cd %{_electron_dir}
exec ./xibo-player "$@"
EOF

# Install desktop file
install -Dm644 /dev/stdin %{buildroot}%{_datadir}/applications/xibo-player.desktop << 'EOF'
[Desktop Entry]
Name=Xibo Player
Comment=Digital Signage Player for Xibo CMS
Exec=xibo-player
Icon=xibo-player
Terminal=false
Type=Application
Categories=AudioVideo;Player;
Keywords=digital-signage;xibo;kiosk;
StartupWMClass=XiboPlayer
EOF

# Icon will be added in a future version
# For now, skip icon installation
# install -dm755 %{buildroot}%{_datadir}/icons/hicolor/512x512/apps

# Install systemd user service
install -Dm644 /dev/stdin %{buildroot}%{_userunitdir}/xibo-player.service << 'EOF'
[Unit]
Description=Xibo Player - Digital Signage
After=graphical.target
Documentation=https://github.com/xibo/xibo-players

[Service]
Type=simple
ExecStart=%{_bindir}/xibo-player --no-sandbox
Restart=always
RestartSec=10

# Environment
Environment=DISPLAY=:0
Environment=NODE_ENV=production

# Hardening
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=graphical.target
EOF

# Validate desktop file
desktop-file-validate %{buildroot}%{_datadir}/applications/xibo-player.desktop

%files
%{_bindir}/xibo-player
%{_electron_dir}
%{_datadir}/applications/xibo-player.desktop
%{_userunitdir}/xibo-player.service

%post
# Update icon cache
touch --no-create %{_datadir}/icons/hicolor &>/dev/null || :

%postun
if [ $1 -eq 0 ] ; then
    touch --no-create %{_datadir}/icons/hicolor &>/dev/null
    gtk-update-icon-cache %{_datadir}/icons/hicolor &>/dev/null || :
fi

%posttrans
gtk-update-icon-cache %{_datadir}/icons/hicolor &>/dev/null || :

%changelog
* Tue Jan 27 2026 Pau Aliagas <linuxnow@gmail.com> - 0.9.0-1
- Initial RPM package
- Electron wrapper for PWA player
- Systemd user service for auto-start
- Full kiosk mode support
- CORS-enabled local HTTP server
