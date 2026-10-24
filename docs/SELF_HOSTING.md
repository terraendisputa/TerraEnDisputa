# Alojar Terra en disputa

Los paquetes oficiales son archivos portables para Linux x64 y Windows x64. Incluyen el servidor y la aplicación web; quien aloja no necesita instalar Node.js, pnpm ni un compilador. El [README](../README.md) tiene los pasos rápidos; esta guía amplía la operación del servidor.

## Red local

1. Descargá el paquete de tu sistema y comprobalo con `SHA256SUMS`.
2. Extraé el archivo completo. En Linux ejecutá `./ted`; en Windows abrí `ted.cmd`, con doble clic o desde una terminal.
3. La terminal muestra la dirección del panel de administración, las direcciones IPv4 alcanzables y la carpeta de datos. El navegador se abre solo; en un servidor sin pantalla usá `--no-open`.
4. Un arranque local normal abre el panel con acceso automático. Elegí **Crear una partida** o continuá una existente, contándote si vas a jugar. Elegí la red que comparten tus amigos y copiá la invitación; no compartas una dirección `localhost`. **Yo también voy a jugar** abre una pestaña de jugador aparte. Comenzá cuando todos los asientos estén ocupados y listos.
5. Si otro equipo no puede entrar, permití el puerto TCP configurado (por defecto `3000`) en el firewall del anfitrión. Terra en disputa nunca cambia el firewall ni el router.

Cada arranque imprime un código de administración nuevo. Reiniciar invalida el código y la sesión de administración anteriores, pero no las partidas ni las sesiones de los jugadores.

HTTP sin cifrar no protege el tráfico. Usalo solo en una red local de confianza o una VPN privada.

## Servidor sin pantalla

En Linux x64 con systemd, `bash scripts/install-game.sh` compila, instala y crea un servicio que corre con tu usuario. Ver la [guía del instalador](INSTALLING.md).

También podés ejecutar `ted --no-open` a mano. Abrí la dirección de administración que imprime y entrá con el código. Funciona desde otro equipo con la dirección de red del servidor. El acceso automático no se habilita con `--no-open`, con un origen público ni con un proxy de confianza: usa un token de un solo uso que vence a los cinco minutos, y si falla se usa el código manual. El proceso tiene que seguir abierto mientras se juega.

Si aparecen varias interfaces de red, elegí la red local o VPN que usan los invitados. Detectar una dirección no garantiza que los demás equipos la alcancen. Si el navegador bloquea el portapapeles por HTTP, la invitación se puede seleccionar y copiar a mano.

## Configuración

`ted --help` muestra todas las opciones. Las más comunes:

```text
--bind <dirección>  dirección de escucha (por defecto 0.0.0.0)
--port <número>     puerto de escucha (por defecto 3000)
--data-dir <ruta>   carpeta de datos explícita
--no-open           no abrir el navegador
```

`GAME_HOST`, `GAME_PORT`, `GAME_PUBLIC_ORIGIN` y `GAME_TRUSTED_PROXY` sirven para despliegues avanzados. Las opciones `--bind` y `--port` tienen prioridad sobre las variables. Las rutas de datos relativas se resuelven desde la carpeta de arranque, lo que permite un uso portable como `--data-dir ./data`.

Por defecto, los datos se guardan aparte de la aplicación:

- Linux: `$XDG_DATA_HOME/ted` o `~/.local/share/ted`
- Windows: `%LOCALAPPDATA%\TED\data`

Reemplazar la carpeta de la aplicación no borra partidas ni la autenticación de administración.

## Jugar por VPN privada

