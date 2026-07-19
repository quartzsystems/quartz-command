# Built by scripts/build-rpm.sh from a pre-staged install tree; it passes
# qc_version and qc_staging via --define. The binaries are prebuilt, so
# debuginfo extraction and build-id links are disabled.
%global debug_package %{nil}
%global _build_id_links none
%global __brp_check_rpaths %{nil}

Name:           quartz-command
Version:        %{qc_version}
Release:        1%{?dist}
Summary:        Quartz Command cloud console (backend API and web frontend)
License:        GPL-2.0-or-later
URL:            https://github.com/zagdrath/quartz-command
Requires:       nodejs >= 18.17

%description
Backend API (Rust/axum over PostgreSQL, with embedded migrations) and
Next.js web frontend, run as the quartz-command-backend and
quartz-command-frontend systemd services.

%install
cp -a %{qc_staging}/. %{buildroot}/

%pre
if ! getent passwd quartz-command >/dev/null; then
    useradd --system --user-group \
        --home-dir /var/lib/quartz-command --no-create-home \
        --shell /sbin/nologin quartz-command
fi
exit 0

%post
systemctl daemon-reload >/dev/null 2>&1 || :
if [ "$1" -eq 1 ]; then
    echo "quartz-command installed."
    echo "  1. Edit /etc/quartz-command/backend.env (DATABASE_URL at minimum)."
    echo "  2. systemctl enable --now quartz-command-backend quartz-command-frontend"
fi

%preun
if [ "$1" -eq 0 ]; then
    systemctl --no-reload disable --now \
        quartz-command-backend.service quartz-command-frontend.service \
        >/dev/null 2>&1 || :
fi

%postun
systemctl daemon-reload >/dev/null 2>&1 || :

%files
/usr/bin/quartz-command
/usr/lib/quartz-command
/usr/lib/systemd/system/quartz-command-backend.service
/usr/lib/systemd/system/quartz-command-frontend.service
%dir /etc/quartz-command
%config(noreplace) %attr(0640, root, quartz-command) /etc/quartz-command/backend.env
%config(noreplace) /etc/quartz-command/frontend.env
%dir %attr(0750, quartz-command, quartz-command) /var/lib/quartz-command
