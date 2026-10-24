# Terra en disputa (TED)

Terra en disputa es un juego de estrategia por turnos para **2 a 6 personas**, con conquista de países, refuerzos, dados, cartas y pactos. Una persona aloja el servidor y todos juegan desde el navegador con un enlace de invitación. Las partidas se guardan en el equipo que aloja.

Tiene tres modalidades, que se eligen al crear la partida:

- **Clásico:** 50 países. Con 4 a 6 jugadores hay objetivos secretos y el objetivo común de ocupar 30 países; con 2 o 3 gana quien conquiste los 50.
- **Competitivo:** para 4 a 6 personas, con relojes, rondas finales automáticas y puntaje.
- **Reconquista:** 72 países, situaciones que cambian cada ronda, misiles, alianzas y países compartidos.

Terra en disputa is not affiliated with, endorsed by, or sponsored by the owners or publishers of T.E.G. No official artwork, screenshots, rulebook text, or TEGNet material is included.

## Elegí cómo alojarlo

| Situación                                      | Qué usar                                                                       |
| ---------------------------------------------- | ------------------------------------------------------------------------------ |
| Jugar en tu casa desde tu computadora          | [Paquete portable](#1-jugar-desde-tu-computadora) (Windows o Linux x64)        |
| Dejarlo siempre encendido en un servidor Linux | [Servicio systemd](#2-servidor-linux-como-servicio)                            |
| Jugar a distancia con amigos                   | [Tailscale](#3-jugar-a-distancia) (red privada, recomendado)                   |
| Abrirlo a cualquiera con un enlace HTTPS       | [Tailscale Funnel o dominio propio](#3-jugar-a-distancia) delante del servicio |

Para jugar alcanza con un navegador moderno, en computadora, tablet o teléfono. No hay paquetes para macOS ni ARM.

## 1. Jugar desde tu computadora

Los paquetes compilados incluyen Node.js, así que no hace falta instalar nada más. Se generan con el pipeline de GitHub al publicar una etiqueta `v*`, o podés [compilarlos vos](#compilar-desde-el-código).

1. Descargá el paquete de tu sistema, comprobalo con `SHA256SUMS` y extraé **toda la carpeta**.
2. En Windows abrí `ted.cmd`. En Linux ejecutá `./ted` dentro de la carpeta.
3. Se abre el panel del anfitrión. Creá una partida, elegí la modalidad y cuántas personas juegan (contándote si participás).
4. En **Red para compartir**, elegí la red que usan tus amigos, copiá la invitación y enviala. `localhost` y `127.0.0.1` solo funcionan en tu propio equipo.
5. Cada jugador elige apodo y color y se marca listo. Cuando todos están listos, tocá **Comenzar**.

**Yo también voy a jugar** abre una pestaña para participar sin cerrar el panel. El servidor y el equipo tienen que quedar encendidos durante la partida.

Si otro equipo no puede entrar, permití el puerto `3000` (TCP) en el firewall del anfitrión. Para jugar a distancia, mirá [Jugar a distancia](#3-jugar-a-distancia). El tráfico va por HTTP sin cifrar, así que usalo solo en redes de confianza.

Opciones útiles (`./ted --help` muestra todas):

```bash
./ted --no-open --port 3000 --data-dir ./data
```

Las partidas se guardan aparte de la aplicación: `~/.local/share/ted` en Linux y `%LOCALAPPDATA%\TED\data` en Windows.

### En Windows

1. Extraé el `.zip` completo en una carpeta tuya, por ejemplo `C:\Juegos\ted`. No lo ejecutes desde dentro del `.zip`.
2. Abrí `ted.cmd`. Windows puede avisar que el programa no está firmado: elegí **Más información** y **Ejecutar de todas formas** solo si el `SHA256SUMS` coincide.
3. Cuando el Firewall de Windows pregunte, permití el acceso en **redes privadas**. Sin eso, los demás equipos no pueden entrar.
4. Dejá abierta la ventana de la terminal mientras se juega. Cerrarla apaga el servidor.

Para que arranque solo al iniciar sesión, creá una tarea en el **Programador de tareas** con el desencadenador «Al iniciar sesión» y la acción `C:\Juegos\ted\ted.cmd` con el argumento `--no-open`. El código de administración queda en la ventana de la tarea; si no la ves, reiniciá la tarea y entrá con el código nuevo.

Las copias de seguridad funcionan igual que en Linux, con el servidor cerrado: `ted.cmd backup --output C:\copias\ted-backup.json`. No hay instalador como servicio para Windows. La versión de Windows se verifica en el pipeline, pero no se probó a mano.

## 2. Servidor Linux como servicio

Para un VPS o un equipo Linux x64 con systemd. El instalador compila el código, instala el juego en `~/ted`, crea `ted.service` y lo deja arrancando con el sistema. El servidor corre con tu usuario, no como root.

### Requisitos

- Node.js **>=24.11 y <25** y pnpm **10.15.0**. Con Node instalado:
  ```bash
  corepack enable
  corepack prepare pnpm@10.15.0 --activate
  ```
- `curl`, `tar` y systemd. En Ubuntu suele faltar solo `curl`: `sudo apt install curl`.
- Un usuario normal con sudo. Con 1 GB de RAM conviene tener swap.

### Instalar

Bajá el código y, desde su carpeta, instalá **sin sudo delante**:

```bash
git clone https://github.com/unlisted3954/TerraEnDisputa.git
cd TerraEnDisputa
bash scripts/install-game.sh
```

Por defecto escucha en `127.0.0.1:3000` y guarda las partidas en `~/.local/share/ted`. Para cambiarlo, en la **primera** instalación:

```bash
bash scripts/install-game.sh --bind 0.0.0.0 --port 3000 --data-dir ~/.local/share/ted
```

Usá `--bind 0.0.0.0` para que entren equipos de tu red o VPN, y dejá `127.0.0.1` si lo vas a publicar con un túnel o proxy. El instalador compila, prueba el paquete, lo instala, arranca el servicio y comprueba que responda.

### Usarlo

```bash
systemctl status ted.service
sudo systemctl restart ted.service
sudo journalctl -u ted.service -n 100 --no-pager   # muestra el código de administración
curl http://127.0.0.1:3000/health
```

El panel está en `http://<servidor>:3000/admin`. Cada arranque imprime un código de administración nuevo en el journal; las partidas y los jugadores se conservan.

### Actualizar

Desde la carpeta del código, traé la última versión y reinstalá en un paso:

```bash
bash scripts/install-game.sh --pull
```

Detecta su puerto, dirección y datos, respalda la instalación anterior en `~/ted-backups/` y conserva la unidad con sus variables. Si algo falla, vuelve a la versión anterior. Las opciones `--bind`, `--port` y `--data-dir` solo valen para instalaciones nuevas.

### Desinstalar o empezar de cero

```bash
bash scripts/uninstall-game.sh           # borra el servicio y la aplicación, conserva las partidas
bash scripts/uninstall-game.sh --purge   # también borra partidas y respaldos
```

Te muestra qué va a borrar y pide confirmación. Con `--user-service` desinstala el servicio personal.

La [guía del instalador](docs/INSTALLING.md) cubre el servicio personal sin sudo (`--user-service`), carpetas propias y la recuperación ante fallos.

## 3. Jugar a distancia

### Tailscale: red privada (recomendado)

[Tailscale](https://tailscale.com) arma una red privada entre tus equipos y los de tus amigos. El juego no queda expuesto en Internet y no hace falta dominio ni HTTPS.

1. Instalá Tailscale en el equipo que aloja el juego y conectalo a tu cuenta. En Linux: `curl -fsSL https://tailscale.com/install.sh | sh` y después `sudo tailscale up`.
2. Invitá a tus amigos a tu red desde la consola de Tailscale (**Share** para compartir solo esa máquina, o **Invite users**). Cada uno instala Tailscale en su computadora o teléfono.
3. El juego tiene que escuchar en la red de Tailscale. En Windows y con `./ted` ya lo hace. En el servicio Linux, instalalo con `--bind 0.0.0.0` o con la IP de Tailscale del servidor (`tailscale ip -4`, empieza con `100.`).
4. En el panel, en **Red para compartir**, elegí la dirección `100.x.y.z` y mandá la invitación.

Usá la IP `100.x.y.z`, no el nombre `*.ts.net`: el juego solo acepta direcciones IP o su dirección pública configurada.

### Tailscale Funnel: enlace HTTPS sin dominio propio

Funnel publica el juego en `https://<equipo>.<tu-red>.ts.net` y los jugadores no necesitan instalar nada. Con el servicio Linux escuchando en `127.0.0.1:3000`:

```bash
sudo tailscale funnel --bg --https=443 http://127.0.0.1:3000
tailscale funnel status          # muestra la dirección pública
```

Después cargá esa dirección en el servicio, igual que con un dominio propio (ver abajo), con `GAME_PUBLIC_ORIGIN=https://<equipo>.<tu-red>.ts.net` y `GAME_TRUSTED_PROXY=127.0.0.1`. Para cerrarlo: `sudo tailscale funnel --https=443 off`. Funnel tiene que estar habilitado para tu red en la consola de Tailscale. Esta combinación no se probó todavía con el juego.

### Dominio propio con túnel o proxy

Con un dominio propio podés usar un túnel con nombre de Cloudflare (no los túneles rápidos `trycloudflare.com`, que Cloudflare reserva para pruebas) o un proxy HTTPS como Caddy o Nginx. Instalá el servicio escuchando en `127.0.0.1` y hacé que el túnel o proxy reenvíe HTTP y WebSocket a `http://127.0.0.1:3000`.

En los dos casos con HTTPS público, decile al juego cuál es su dirección:

```bash
sudo systemctl edit ted.service
```

```ini
[Service]
Environment=GAME_PUBLIC_ORIGIN=https://juego.ejemplo.com
Environment=GAME_TRUSTED_PROXY=127.0.0.1
```

```bash
sudo systemctl restart ted.service
```

`GAME_PUBLIC_ORIGIN` es la dirección exacta que usan los jugadores, con `https://` y sin barra final. `GAME_TRUSTED_PROXY` es la dirección desde la que llega el túnel o proxy: `127.0.0.1` cuando corre en el mismo servidor. Sin estas variables, el juego rechaza pedidos que llegan con un dominio desconocido. Las actualizaciones conservan estos ajustes.

Más detalle en [alojamiento avanzado](docs/SELF_HOSTING.md#publicar-en-internet).

## Copias de seguridad

Con el servidor detenido:

```bash
~/ted/ted backup --output ~/ted-backup.json
~/ted/ted restore --input ~/ted-backup.json --confirm
```

Agregá `--data-dir` si usás otra carpeta de datos. La copia incluye las tres modalidades. Restaurar conserva los datos anteriores en lugar de borrarlos. Más detalle en [backup y restauración](docs/SELF_HOSTING.md#copias-restauración-y-actualización).

## Problemas comunes

| Mensaje o síntoma                                         | Qué hacer                                                                                                                                                                                       |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ted.service existe, pero falta la aplicación`            | El instalador ofrece borrar la unidad rota y hacer una instalación nueva. Respondé `s`; las partidas no se tocan.                                                                               |
| `Packaged server did not answer /health`                  | La prueba del paquete no pudo hablar con su servidor local. Si el equipo usa un proxy, repetí con `env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy bash scripts/install-game.sh`. |
| `Unit ted.service could not be found` después de instalar | El instalador se detuvo antes de crear el servicio. Revisá el primer `ERROR` de su salida.                                                                                                      |
| El dominio responde `421` o el juego no conecta           | Falta o no coincide `GAME_PUBLIC_ORIGIN`, o el túnel no reenvía WebSocket. Revisá [Jugar a distancia](#3-jugar-a-distancia).                                                                    |
| Me pide un código de administración                       | Buscalo en `sudo journalctl -u ted.service -n 100 --no-pager` o en la terminal donde corre `ted`. Cambia en cada reinicio.                                                                      |
| La compilación se queda sin memoria                       | Agregá swap o subí el límite: `TED_BUILD_MEMORY_MB=1024 bash scripts/install-game.sh`.                                                                                                          |

## Compilar desde el código

Con Node.js `>=24.11 <25` y pnpm `10.15.0`:

```bash
pnpm install --frozen-lockfile
pnpm typecheck && pnpm lint && pnpm build
pnpm release        # genera el paquete en release/ y lo prueba
```

`bash scripts/update-game.sh --build` hace lo mismo con límites pensados para equipos chicos. Ver [actualizar y compilar](docs/UPDATING.md).

Los pipelines de GitHub Actions no corren en cada push. Se inician a mano desde Actions, con la etiqueta `ci` en un pull request, o al publicar una etiqueta `v*`, que además arma los paquetes de Windows y Linux en un borrador de release.

La [referencia técnica](docs/TECHNICAL.md) explica la estructura del código, las sesiones y el almacenamiento.

## Licencia

**AGPL-3.0-only**; ver [LICENSE](LICENSE). Los paquetes incluyen los avisos de licencias de terceros.
