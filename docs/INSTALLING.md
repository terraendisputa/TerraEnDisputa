# Compilar e instalar como servicio en Linux

## Instalación y actualización

`scripts/install-game.sh` compila y verifica el paquete mediante `update-game.sh`, instala la aplicación en una carpeta separada del código fuente y crea/habilita `ted.service`. Admite Linux x64 con systemd; no instala herramientas de desarrollo, proxies ni túneles.

## Requisitos

- Bash, Node.js **>=24.11 y <25**, pnpm **10.15.0** y las herramientas de empaquetado existentes.
- systemd activo, `systemctl`, `systemd-analyze`, `journalctl`, `curl`, `tar`, `sha256sum`, `realpath` y `flock`.
- Un usuario normal con permiso para usar sudo al crear el servicio del sistema. También puede instalarse un servicio personal con `--user-service`.

En Ubuntu, la mayoría de estas herramientas ya están instaladas. Si falta curl, se instala con `sudo apt install curl`. La [guía de compilación](UPDATING.md) explica cómo preparar Node y pnpm. El límite del heap de compilación es 512 MB por defecto, ajustable con `TED_BUILD_MEMORY_MB`. Con 1 GB de RAM conviene tener swap.

## Instalación habitual

Dentro del código fuente, ejecutar **sin sudo delante**:

```bash
bash scripts/install-game.sh
```

El script compila con tu usuario, instala en `~/ted` y solicita sudo únicamente para administrar la unidad del sistema. El servidor también corre con tu usuario, no como root. Se inicia y queda habilitado para arrancar con Linux.

Por defecto escucha en `127.0.0.1:3000`. El panel local se encuentra en `http://127.0.0.1:3000/admin`. Las partidas se guardan en `$XDG_DATA_HOME/ted` o `~/.local/share/ted`, separadas de aplicación y código.

Para escuchar en una red local o VPN, en la **primera instalación**:

```bash
bash scripts/install-game.sh --bind 0.0.0.0
```

Para usar un puerto o carpetas diferentes:

```bash
bash scripts/install-game.sh \
  --install-dir /ruta/a/ted \
  --data-dir /ruta/a/partidas \
  --port 4000
```

Las carpetas deben ser accesibles para tu usuario, estar separadas y no ser enlaces simbólicos. Los puertos permitidos en unidades nuevas son 1024–65535. El script comprueba que la dirección/puerto estén disponibles antes de comenzar la instalación.

El archivo de unidad se guarda en `/etc/systemd/system/ted.service`, con la carpeta de trabajo y el directorio de datos explícitos. Configura reinicio ante fallos, parada con SIGTERM y permisos privados para archivos nuevos.

## Uso y código de administración

```bash
sudo systemctl status ted.service
sudo systemctl stop ted.service
sudo systemctl start ted.service
sudo systemctl restart ted.service
sudo journalctl -u ted.service -n 100 --no-pager
```

El journal muestra el código de administración. Cada reinicio genera uno nuevo e invalida el anterior; las partidas y sesiones de jugadores se conservan.

## Reinstalación y actualización

Para compilar tu copia local y reemplazar una instalación existente:

```bash
bash scripts/install-game.sh
```

Para traer `main` del repositorio público, compilar e instalar en un paso:

```bash
bash scripts/install-game.sh --pull
```

Si bajaste el código como ZIP, reemplazá la carpeta por el ZIP nuevo y corré el instalador sin `--pull`.

Si la instalación está en otra carpeta, repetí `--install-dir` con la ruta correspondiente. También puede utilizarse `--dir` para indicar la carpeta fuente cuando el script se copia fuera del repositorio.

Si ya existe `ted.service`, el instalador exige que pertenezca a tu usuario, con `WorkingDirectory` y el launcher correspondientes a la instalación. Si está detenido, lo inicia un momento. Detecta puerto, escucha y datos desde el proceso real y **conserva íntegramente la unidad existente**, incluyendo variables de dominio, proxy y otros ajustes. Los flags `--bind`, `--port` y `--data-dir` se rechazan en este caso para evitar ignorar o reemplazar configuración silenciosamente.

