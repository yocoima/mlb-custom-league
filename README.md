# MLB The Show 26 — Custom League Manager V2

Dashboard web independiente dedicado **solo a Custom League**.

## Qué hace

- consulta `Game History` con `mode=all`;
- filtra localmente únicamente `game_mode === "LEAGUE"`;
- usa un roster inicial y una fecha de inicio configurados por el comisionado;
- consulta únicamente los historiales de esos participantes, todos PSN;
- exige que ambos participantes conserven el equipo configurado;
- obtiene `player_id` desde `Game Log` para verificar identidades;
- deduplica el mismo partido globalmente mediante `game_uuid`;
- calcula standings: GP, W, L, PCT, RF, RA, DIFF y forma reciente;
- carga `Game Log` bajo demanda para estadísticas de bateo y pitcheo;
- no utiliza cookies, contraseñas, inventario, programas, Diamond Dynasty ni Arena.

## Por qué se usa `mode=all`

La documentación de MLB The Show 26 enumera los modos de Game History como `all`, `arena` y `exhibition`. `LEAGUE` aparece en los registros como valor de `game_mode`, pero no como filtro documentado de la consulta. Por eso la aplicación pide `all` y filtra `LEAGUE` en JavaScript.

## Cómo separa una Custom League

La API pública no expone `league_id`, nombre de liga ni roster oficial. Para evitar mezclar todas las partidas League de una cuenta, la aplicación usa una liga configurada localmente:

1. fecha inicial de la temporada;
2. roster `usuario -> equipo MLB`;
3. ambos jugadores deben pertenecer al roster;
4. ambos deben usar el equipo asignado;
5. `player_id` verifica la identidad y `game_uuid` identifica el partido globalmente.

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

El Worker solo permite dos rutas:

- `/api/history`
- `/api/game-log`

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
