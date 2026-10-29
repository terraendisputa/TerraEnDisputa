#!/usr/bin/env bash
# Stop and remove the Terra en disputa service and application; games stay unless --purge.
set -Eeuo pipefail

# Messages come in Spanish and English; the system language picks one.
case ${LC_ALL:-${LC_MESSAGES:-${LANG:-}}} in es|es[_.@-]*) spanish=true ;; *) spanish=false ;; esac
pick() { if $spanish || (($# == 1)); then printf '%s' "$1"; else printf '%s' "$2"; fi; }
die() { printf 'ERROR: %s\n' "$(pick "$@")" >&2; exit 1; }
say() { printf '%s\n' "$(pick "$@")"; }
usage() {
  if $spanish; then
    cat <<'USAGE'
Uso: bash scripts/uninstall-game.sh [opciones]

Detiene y borra ted.service y la aplicación instalada.
Las partidas y los respaldos se conservan, salvo con --purge.

--install-dir CARPETA  Instalación; predeterminado: ~/ted.
--data-dir CARPETA     Datos a borrar con --purge; por defecto, los del servicio.
--user-service         Servicio systemd personal, sin sudo.
--purge                Borra también las partidas y los respaldos.
--yes                  No pide confirmación.
-h, --help             Ayuda.
USAGE
  else
    cat <<'USAGE'
Usage: bash scripts/uninstall-game.sh [options]

Stops and removes ted.service and the installed application.
Games and backups are kept, unless --purge is given.

--install-dir FOLDER  Installation; default: ~/ted.
--data-dir FOLDER     Data removed with --purge; defaults to the service's.
--user-service        Personal systemd service, without sudo.
--purge               Also remove games and backups.
--yes                 Do not ask for confirmation.
-h, --help            Help.
USAGE
  fi
}

install_dir=$HOME/ted
data_dir=
personal=false
purge=false
confirmed=false
while (($#)); do
  case "$1" in
    --user-service) personal=true; shift ;;
    --purge) purge=true; shift ;;
    --yes) confirmed=true; shift ;;
    --install-dir|--data-dir)
      if (($# < 2)) || [[ -z $2 || $2 == --* ]]; then die "Falta el valor de $1." "Missing value for $1."; fi
      [[ $1 == --install-dir ]] && install_dir=$2 || data_dir=$2
      shift 2
      ;;
    --help|-h) usage; exit 0 ;;
    *) die "Opción desconocida: $1. Consultá --help." "Unknown option: $1. See --help." ;;
  esac
done
((EUID != 0)) || die 'Ejecutalo con tu usuario habitual, sin sudo delante del script.' 'Run it as your regular user, without sudo in front of the script.'
install_dir=$(realpath -m -- "$install_dir")
backup_root=${install_dir}-backups
[[ $install_dir != / && $install_dir != "$HOME" ]] || die 'La carpeta de instalación no puede ser / ni tu carpeta personal.' 'The installation folder cannot be / or your home folder.'

service=ted.service
if $personal; then
  ctl=(systemctl --user)
  inspect=(systemctl --user)
  admin=()
else
  ctl=(sudo systemctl)
  inspect=(systemctl)
  admin=(sudo)
fi

load_state=$("${inspect[@]}" show "$service" -p LoadState --value 2>/dev/null) || load_state=not-found
fragment=
if [[ $load_state != not-found ]]; then
  fragment=$("${inspect[@]}" show "$service" -p FragmentPath --value)
  if [[ -z $data_dir ]]; then
    # The unit written by install-game.sh passes --data-dir explicitly.
    exec_start=$("${inspect[@]}" show "$service" -p ExecStart --value)
    if [[ $exec_start =~ --data-dir\ ([^\ \;]+) ]]; then data_dir=${BASH_REMATCH[1]}; fi
  fi
fi
[[ -n $data_dir ]] || data_dir=${XDG_DATA_HOME:-$HOME/.local/share}/ted
data_dir=$(realpath -m -- "$data_dir")
[[ $data_dir != / && $data_dir != "$HOME" ]] || die 'La carpeta de datos no puede ser / ni tu carpeta personal.' 'The data folder cannot be / or your home folder.'

say 'Se va a borrar:' 'This will be removed:'
[[ -n $fragment ]] && say "  servicio:   $fragment (y sus ajustes en $service.d)" "  service:     $fragment (and its settings in $service.d)"
[[ -e $install_dir ]] && say "  aplicación: $install_dir" "  application: $install_dir"
if $purge; then
  [[ -e $data_dir ]] && say "  partidas:   $data_dir" "  games:       $data_dir"
  [[ -e $backup_root ]] && say "  respaldos:  $backup_root" "  backups:     $backup_root"
else
  say "Se conservan las partidas ($data_dir) y los respaldos ($backup_root)." "Games ($data_dir) and backups ($backup_root) are kept."
fi
if ! $confirmed; then
  [[ -t 0 ]] || die 'Confirmá con --yes cuando no hay una terminal interactiva.' 'Confirm with --yes when there is no interactive terminal.'
  read -r -p "$(pick '¿Continuar? [s/N] ' 'Continue? [y/N] ')" answer
  [[ $answer == [sSyY] ]] || die 'Cancelado.' 'Cancelled.'
fi

if [[ -n $fragment ]]; then
  "${ctl[@]}" disable --now "$service" || true
  "${admin[@]}" rm -f -- "$fragment"
  "${admin[@]}" rm -rf -- "$(dirname -- "$fragment")/$service.d"
  "${ctl[@]}" daemon-reload
  "${ctl[@]}" reset-failed "$service" >/dev/null 2>&1 || true
fi
rm -rf -- "$install_dir"
if $purge; then rm -rf -- "$data_dir" "$backup_root"; fi
say 'Terra en disputa quedó desinstalado.' 'Terra en disputa was uninstalled.'
