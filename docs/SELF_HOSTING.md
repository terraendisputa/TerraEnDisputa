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

## Clásico Express

En la sala de espera de una partida de Clásico, el selector «Duración» ofrece «Sin límite» (la predeterminada) o «Express». Express usa el reloj de Competitivo: turnos de dos minutos (incorporación y ataque son turnos separados), y al llegar al tiempo límite se completa la ronda en curso y se juegan dos rondas más, con turnos de tres minutos. El límite es de 40 minutos de juego efectivo con dos o tres jugadores, 60 con cuatro y 80 con cinco o seis. No hay puntaje: si nadie cumple su objetivo antes, gana quien tenga más países, y ante empate más ejércitos, más canjes y más cartas; si siguen empatados, la partida termina en empate. Las reglas de Clásico no cambian, y los pactos se pueden romper también en las rondas finales. Si el jugador de turno se desconecta, el reloj se detiene durante cinco minutos de gracia; si no vuelve antes de que venza su turno, un bot juega por él hasta que se reconecte, con sus mismos pactos. El administrador puede pausar y reanudar desde el panel, igual que en Competitivo.

En Clásico, con o sin Express, el panel tiene la misma sección de bots que Competitivo: dificultad (Difícil por defecto) y «Poner bot» o «Quitar bot» en cada jugador. «Reemplazar ausentes por bot» aparece solo en Express; si lo apagás, los turnos del ausente pasan solos. Sin Express nadie queda ausente: un bot entra solo si lo ponés vos. Los bots de Clásico responden los pactos que les ofrecen, y en Difícil también proponen pactos de frontera y los rompen cuando les conviene. Clásico no tiene «Pedir bot».

En la sala de espera de Clásico, el selector «Bots» elige cuántos de los asientos de «Jugadores requeridos» ocupan bots al comenzar, desde uno hasta dejar un solo asiento para una persona; así se puede jugar solo contra bots. Los bots de la mesa reciben un nombre al azar, como en Competitivo, y juegan con la dificultad del panel. En Express, «Quitar bot» libera el asiento de un bot de la mesa: sus turnos pasan solos hasta que una persona lo toma con el enlace de la partida. Sin Express, los bots de la mesa juegan hasta el final.

## Competitivo

El servidor administra turnos de dos minutos, pausas técnicas y el anuncio automático de las rondas finales tras 60 minutos de juego efectivo con cuatro jugadores iniciales, u 80 con cinco o seis. Con cinco o seis, en la sala de espera se puede elegir la partida Express de 60 minutos. En «Jugadores requeridos», la opción «6: 4 jugadores + 2 bots» arma la mesa de la Superliga: esperan cuatro personas y, al comenzar, dos bots toman los asientos libres con un nombre al azar (Bot Paul, Bot Bélico, Bot Mate…), sin marcar «Estoy listo». Se juega 1:20 h + 2 rondas, sin pactos ni misiones de destruir, y la tabla de resultados marca los bots de la mesa y a los jugadores que reemplazó un bot. Desde la penúltima ronda, quien quedó con un solo país puede tocar «Pedir bot» para que un bot juegue por él el resto de la partida; los puntos siguen siendo suyos y solo el administrador puede devolverle el lugar. Para clasificatorias, semifinales y finales, marcá «Partida definitoria» en la sala de espera: esas partidas no usan bots. Quien queda ausente pasa a inactivo, y sus turnos, de incorporación y de ataque, duran 1 minuto y corren sin esperarlo. Con «Marcar inactivo» aplicás la regla a quien abandona, y con «Quitar inactivo» le devolvés los turnos normales. Completa la ronda en curso y dos rondas más; en las finales cada turno tiene tres minutos. Las pausas y el tiempo con el servidor apagado no cuentan como juego efectivo.

Al reiniciar, las partidas de Competitivo en curso vuelven en pausa. Reconectá a los jugadores y reanudá desde el control de pausa técnica del panel. Si el jugador de turno se desconecta, se lo espera hasta siete minutos cada vez: cinco de gracia, con el reloj de partida detenido, y los dos de su turno. Si no vuelve, un bot juega en su lugar y su nombre muestra «(bot)»: sus pactos se rompen y nadie puede ofrecerle pactos al bot. Cuando se reconecta, retoma su lugar. Conserva su puesto y sus puntos. En el panel de administración, la sección de bots de cada partida de Competitivo permite apagar el reemplazo por bot (entonces sus turnos pasan solos, con los refuerzos repartidos al azar), elegir la dificultad (Fácil juega casi al azar entre jugadas razonables; Normal sigue reglas fijas; Difícil, la predeterminada, persigue su misión o los 30 países, cuida sus continentes, calcula las probabilidades de los dados, guarda cartas y en las dos últimas rondas juega para el desempate) y poner o quitar un bot en el asiento de cualquier jugador con «Poner bot» y «Quitar bot». Un bot puesto por el administrador sigue jugando aunque el jugador se reconecte. Un asiento desconectado no queda libre para que lo tome otra persona.

Con cinco o seis jugadores solo hay pactos de frontera, uno por color. Si alguien rechaza un pacto, quien lo propuso espera cinco minutos de partida para volver a proponerle. Quien tiene un solo país no puede atacar desde él con cuatro ejércitos o menos.

Para ver los resultados, abrí **Finalizadas** en el panel y elegí la partida. La tabla muestra puestos, métricas y componentes, y se puede exportar a JSON o CSV con fracciones exactas, sin cartas individuales ni credenciales. Los empates se definen por países, ejércitos, canjes y cartas; si persisten, se reparten los puntos. La eliminación que cumple un objetivo de destrucción no suma el bonus de 10 puntos. Con menos de seis rondas normales completas, historial incompleto o todos descalificados no hay puntos oficiales. Si quedan cartas heredadas por elegir, el resultado es provisional. Los descalificados no reciben puesto ni puntos.

## Código fuente y licencia

Terra en disputa usa `AGPL-3.0-only`. Cada paquete oficial corresponde a una etiqueta Git inmutable, como `v1.0.0`, de la que se obtiene el código fuente. El paquete incluye `LICENSE` y `THIRD_PARTY_LICENSES`. Una compilación local no es una versión publicada.

Los paquetes de Windows no están firmados y Windows puede mostrar una advertencia. No desactives la seguridad del sistema: comprobá el `SHA256SUMS` y descargá solo desde la página de versiones del proyecto.
