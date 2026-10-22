# MLB The Show 26 — Custom League Manager V2

Dashboard web independiente dedicado **solo a Custom League**.

## Qué hace

- consulta `Game History` con `mode=all`;
- filtra localmente únicamente `game_mode === "LEAGUE"`;
- usa un roster inicial y una fecha de inicio configurados por el comisionado;
- consulta únicamente los historiales de esos participantes, todos PSN;
- exige que ambos participantes conserven el equipo configurado;
- valida la cantidad de entradas reglamentarias y conserva extra innings legítimos;
- obtiene `player_id` desde `Game Log` para verificar identidades;
- deduplica el mismo partido globalmente mediante `game_uuid`;
- calcula standings: GP, W, L, PCT, RF, RA, DIFF y forma reciente;
- carga `Game Log` incrementalmente para estadísticas de bateo y pitcheo;
- ordena líderes por AVG, HR, hits, RBI, bases robadas, OPS, ponches, ERA, K/9, victorias y salvados;
- exige mínimos proporcionales para liderar AVG/OBP/SLG/OPS y ERA: parte de 3.1 apariciones y 1 entrada por juego del equipo en formato de 9 innings, escaladas a las entradas reglamentarias del torneo; los líderes de conteo (HR, H, RBI, SB, SO, SV) no requieren mínimo;
- muestra un panel resumido de líderes y un historial automático de campeones;
- permite buscar jugadores y filtrar bateo o pitcheo por manager y equipo MLB;
- administra varios torneos independientes sin reemplazar los anteriores;
- separa ronda regular y postemporada, con tabla y estadísticas propias para cada fase;
- permite finalizar la ronda regular, seleccionar clasificados y archivar automáticamente sus lideratos;
- permite corregir marcadores o estadísticas mediante ajustes administrativos auditables;
- permite finalizar una temporada y archivar automáticamente campeón, final y ganadores de AVG, HR, H, RBI, SB, SO, ERA y SV de ambas fases;
- adapta navegación, tarjetas y standings para pantallas de teléfono;
- no utiliza cookies, contraseñas, inventario, programas, Diamond Dynasty ni Arena.

## Por qué se usa `mode=all`

La documentación de MLB The Show 26 enumera los modos de Game History como `all`, `arena` y `exhibition`. `LEAGUE` aparece en los registros como valor de `game_mode`, pero no como filtro documentado de la consulta. Por eso la aplicación pide `all` y filtra `LEAGUE` en JavaScript.

## Cómo separa una Custom League

La API pública no expone `league_id`, nombre de liga ni roster oficial. Para evitar mezclar todas las partidas League de una cuenta, la aplicación usa una liga configurada localmente:

1. fecha inicial de la temporada;
2. roster `usuario -> equipo MLB`;
3. ambos jugadores deben pertenecer al roster;
4. ambos deben usar el equipo asignado;
5. el juego debe tener marcador no empatado y resultado oficial `W/L`; si terminó por desconexión o concesión (`ruling != 0`), debe haber alcanzado al menos 5 entradas (o todas las reglamentarias si el torneo es más corto);
6. un juego que supera las entradas reglamentarias debe haber estado empatado al finalizar la última de ellas;
7. `player_id` verifica la identidad y `game_uuid` identifica el partido globalmente.

Si dos ligas comparten exactamente participantes, equipos y fechas, la API pública no permite distinguirlas automáticamente. Por eso cada torneo requiere una fecha inicial y un roster correcto; ya no se solicita un Game ID semilla.

### Ejemplo de roster

```json
{
  "yocoima_herrera": "Tigers",
  "Gaboandres20": "Diamondbacks",
  "LeyP9": "Red Sox"
}
```

Para nombres históricos o alternativos también se admite la forma extendida:

```json
{
  "Hanscristians": {
    "team": "Dodgers",
    "aliases": ["HansCristians88"]
  }
}
```

## Ejecutar localmente

```bash
npm test
npm run serve
```

Abre `http://localhost:8080`.

## CORS y Cloudflare Worker

Si el navegador bloquea las llamadas directas a `mlb26.theshow.com`, despliega `worker.js`:

```bash
npx wrangler login
npm run deploy:worker
```

Wrangler mostrará una URL similar a:

```text
https://mlb26-custom-league-proxy.<tu-subdominio>.workers.dev
```

La aplicación publicada ya utiliza automáticamente el Worker configurado en el proyecto; no es necesario introducir su URL en la interfaz.

## Publicar y actualizar la liga para todos

El frontend guarda cada torneo como un snapshot público independiente con configuración, participantes, partidos y estadísticas en Workers KV. Los visitantes cargan el índice mediante `GET /api/leagues` y el torneo seleccionado mediante `GET /api/leagues/:id`.

Hay dos niveles de operación:

