%global debug_package %{nil}

# Electron bundles Chromium which links legacy compat stubs.
# On EL9 some of these are merged into glibc / libc.so.6.
# Filter them so dnf doesn't pull in glibc-devel or fail to resolve.
# Also filter the bundled libffmpeg.so (shipped inside the Electron tree).
%global __requires_exclude ^(libc\\.so\\(\\)|libdl\\.so\\.2|libpthread\\.so\\.0|librt\\.so\\.1|libffmpeg\\.so)

Name:           xiboplayer-electron
Version:        %{_version}
Release:        1%{?dist}
Summary:        Xibo digital signage player (Electron)

License:        AGPL-3.0-or-later
URL:            https://xiboplayer.org
Source0:        %{name}-%{version}-linux-unpacked.tar.gz

ExclusiveArch:  x86_64 aarch64
BuildRequires:  systemd-rpm-macros

# Bundled components
Provides:       bundled(electron) = 40

# Rocky Linux / EL9 dependency names
Requires:       gtk3
Requires:       nss
Requires:       alsa-lib
Requires:       mesa-libgbm
Requires:       at-spi2-atk
Requires:       libXtst
Requires:       libxkbcommon
Requires:       libdrm
Requires:       xdg-utils
Requires:       dbus-libs
Requires:       libXScrnSaver
Requires:       libXrandr
Requires:       libXcomposite
Requires:       libXdamage
Requires:       libXfixes
Requires:       cups-libs
Requires:       pango
Requires:       cairo
Recommends:     libva
Recommends:     mesa-dri-drivers
Recommends:     liberation-fonts

%description
Xibo Player wrapped in Electron for desktop and kiosk digital signage.
Provides a native application with built-in HTTP server, offline support,
system tray integration, and automatic launch via systemd.

Compatible with Rocky Linux 9 / RHEL 9 / AlmaLinux 9.

%prep
%setup -q -n linux-unpacked

%build
# Pre-built Electron binary — nothing to compile

%install
# Electron app bundle
install -dm755 %{buildroot}%{_libdir}/%{name}
cp -a * %{buildroot}%{_libdir}/%{name}/

# Wrapper script
install -Dm755 /dev/stdin %{buildroot}%{_bindir}/%{name} << 'WRAPPER'
#!/bin/bash
exec %{_libdir}/xiboplayer-electron/xiboplayer "$@"
WRAPPER

# Desktop entry
install -Dm644 /dev/stdin %{buildroot}%{_datadir}/applications/%{name}.desktop << 'DESKTOP'
[Desktop Entry]
Name=XiboPlayer Electron
Comment=Digital Signage Player for Xibo CMS (Electron)
Exec=xiboplayer-electron
Icon=xiboplayer
Terminal=false
Type=Application
Categories=Utility;
Keywords=signage;digital;kiosk;xibo;
StartupWMClass=xiboplayer
DESKTOP

# Icon
install -Dm644 %{buildroot}%{_libdir}/%{name}/resources/app.asar.unpacked/resources/pwa/favicon.png \
    %{buildroot}%{_datadir}/icons/hicolor/256x256/apps/xiboplayer.png 2>/dev/null || \
    echo "Icon not found in unpacked resources, skipping"

# Default config
install -Dm644 config.json \
    %{buildroot}%{_datadir}/%{name}/config.json

# Config reference
install -Dm644 config.json.example \
    %{buildroot}%{_docdir}/%{name}/config.json.example

# Documentation
install -Dm644 CONFIG.md \
    %{buildroot}%{_docdir}/%{name}/CONFIG.md
install -Dm644 README.md \
    %{buildroot}%{_docdir}/%{name}/README.md

# Config management scripts and templates
install -Dm755 configs/apply.sh \
    %{buildroot}%{_datadir}/%{name}/configs/apply.sh
install -Dm755 configs/clean.sh \
    %{buildroot}%{_datadir}/%{name}/configs/clean.sh
install -Dm644 configs/secrets.env.example \
    %{buildroot}%{_datadir}/%{name}/configs/secrets.env.example
for tmpl in configs/electron-*.json; do
    install -Dm644 "$tmpl" \
        %{buildroot}%{_datadir}/%{name}/configs/$(basename "$tmpl")
done

# Systemd user service
install -Dm644 /dev/stdin %{buildroot}%{_userunitdir}/%{name}.service << 'SERVICE'
[Unit]
Description=Xibo Player - Digital Signage (Electron)
After=graphical-session.target
Wants=graphical-session.target
PartOf=graphical-session.target
Documentation=https://github.com/xibo-players/xiboplayer-electron
StartLimitIntervalSec=60
StartLimitBurst=5

[Service]
Type=simple
ExecStart=%{_bindir}/xiboplayer-electron --no-sandbox
Restart=always
RestartSec=5
Environment=NODE_ENV=production
TimeoutStopSec=15
TimeoutStopFailureMode=terminate
KillMode=mixed
KillSignal=SIGTERM
FinalKillSignal=SIGKILL
LimitCORE=0
StandardOutput=journal
StandardError=journal
SyslogIdentifier=xiboplayer-electron

[Install]
WantedBy=graphical-session.target
SERVICE

%files
%{_bindir}/%{name}
%{_libdir}/%{name}/
%{_datadir}/%{name}/
%{_docdir}/%{name}/
%{_datadir}/applications/%{name}.desktop
%{_userunitdir}/%{name}.service

%post
# Register alternatives (EL9 uses chkconfig for alternatives)
alternatives --install %{_bindir}/xiboplayer xiboplayer %{_bindir}/%{name} 60 2>/dev/null || \
    /usr/sbin/update-alternatives --install %{_bindir}/xiboplayer xiboplayer %{_bindir}/%{name} 60 2>/dev/null || true

touch --no-create %{_datadir}/icons/hicolor &>/dev/null || :
gtk-update-icon-cache %{_datadir}/icons/hicolor &>/dev/null || :

%preun
if [ "$1" -eq 0 ]; then
    alternatives --remove xiboplayer %{_bindir}/%{name} 2>/dev/null || \
        /usr/sbin/update-alternatives --remove xiboplayer %{_bindir}/%{name} 2>/dev/null || true
fi

%postun
if [ $1 -eq 0 ] ; then
    touch --no-create %{_datadir}/icons/hicolor &>/dev/null
    gtk-update-icon-cache %{_datadir}/icons/hicolor &>/dev/null || :
fi

%changelog
* Tue Apr 01 2026 Pau Aliagas <linuxnow@gmail.com> - 0.7.10-1
- Initial Rocky Linux / EL9 package
- Adjusted dependencies for EL9 (at-spi2-atk, libxkbcommon, libdrm, etc.)