Armá la red privada por tu cuenta, con Tailscale, WireGuard, ZeroTier u otro proveedor, y ejecutá Terra en disputa normalmente. Los jugadores entran por la dirección IPv4 privada del anfitrión. El proyecto no tiene integración con ninguna VPN ni envía telemetría. El README explica el caso de [Tailscale](../README.md#3-jugar-a-distancia).

## Publicar en Internet

Para alojarlo públicamente hacen falta un dominio, HTTPS y un proxy inverso o túnel administrados por vos. Hacé que Terra en disputa escuche en `127.0.0.1` o en una dirección privada concreta, configurá `GAME_PUBLIC_ORIGIN` con el origen público exacto (`https://…`) y `GAME_TRUSTED_PROXY` solo con la dirección o red CIDR del proxy, nunca con un comodín. El proxy tiene que reenviar HTTP y WebSocket al mismo puerto.

Terra en disputa no emite certificados ni configura DNS, router, firewall, proxy o túnel. Los WebSocket seguros funcionan a través de un proxy HTTPS bien configurado, porque el navegador y el servidor usan el mismo origen público.

## Copias, restauración y actualización

Para compilar el código y generar un paquete, usá `scripts/update-game.sh` ([guía de compilación](UPDATING.md)). Instalarlo, respaldar y reiniciar el servidor son pasos aparte, salvo que uses el instalador de Linux.

Con el servidor detenido, creá una copia consistente:

```text
ted backup --output /ruta/fuera/de/los/datos/ted-backup.json
```

Agregá `--data-dir` si usás otra carpeta. El destino tiene que estar fuera de la carpeta de datos activa. La copia incluye las partidas de Clásico, Competitivo y Reconquista. Guardala completa y nunca edites a mano los JSON de persistencia.

Para restaurar, con el servidor detenido: `ted restore --input /ruta/ted-backup.json --confirm`. El comando valida la compatibilidad, rechaza que otro proceso use los datos y conserva la generación anterior en lugar de borrarla; las partidas previas de Reconquista quedan en una carpeta `reconquista` dentro de ella. Las copias anteriores a Reconquista se restauran sin esas partidas, y una versión más vieja no puede restaurar una copia más nueva. No copies generaciones parciales.

Para actualizar a mano: detené el servidor, hacé una copia, reemplazá la carpeta de la aplicación y arrancá la versión nueva con la misma carpeta de datos. Volver a una versión anterior después de una migración de esquema no está garantizado; en ese caso restaurá una copia compatible. No hay actualizador automático.

## Competitivo

El servidor administra turnos de dos minutos, pausas técnicas y el anuncio automático de las rondas finales tras 60 minutos de juego efectivo con cuatro jugadores iniciales, u 80 con cinco o seis. Completa la ronda en curso y dos rondas más; en las finales cada turno tiene tres minutos. Las pausas y el tiempo con el servidor apagado no cuentan como juego efectivo.

Al reiniciar, las partidas de Competitivo en curso vuelven en pausa. Reconectá a los jugadores y reanudá desde el control de pausa técnica del panel. Si el jugador de turno no está, recibe ocho minutos de espera técnica por partida; si se agotan, queda descalificado y sus países y ejércitos siguen en el tablero. Un asiento desconectado no queda libre para que lo tome otra persona.

Para ver los resultados, abrí **Finalizadas** en el panel y elegí la partida. La tabla muestra puestos, métricas y componentes, y se puede exportar a JSON o CSV con fracciones exactas, sin cartas individuales ni credenciales. Con menos de seis rondas normales completas, historial incompleto o todos descalificados no hay puntos oficiales. Si quedan cartas heredadas por elegir, el resultado es provisional. Los descalificados no reciben puesto ni puntos.

## Código fuente y licencia

Terra en disputa usa `AGPL-3.0-only`. Cada paquete oficial corresponde a una etiqueta Git inmutable, como `v1.0.0`, de la que se obtiene el código fuente. El paquete incluye `LICENSE` y `THIRD_PARTY_LICENSES`. Una compilación local no es una versión publicada.

Los paquetes de Windows no están firmados y Windows puede mostrar una advertencia. No desactives la seguridad del sistema: comprobá el `SHA256SUMS` y descargá solo desde la página de versiones del proyecto.
