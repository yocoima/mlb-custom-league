# MLB The Show 26 - Custom League Manager

## Objetivo del proyecto

Aplicación web estática para administrar exclusivamente una Custom League de MLB The Show 26.

NO considerar:
- Arena
- Diamond Dynasty
- Exhibition
- Programs
- Inventory

Solo considerar partidos cuyo:

game_mode === "LEAGUE"

## Repositorio y despliegue

Repositorio:
yocoima/mlb-custom-league

GitHub Pages:
https://yocoima.github.io/mlb-custom-league/

Cloudflare Worker:
https://mlb26-custom-league-proxy.yocoimadejesus.workers.dev

El frontend corre en GitHub Pages.

El Worker existe para evitar CORS entre GitHub Pages y:

https://mlb26.theshow.com

Rutas del Worker:

/api/history
/api/game-log

No modificar el Worker salvo que sea realmente necesario.

## Archivos principales

index.html
app.js
styles.css
src/league-core.js
worker.js

app.js:
- consulta la API
- descubre participantes
- recorre historiales
- mantiene estado
- renderiza UI

src/league-core.js:
- normalización de Game History
- filtro LEAGUE
- standings
- estadísticas
- helpers

worker.js:
- proxy CORS hacia MLB The Show API

## Datos conocidos

Usuario principal:
yocoima_herrera

Plataforma:
PSN

IMPORTANTE:
TODOS los participantes de esta Custom League son PSN.

Por lo tanto:
- no intentar detectar plataforma
- no probar xbl
- no probar mlbts
- no probar nsw
- cualquier participante descubierto debe recibir platform = "psn"

Game ID semilla conocido:

1690641801

Ese partido corresponde a:

Diamondbacks 1
Tigers 2

Equipo del usuario principal:
Tigers

## API

Game History:

/apis/game_history.json

La API no ofrece LEAGUE como filtro confiable/documentado.

Consultar:

mode=all

y filtrar localmente:

game_mode === "LEAGUE"

Game Log:

/apis/game_log.json

Se utiliza principalmente para obtener box_score y estadísticas detalladas.

## Funcionamiento esperado

La aplicación debe construir la liga recursivamente.

Ejemplo:

1. Consultar Game History de yocoima_herrera.
2. Filtrar únicamente LEAGUE.
3. Detectar rivales.
4. Asignar automáticamente PSN a cada rival.
5. Agregar cada rival a una cola de exploración.
6. Consultar Game History de cada rival.
7. Encontrar sus partidos LEAGUE contra otros participantes.
8. Descubrir nuevos participantes.
9. Repetir hasta que no queden participantes nuevos.
10. Deduplicar todos los partidos usando game ID.
11. Construir standings con TODOS los partidos de la liga.

La tabla NO debe contener solamente partidos contra yocoima_herrera.

Debe contener también:

Rival A vs Rival B
Rival B vs Rival C
Rival C vs Rival D
etc.

## Estado actual del proyecto

La aplicación funciona en GitHub Pages.

Cloudflare Worker funciona.

La API responde correctamente.

La UI funciona.

Actualmente detecta aproximadamente:

9 participantes
9 partidos LEAGUE

Esto es incorrecto/incompleto.

La tabla actual muestra:

yocoima_herrera GP=9

y la mayoría de los demás jugadores GP=1.

Esto demuestra que solamente se están contabilizando principalmente los partidos contra yocoima_herrera.

## Participantes detectados en la prueba actual

yocoima_herrera - Tigers
Gaboandres20 - Diamondbacks
LeyP9 - Red Sox
HansCristians88 - Dodgers
yermain10 - Brewers
gabrielVzla170 - Yankees
Petare11 - Braves
Angelotti0611 - Rays
daddy_champagnee - Dodgers

Todos son PSN.

No asumir que un equipo MLB es necesariamente único dentro de la liga:
actualmente hay más de un participante asociado a Dodgers.

## Bug principal conocido

El código actual intenta resolver la plataforma de cada rival.

Cuando no puede resolverla:

platform = null

y luego solamente agrega el participante a la cola si:

identity?.platform

Por lo tanto esos participantes son descubiertos visualmente,
pero sus historiales nunca son recorridos.

Resultado:

solo se obtienen los partidos del usuario inicial.

## Cambio prioritario

Eliminar la detección automática de plataforma.

Todo rival descubierto debe quedar:

platform: "psn"

y debe agregarse inmediatamente a la cola si aún no ha sido procesado.

Conceptualmente:

const identity = {
  username: cleanDisplayName(opp.user),
  platform: "psn"
};

addParticipant(...);

queue.push(participantKey(identity.username));

Siempre evitar duplicados en la cola/procesamiento.

## Deduplicación de partidos

Ya existe lógica basada en:

state.games.has(game.id)

Conservar esta estrategia.

Un mismo partido aparecerá en los historiales de ambos participantes,
pero debe contabilizarse una sola vez.

## Criterio para pertenecer a la liga

Solo aceptar:

game_mode === "LEAGUE"

Además utilizar la relación participante/equipo conocida para evitar mezclar otras Custom Leagues cuando sea posible.

No diseñar una solución que dependa de que todos los participantes tengan equipos MLB distintos.

## Problema visual conocido

Durante fetchAllHistory anteriormente se mostraba algo como:

pagina 10/30 - 0 partidos detectados

aunque sí se estaban descargando juegos.

El progreso debe mostrar preferentemente:

- página actual / páginas totales
- juegos revisados
- partidos LEAGUE encontrados

Ejemplo:

yocoima_herrera:
página 4/30 · 100 juegos revisados · 12 LEAGUE encontrados

## Siguiente tarea

Antes de rediseñar nada:

1. inspeccionar app.js actual
2. inspeccionar src/league-core.js
3. confirmar por qué los rivales no entran a la cola
4. modificar discovery para asumir PSN
5. recorrer los historiales de todos los participantes
6. deduplicar por game ID
7. recalcular standings
8. eliminar warnings de "requiere mapeo" relacionados solamente con plataforma
9. probar que los participantes queden platform=psn
10. verificar que aparezcan partidos entre rivales

## Resultado esperado

Después de "Actualizar liga":

Participantes:
todos los participantes reales descubiertos

Plataforma:
PSN para todos

Partidos League:
debe representar todos los partidos conocidos de la Custom League,
no solamente los 9 partidos de yocoima_herrera.

Standings:
GP/W/L/RF/RA/DIFF deben salir del conjunto global deduplicado de partidos.

## Restricciones

- Mantener GitHub Pages.
- Mantener Cloudflare Worker.
- No agregar backend tradicional.
- No agregar base de datos todavía.
- No rediseñar UI salvo que sea necesario.
- No eliminar estadísticas de bateo/pitcheo.
- No mezclar Arena.
- No inventar league_id: la API disponible actualmente no entrega uno en los datos observados.

## Forma de trabajar

Antes de modificar código:

1. revisar el estado real del repositorio
2. explicar brevemente la causa encontrada
3. realizar cambios mínimos
4. probar la lógica
5. indicar exactamente qué archivos fueron modificados

No asumir que este documento refleja perfectamente el código actual:
el repositorio es la fuente de verdad.
