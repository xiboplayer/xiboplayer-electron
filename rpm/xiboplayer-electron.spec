%global debug_package %{nil}

# Electron bundles Chromium which links legacy compat stubs (libc.so,
# libdl.so.2, libpthread.so.0, librt.so.1).  On Fedora 38+ these are
# all merged into glibc / libc.so.6.  Filter them so dnf doesn't pull
# in glibc-devel or fail to resolve.
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

# Bundled components — Fedora Packaging Guidelines §Bundling
Provides:       bundled(electron) = 40

Requires:       gtk3
Requires:       nss
Requires:       alsa-lib
Requires:       mesa-libgbm
Requires:       at-spi2-core
Requires:       libXtst
Requires:       xdg-utils
Recommends:     libva
Recommends:     mesa-dri-drivers

%description
Xibo Player wrapped in Electron for desktop and kiosk digital signage.
Provides a native application with built-in HTTP server, offline support,
system tray integration, and automatic launch via systemd.

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

# Minimal config (copied to ~/.config/xiboplayer/ on first run)
install -Dm644 config.json \
    %{buildroot}%{_datadir}/%{name}/config.json

# Full config reference with all options documented
install -Dm644 config.json.example \
    %{buildroot}%{_docdir}/%{name}/config.json.example

# Documentation
install -Dm644 CONFIG.md \
    %{buildroot}%{_docdir}/%{name}/CONFIG.md
install -Dm644 README.md \
    %{buildroot}%{_docdir}/%{name}/README.md

# Systemd user service
install -Dm644 /dev/stdin %{buildroot}%{_userunitdir}/%{name}.service << 'SERVICE'
[Unit]
Description=Xibo Player - Digital Signage (Electron)
After=graphical-session.target
Wants=graphical-session.target
PartOf=graphical-session.target
Documentation=https://github.com/xibo-players/xiboplayer-electron

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
StartLimitIntervalSec=60
StartLimitBurst=5

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
# Register alternatives (higher priority than Chromium)
alternatives --install %{_bindir}/xiboplayer xiboplayer %{_bindir}/%{name} 60

touch --no-create %{_datadir}/icons/hicolor &>/dev/null || :
gtk-update-icon-cache %{_datadir}/icons/hicolor &>/dev/null || :

%preun
if [ "$1" -eq 0 ]; then
    alternatives --remove xiboplayer %{_bindir}/%{name}
fi

%postun
if [ $1 -eq 0 ] ; then
    touch --no-create %{_datadir}/icons/hicolor &>/dev/null
    gtk-update-icon-cache %{_datadir}/icons/hicolor &>/dev/null || :
fi

%changelog
* Fri Mar 06 2026 Pau Aliagas <linuxnow@gmail.com> - 0.6.5-1
- fix: eliminate XMR WebSocket connection leak, delegate reconnection to framework, add XMR disconnected warning in top bar

* Fri Mar 06 2026 Pau Aliagas <linuxnow@gmail.com> - 0.6.4-1
- Features: cross-device sync, shell commands, per-CMS storage, video controls. Fixes: FD leak, V8 OOM, video duration, timeline overlay. Refactor: canonical /player/api/v2 path, CmsClient interface.

* Thu Mar 05 2026 Pau Aliagas <linuxnow@gmail.com> - 0.6.3-1
- Canvas regions, protocol auto-detect, persistent durations, XIC handlers, download resume, vitest 4 upgrade

* Wed Mar 04 2026 Pau Aliagas <linuxnow@gmail.com> - 0.6.2-1
- fix: expire current layout when schedule changes, fix: multi-widget playlist cycling, fix: layout background fallback for storedAs filenames, refactor: single source of truth for layout duration calculation

* Tue Mar 03 2026 Pau Aliagas <linuxnow@gmail.com> - 0.6.1-1
- feat: switch default clientType from chromeOS to linux, fix: keyboard shortcuts on Wayland and quit for Chromium kiosk, fix: replace globalShortcut with Menu accelerators for Wayland (Electron), refactor: use shared packaging library for build scripts, fix: remove per-build repo update trigger race conditions

* Mon Mar 02 2026 Pau Aliagas <linuxnow@gmail.com> - 0.6.0-1
- REST v2 transport with auto-detection, chunked download resume, shared config extraction (extractPwaConfig), cert warning overlay fix, download overlay fix

* Sun Mar 01 2026 Pau Aliagas <linuxnow@gmail.com> - 0.5.20-1
- Fix memory leaks: PDF single-canvas rendering with page.cleanup(), event listener cleanup on widget hide, HLS instance destroy, blob URL tracking

* Sat Feb 28 2026 Pau Aliagas <linuxnow@gmail.com> - 0.5.19-1
- PDF multi-page cycling, SSL cert relaxation (relaxSslCerts), configurable log levels, config passthrough fixes

* Sat Feb 28 2026 Pau Aliagas <linuxnow@gmail.com> - 0.5.18-1
- Fix proxy crash, improve kill patterns, forward proxy logs to DevTools

* Sat Feb 28 2026 Pau Aliagas <linuxnow@gmail.com> - 0.5.17-1
- Decouple Electron from SDK monorepo, fix cache clearing

* Fri Feb 27 2026 Pau Aliagas <linuxnow@gmail.com> - 0.5.16-3
- Add system default config.json for first-run copy to user config directory
- Install full config reference (config.json.example) and docs to /usr/share/doc
- Add optional Google Geolocation API key support (googleGeoApiKey)
- Add config.json controls for keyboard shortcuts and mouse hover
- Add transport config option (auto/xmds) for unpatched Xibo CMS