- cualquier visitante puede pulsar **Actualizar liga**; el navegador busca candidatos nuevos y `POST /api/leagues/:id/refresh` hace que el Worker vuelva a consultar el Game Log oficial antes de agregarlos al torneo seleccionado;
- solamente el comisionado puede publicar configuración, cerrar fases, aplicar correcciones, finalizar un torneo o crear otro mediante `POST /api/leagues/:id`, protegido con la clave privada.

Configuración inicial, una sola vez:

```bash
npx wrangler login
npx wrangler kv namespace create LEAGUE_STORE
```

Si el OAuth del navegador falla, crea un API Token con el template **Edit Cloudflare Workers**, copia `.env.example` como `.env` y completa `CLOUDFLARE_ACCOUNT_ID` y `CLOUDFLARE_API_TOKEN`. El archivo `.env` está ignorado por Git y Wrangler lo carga automáticamente:

```bash
npx wrangler whoami
npx wrangler kv namespace create LEAGUE_STORE
```

Copia el `id` devuelto por Wrangler y habilita el bloque `[[kv_namespaces]]` de `wrangler.toml`. Después configura una clave privada; Wrangler la solicita de forma interactiva y no debe escribirse en ningún archivo:

```bash
npx wrangler secret put LEAGUE_PUBLISH_TOKEN
npm run deploy:worker
```

En la aplicación:

1. configura el torneo y guarda;
2. pulsa **Actualizar liga** para obtener los juegos y estadísticas disponibles;
3. pulsa **Publicar liga** e introduce la clave privada.

Cuando haya partidos nuevos, cualquier amigo puede pulsar **Actualizar liga**. No necesita la clave ni modificar Configuración: la actualización aceptada queda guardada para todos. **Recargar estadísticas** solo reintenta Game Logs que hayan fallado en el navegador actual; normalmente no es necesario porque **Actualizar liga** ya procesa los datos nuevos.

El Worker limita cada actualización pública a 25 candidatos y nunca confía en el marcador ni en las estadísticas enviados por el navegador. Verifica modo `LEAGUE`, UUID, roster, equipos, identidades, fecha, innings y finalización contra la API oficial antes de escribir en KV.

## Administrar varios torneos

Para borrar un torneo creado por error, selecciónalo y abre **Configuración → Eliminar liga**. Confirma el nombre e identificador y escribe la clave privada si está publicado. Se eliminan su snapshot (partidos, estadísticas e historial) y su entrada en el selector para todos; los demás torneos se conservan. Los borradores sin publicar se eliminan solamente de este navegador. La eliminación es permanente y puede tardar aproximadamente 60 segundos en propagarse.

1. En **Configuración**, pulsa **Nueva temporada**.
2. Indica un nombre. La aplicación genera un identificador estable para ese torneo sin sobrescribir los anteriores.
3. Cambia comisionado, participantes/equipos, fecha inicial e innings reglamentarios según corresponda.
4. Guarda y pulsa **Publicar liga** con la clave privada.

El selector **Torneo** permite cambiar entre torneos activos o finalizados. También se puede compartir un torneo específico con `?league=identificador`. La liga publicada antes de esta actualización se conserva automáticamente como `principal`; no hay que volver a cargarla.

## Calculadora de clasificación

La pestaña **Calculadora** consulta la ronda regular sin modificar ni publicar datos. Selecciona un equipo para consultar su situación, las victorias que aseguran el pase y las combinaciones suficientes de resultados que clasifican o eliminan al equipo. No incluye controles para introducir resultados hipotéticos ni porcentajes de probabilidad.

Con más de **8 partidos pendientes en toda la ronda**, solo muestra garantías generales; el análisis de combinaciones se habilita al llegar a ese límite. Las condiciones de ganadores que se muestran son suficientes y consideran todos los resultados no mencionados. Si solo se muestran algunas, la interfaz lo indica. Las combinaciones que todavía dependen de desempates por carreras se identifican como análisis parcial: no se presentan como un pase confirmado.

Cuando queda **un único partido pendiente en toda la ronda**, calcula condiciones exactas de carreras anotadas, carreras permitidas o margen de victoria para cada posible ganador. Si hay varios rivales empatados, indica cuántas condiciones deben cumplirse. Aplica el mismo orden que la tabla: PCT, RF descendente, RA ascendente y nombre en orden alfabético. Los marcadores futuros son enteros no negativos y el ganador anota más que el perdedor; no se impone un máximo de carreras.

Al cerrar la ronda regular, muestra los clasificados oficiales archivados; la postemporada no altera ese resultado. Sin formato o roster configurados, solicita completar la configuración.

## Ronda regular y postemporada

1. Durante la ronda regular, cualquier visitante puede usar **Actualizar liga**.
2. Cuando termine, pulsa **Finalizar ronda regular**.
3. Selecciona al menos dos clasificados y publica el cierre con la clave privada.
4. La tabla, estadísticas y lideratos regulares quedan congelados en el historial del torneo.
5. La postemporada comienza con tabla y estadísticas en cero. Solamente se consultan y aceptan partidos posteriores al cierre entre los clasificados elegidos.
6. El selector **Vista** permite volver a consultar la ronda regular sin mezclarla con la postemporada.