Ejecutá el script como el usuario del servicio existente. Si la unidad existe pero falta la aplicación, el instalador ofrece borrar esa unidad y hacer una instalación nueva; conserva los ajustes de `systemctl edit` y las partidas. No modifica túneles, DNS, firewall ni HTTPS.

La compilación y la verificación del bundle terminan antes de detener el servicio. Después:

1. Se respalda la carpeta de datos y, cuando existe una aplicación anterior, también se genera su backup JSON.
2. Se comprueba la compatibilidad de la nueva aplicación con todas las partidas sobre una copia desechable.
3. Se conserva la aplicación anterior, se instala la nueva y se inicia el servicio.
4. Se comprueba `/health`, la estabilidad del proceso y que el journal no informe partidas que no pudieron cargarse.

Los respaldos se guardan en `CARPETA-DE-INSTALACIÓN-backups/FECHA`. Si falla la actualización después de detener el servicio, intenta recuperar la aplicación y los datos previos y reiniciar el servicio anterior. Preserva los archivos fallidos en el respaldo y los datos fallidos en una carpeta hermana con sufijo `.failed-FECHA`. Si falla una instalación inicial, retira la unidad recién creada y conserva los archivos fallidos para inspección.

No hay limpieza automática de respaldos, ni comando de rollback voluntario en este instalador. Recuperar un respaldo antiguo puede perder progreso posterior y debe hacerse como una operación explícita. Cortes eléctricos o SIGKILL durante el reemplazo pueden exigir recuperar manualmente las carpetas preservadas. La aplicación debe ejecutarse desde la carpeta de instalación, nunca directamente desde `release/`, que se regenera al compilar. Las partidas permanecen en su carpeta de datos separada.

## Servicio personal sin sudo

```bash
bash scripts/install-game.sh --user-service
```

Requiere un gestor systemd de usuario disponible. Crea `~/.config/systemd/user/ted.service` (o la ruta correspondiente a `XDG_CONFIG_HOME`). Se administra con:

```bash
systemctl --user status ted.service
systemctl --user restart ted.service
journalctl --user -u ted.service -n 100 --no-pager
```

Para que el gestor personal funcione al arrancar el equipo y después de cerrar sesión, un administrador puede habilitar lingering:

```bash
sudo loginctl enable-linger TU_USUARIO
```

El instalador no habilita lingering automáticamente. En un VPS permanente, el servicio del sistema predeterminado suele ser la opción más directa. No crees un servicio personal adicional mientras el servicio del sistema usa el mismo puerto o carpeta de datos.

## Publicación en Internet

La instalación por defecto crea un servidor HTTP local. Para publicarlo, configurá por separado un proxy HTTPS o túnel y el origen público; consultá [alojamiento avanzado](SELF_HOSTING.md#publicar-en-internet). Para el servicio del sistema, un override puede declarar:

```ini
[Service]
Environment=GAME_PUBLIC_ORIGIN=https://juego.ejemplo.com
Environment=GAME_TRUSTED_PROXY=127.0.0.1
```

Usá `sudo systemctl edit ted.service`, luego `sudo systemctl daemon-reload` y `sudo systemctl restart ted.service`. La dirección de proxy debe coincidir con el proxy real; no uses un wildcard. Si tu unidad ya contiene estos ajustes, la reinstalación los conserva.

## Evitar servicios duplicados

El instalador rechaza una unidad `ted.service` existente en el otro ámbito de systemd, incluso inactiva. No ejecutes un servicio personal y uno del sistema sobre los mismos datos. Otros gestores de usuario o procesos manuales requieren comprobación del administrador. La aplicación conserva el bloqueo del directorio de datos.

## Desinstalar

```bash
bash scripts/uninstall-game.sh
```

Detiene y borra el servicio, sus ajustes y la aplicación. Conserva las partidas y los respaldos, salvo con `--purge`. Muestra qué va a borrar y pide confirmación; `--yes` la omite. Usá `--user-service` para el servicio personal y `--install-dir` si instalaste en otra carpeta.
