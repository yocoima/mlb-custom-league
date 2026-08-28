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
- exige el mínimo oficial de MLB (regla 9.22) para liderar AVG/OBP/SLG/OPS y ERA: 3.1 turnos al plato y 1 entrada lanzada por cada juego jugado por ese jugador; los líderes de conteo (HR, H, RBI, SB, SO, SV) no requieren mínimo;
- muestra un panel resumido de líderes y un historial manual de campeones;
- permite finalizar una temporada y archivar automáticamente campeón, final y ganadores de AVG, HR, H, RBI, SB, SO, ERA y SV;
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
5. el juego debe haber terminado formalmente: `ruling = 0`, marcador no empatado y resultado oficial `W/L`;
6. un juego que supera las entradas reglamentarias debe haber estado empatado al finalizar la última de ellas;
7. `player_id` verifica la identidad y `game_uuid` identifica el partido globalmente.

El Game ID semilla es una validación opcional: si se indica, debe aparecer dentro de la liga configurada. Si dos ligas comparten exactamente participantes, equipos y fechas, la API pública no permite distinguirlas automáticamente.

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

Pégala en **Configuración -> URL del Cloudflare Worker / proxy**.

## Publicar y actualizar la liga para todos

El frontend guarda un snapshot público con configuración, participantes, partidos y estadísticas en Workers KV. Los visitantes lo cargan automáticamente mediante `GET /api/league`.

Hay dos niveles de operación:

- cualquier visitante puede pulsar **Actualizar liga**; el navegador busca candidatos nuevos y `POST /api/league/refresh` hace que el Worker vuelva a consultar el Game Log oficial antes de agregarlos al snapshot compartido;
- solamente el comisionado puede cambiar nombre del torneo, comisionado, roster, fecha inicial, innings, campeones o iniciar otra temporada mediante el `POST /api/league` protegido.

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

## Iniciar un torneo nuevo

1. En **Configuración**, pulsa **Nueva temporada**.
2. Cambia el nombre del torneo, comisionado, participantes/equipos, fecha inicial e innings reglamentarios.
3. Guarda la configuración.
4. Pulsa **Publicar liga** e introduce la clave privada.

La publicación inicial puede tener cero juegos. Desde ese momento todos reciben la nueva configuración y cualquiera puede incorporar los primeros resultados con **Actualizar liga**. El historial de campeones se conserva como punto de partida y puede editarse antes de publicar.

## Finalizar un torneo

El botón **Finalizar torneo** está disponible cuando existen partidos y todos sus Game Logs fueron cargados correctamente:

1. selecciona campeón y, opcionalmente, subcampeón, resultado y una nota;
2. revisa la vista previa de los lideratos;
3. pulsa **Confirmar y publicar** e introduce la clave privada.

El cierre guarda automáticamente los ganadores de promedio, jonrones, hits, impulsadas, bases robadas, ponches, efectividad y salvados. Los empates se archivan como co-líderes. Después de publicar el cierre, la temporada queda bloqueada para juegos nuevos y permanece visible en **Campeones**. Para continuar se debe crear y publicar una **Nueva temporada**.

## Historial de campeones

La API no identifica temporadas ni campeones. El botón **Finalizar torneo** genera automáticamente la entrada completa; el JSON de **Configuración -> Historial de campeones** se mantiene para corregir o importar registros históricos manuales. La lista se ordena del torneo más reciente al más antiguo:

```json
[
  {
    "season": "Torneo agosto 2026",
    "champion": "Usuario campeón",
    "team": "Equipo MLB",
    "runnerUp": "Subcampeón",
    "result": "4-2",
    "note": "Comentario opcional"
  }
]
```

Después de guardar la configuración, pulsa **Publicar liga** para que el campeón y el historial queden disponibles para todos.

La clave solo se mantiene durante esa petición. No se guarda en `localStorage`, KV ni GitHub. Workers KV está optimizado para lecturas y sus cambios pueden tardar hasta aproximadamente 60 segundos en propagarse globalmente.

El Worker permite estas rutas:

- `/api/history`
- `/api/game-log`
- `/api/league` (`GET` público y `POST` protegido)
- `/api/league/refresh` (`POST` público con verificación oficial y configuración inmutable)

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
- La sincronización puede requerir más páginas si un participante tiene mucha actividad.