Los partidos de postemporada no modifican las posiciones ni los acumulados regulares. Desde el cierre de la ronda, **Campeones** muestra sus lideratos y mantiene el campeón como **por definir**, mientras el panel dorado conserva al último campeón oficial vigente. Al finalizar el torneo, esa misma entrada se completa con el nuevo campeón y los lideratos de postemporada. La numeración histórica es ascendente y no cambia cuando se agrega un torneo nuevo.

## Correcciones administrativas

El botón **Corregir datos** permite:

- reemplazar el marcador de un partido sin alterar el registro oficial original;
- sumar o restar una estadística de bateo o pitcheo a un jugador;
- aplicar la corrección a ronda regular o postemporada;
- eliminar posteriormente un ajuste.

Cada ajuste exige la clave privada, guarda fecha y motivo, y se publica para todos. El valor oficial no se borra: la aplicación conserva una lista auditable de ajustes y recalcula tabla, líderes y premios archivados. Los ajustes estadísticos son incrementos o decrementos enteros; para entradas lanzadas se usan outs (`3 = 1.0 IP`).

## Iniciar un torneo nuevo

1. En **Configuración**, pulsa **Nueva temporada**.
2. Introduce el nombre del nuevo torneo.
3. Cambia el comisionado, participantes/equipos, fecha inicial e innings reglamentarios.
4. Guarda la configuración.
5. Pulsa **Publicar liga** e introduce la clave privada.

La publicación inicial puede tener cero juegos. Desde ese momento todos reciben la nueva configuración y cualquiera puede incorporar los primeros resultados con **Actualizar liga**. Los torneos anteriores permanecen disponibles en el selector y en el historial general.

## Finalizar un torneo

El botón **Finalizar torneo** está disponible durante la postemporada cuando existen partidos y todos sus Game Logs fueron cargados correctamente:

1. selecciona campeón y, opcionalmente, subcampeón, resultado y una nota;
2. revisa la vista previa de los lideratos;
3. pulsa **Confirmar y publicar** e introduce la clave privada.

El cierre guarda automáticamente los ganadores de promedio, jonrones, hits, impulsadas, bases robadas, ponches, efectividad y salvados de la postemporada, junto con los lideratos ya congelados de la ronda regular. Los empates se archivan como co-líderes. Después de publicar el cierre, el torneo queda bloqueado para juegos nuevos y permanece visible en **Campeones** y en el índice general.

## Historial de campeones

La API no identifica temporadas ni campeones. **Finalizar ronda regular** archiva automáticamente sus lideratos y **Finalizar torneo** completa la entrada con campeón, final y premios de postemporada. No es necesario editar o copiar un JSON de campeones entre torneos: el Salón de Campeones general combina los snapshots publicados.

La clave solo se mantiene durante esa petición. No se guarda en `localStorage`, KV ni GitHub. Workers KV está optimizado para lecturas y sus cambios pueden tardar hasta aproximadamente 60 segundos en propagarse globalmente.

El Worker permite estas rutas:

- `/api/history`
- `/api/game-log`
- `/api/leagues` (`GET` público del índice de torneos)
- `/api/leagues/:id` (`GET` público, `POST` y `DELETE` protegidos)
- `/api/leagues/:id/refresh` (`POST` público con verificación oficial y configuración inmutable)
- `/api/league` y `/api/league/refresh` (alias compatibles para el torneo `principal`)

No maneja credenciales privadas y fuerza `mode=all` para Game History.

## Publicar el frontend en GitHub Pages

1. Sube estos archivos a un repositorio.
2. GitHub -> Settings -> Pages.
3. Source: `Deploy from a branch`.
4. Branch: `main`, carpeta `/ (root)`.
5. Guarda y abre la URL publicada.

## Limitaciones conocidas

- La API pública no expone un identificador de Custom League en los JSON de muestra usados para esta versión.
- Game Log de MLB The Show puede fallar para IDs válidos; la UI informa cobertura parcial.
- Un alias debe declararse en el roster si el nombre histórico difiere del usuario configurado.
- Si el participante ya tiene un `player_id` verificado, un nombre histórico distinto puede reconciliarse automáticamente cuando el equipo identifica a un único integrante del roster; el Game Log vuelve a validar el `player_id` antes de aceptar el partido.
- La sincronización puede requerir más páginas si un participante tiene mucha actividad.
- El campo `er` (carreras limpias) del Game Log oficial no siempre es confiable: se observaron pitching_stats con `r` (carreras totales) mayor que cero pero `er` en cero en el mismo box score. La app usa `er` tal como lo entrega la API, así que el ERA calculado puede subestimar carreras limpias reales en esos juegos puntuales. No es un error de esta aplicación; es una limitación de los datos que entrega MLB The Show 26.
