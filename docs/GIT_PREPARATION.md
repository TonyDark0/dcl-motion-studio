# Preparación para Git: Project 1 — Local Studio

Revisión: 2 de noviembre de 2026. Cuenta prevista: [TonyDark0](https://github.com/TonyDark0).

## Alcance corregido

Esta carpeta contiene exclusivamente la distribución local. Las primeras copias ZIP mezclaban la aplicación con el demo alojado y quedan sustituidas por `dcl-motion-studio-local-2026-11-02-apache.zip`.

Incluye React/Three.js, Fastify y SQLite locales, generación Kimodo, tracking Fast/Pro local, revisión, IK, timeline, exportación GLB, configuración y documentación. `/` abre el editor; `/app` sigue funcionando y `/docs` contiene la guía local.

Se retiraron la landing y sus componentes/recursos, GSAP y su entrada del lockfile, el worker del pod, Docker, Vercel, API de nube, R2/Redis, las variables de campaña, la analítica, la verificación de acceso al demo y los adaptadores remotos de generación. También se retiraron pruebas y scripts exclusivos de ese segundo proyecto. No se desactivaron ni modificaron los despliegues reales.

El servidor conserva las sesiones locales y las migraciones históricas de la base de datos, sin habilitar la recopilación de valoraciones o dataset. El código original del producto en `outputs` permanece intacto.

## Licencias

Código original y documentación técnica original: **Apache-2.0**, con LICENSE y NOTICE. Pesos y recursos de terceros mantienen sus términos; ver [LICENSING.md](LICENSING.md). GSAP no forma parte de esta distribución local.

## Archivos excluidos

Credenciales, datos/proyectos de usuarios, logs, entornos Python, ejecutables y bibliotecas nativas compiladas, pesos, resultados y dependencias npm. El avatar base public/assets/Avatar.glb se incluye en Git y en el ZIP por instrucción del propietario. No es un dato de usuario ni un checkpoint.

El runtime de MediaPipe incluido conserva sus términos. El pose model se instala con `setup:public`, usando SHA-256. Los demás modelos tienen setup separado. Instalar paquetes y modelos requiere Internet; la inferencia se ejecuta localmente. La carga opcional de avatar por wallet consulta Decentraland.

## Validación realizada

Comprobación desde una extracción nueva del ZIP en `work/local-install-audit-20261102/dcl-motion-studio`, sin reutilizar node_modules ni datos/configuración del proyecto original:

- `npm ci --no-audit --no-fund`: aprobado, 392 paquetes instalados desde el lockfile.
- `npm run build:local`: TypeScript y Vite aprobados; queda un aviso de tamaño del bundle, no un fallo de compilación.
- `npm test -- --maxWorkers=1`: **161 pruebas aprobadas, 28 archivos**, sin fallos. Las tres pruebas de vídeo que fallaron en la revisión anterior ahora pasan en esta ejecución. No se atribuye retrospectivamente una causa no demostrada al fallo anterior.
- `npm run setup:public`: descarga real de MediaPipe y SHA-256 verificados.
- Los cuatro archivos de `setup:models` responden HTTP 200 y sus tamaños coinciden con el manifiesto. No se descargaron nuevamente los 6.6 GB completos ni se verificaron de nuevo sus hashes en esta auditoría.
- `npm start`: servidor limpio iniciado sin .env; `/`, `/app`, `/docs`, `/assets/Avatar.glb` y `/api/health` responden HTTP 200. Health informa correctamente que faltan ejecutable y modelos en esta extracción limpia; no confunde servidor iniciado con generación disponible.
- FFmpeg y FFprobe ejecutan correctamente en el entorno de prueba; las pruebas incluyen preparación/streaming de vídeo.
- No se ejecutaron un build nativo desde cero, generación real, pruebas GPU/Pro o E2E en esta extracción. Esos pasos siguen pendientes de validación integral.
- Revisión del manifiesto fuente: sin GSAP, infraestructura de nube, pesos ni credenciales privadas en el ZIP; el avatar base está incluido.

Repositorio de publicación: [TonyDark0/dcl-motion-studio](https://github.com/TonyDark0/dcl-motion-studio). La publicación incluye exclusivamente esta distribución local; no altera el presupuesto ni el endpoint de Runpod.

## Pendiente de publicación

El usuario no necesita aportar otro avatar: el base está incluido. Conservar las licencias de cada modelo y confirmar las condiciones finales de la convocatoria DCL antes de declarar elegibilidad completa. El código Apache-2.0 no relicencia los modelos.

## Revisión editorial de documentación

Las guías funcionales se reescribieron para explicar el proceso actual, sin relatos de errores antiguos, comparativas antes/después ni resultados de una máquina presentados como garantías. El índice distingue funciones, procesos internos, propuestas no implementadas y registros de licencia/validación. Se contrastaron en código el muestreo de referencias de 10 frames, los dos anclajes intermedios de imagen y la diferencia entre el límite de edición de 10 segundos y el esquema persistente de hasta 120 segundos. Esta revisión modifica documentación; no altera los algoritmos ni añade funciones.

La revisión de primer uso añadió una guía de botones, resultados esperados, guardado/exportación, glosario y diagnóstico. Corrigió el orden de configuración: guardar las rutas de modelos antes de activar Studio Constraints. El build nativo ahora incluye comandos PowerShell con rutas y prerrequisitos explícitos. La auditoría posterior verificó dependencias, compilación, arranque y pruebas desde una extracción limpia, según el registro anterior. El motor todavía requiere un entorno C++23; no se declara validada la instalación integral hasta realizar también el build nativo y la primera generación.

## Inclusión del avatar base

Por instrucción del propietario, public/assets/Avatar.glb forma parte del repositorio y del ZIP. Se retiró su exclusión de Git y el requisito de buscar un avatar externo. La wallet sigue siendo una visualización opcional: Export GLB utiliza el avatar base; Export emote utiliza su rig animado sin mallas.

## Revisión de instalación y modelos

Se añadió MODELS_AND_RUNTIMES.md con la función, ubicación y comando de instalación de cada componente, requisitos CPU/GPU y límites de verificación. Se corrigió la detección de Python 3.11 del instalador Pro cuando ya existe un launcher de otra versión, con reinicio explícito de terminal después de instalar. MoGe dejó de descargarse desde main y usa una revisión fija comprobada en el proveedor. Estos cambios del instalador Pro se revisaron estáticamente; no se instalaron su entorno ni checkpoints durante la auditoría.

## Actualización de ayuda local y ejemplos

La ayuda integrada /docs se actualizó para describir el código local ya publicado, sin anuncios de una publicación futura ni instrucciones de valoraciones/dataset del demo. Las traducciones conservan pasos, tablas y notas; campos sin traducción usan el original inglés vigente. Las correcciones de texto local tienen una fuente persistente en local-docs.json para que el build no las sobrescriba. Los instaladores Node cargan el .env del proyecto y conservan la prioridad de variables del proceso.

Se incluyeron cuatro grabaciones de los ejemplos existentes de la landing en docs/media, con vistas previas para el README. Son recursos de documentación; no se incorporaron la landing, sus dependencias ni nuevos trabajos de inferencia.

Validación de esta actualización: build local aprobado; 169 pruebas aprobadas en 30 archivos, incluidas regresiones de estructura documental para los siete idiomas y carga/herencia de .env. Comprobación en navegador de /docs en inglés y español: cinco pasos de instalación y tabla de modelos conservados. No se ejecutó inferencia nueva ni se redeplegó la web alojada.
