# MLB The Show 26 — Custom League Manager V2

Dashboard web independiente dedicado **solo a Custom League**.

## Qué hace

- consulta `Game History` con `mode=all`;
- filtra localmente únicamente `game_mode === "LEAGUE"`;
- usa un partido semilla para identificar la liga;
- detecta el equipo MLB fijo del usuario en esa liga;
- descubre rivales y sus equipos;
- intenta resolver automáticamente la plataforma de cada rival usando `Game Log`;
- recorre los historiales de los participantes;
- deduplica partidos por `game id`;
- calcula standings: GP, W, L, PCT, RF, RA, DIFF y forma reciente;
- carga `Game Log` bajo demanda para estadísticas de bateo y pitcheo;
- no utiliza cookies, contraseñas, inventario, programas, Diamond Dynasty ni Arena.

## Por qué se usa `mode=all`

La documentación de MLB The Show 26 enumera los modos de Game History como `all`, `arena` y `exhibition`. `LEAGUE` aparece en los registros como valor de `game_mode`, pero no como filtro documentado de la consulta. Por eso la aplicación pide `all` y filtra `LEAGUE` en JavaScript.

## Cómo separa una Custom League

En los JSON de muestra no aparece `league_id`. Para evitar mezclar todas las partidas League de una cuenta, la aplicación usa esta huella:

1. partido LEAGUE semilla;
2. usuario -> equipo MLB en ese partido;
3. para cada participante solo acepta partidas LEAGUE donde ese participante mantiene el mismo equipo MLB;
4. expande la red de rivales recursivamente.

Es una heurística. Si un jugador usa el mismo equipo MLB en dos Custom Leagues distintas, puede existir una colisión. En ese caso usa `Game ID semilla`, límites o el mapeo manual.

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

## Mapeo manual de plataforma

Si no se puede inferir la plataforma de un rival, agrega en Configuración:

```json
{
  "RivalVisible": {
    "username": "usuario_real_en_plataforma",
    "platform": "xbl"
  }
}
```

Plataformas válidas: `psn`, `xbl`, `mlbts`, `nsw`.

## Limitaciones conocidas

- La API pública no expone un identificador de Custom League en los JSON de muestra usados para esta versión.
- Game Log de MLB The Show puede fallar para IDs válidos; la UI informa cobertura parcial.
- Algunos usuarios tienen nombre universal distinto del nombre de su plataforma; por eso existe el mapeo manual.
- El descubrimiento automático puede requerir más páginas si un participante tiene mucha actividad.
