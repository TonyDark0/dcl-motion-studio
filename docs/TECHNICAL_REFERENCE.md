# Referencia técnica: distribución local

El punto de entrada React abre Studio en `/` y `/app`; la documentación de uso sigue en `/docs`. Vite sirve el frontend de desarrollo y redirige `/api` a Fastify en `127.0.0.1:8787`.

`server/index.ts` conserva sesiones de navegador, proyectos SQLite y los procesos locales de inferencia. No hay adaptador de ejecución remota, telemetría de campaña ni endpoints de aportación al dataset. Las migraciones conservan compatibilidad con bases históricas sin activar la recopilación.

Texto utiliza kimodo.cpp y pesos SOMA30, seguido de retarget al rig DCL. Video Fast combina MediaPipe en navegador y RTMW3D ONNX local; Pro utiliza el runtime Python con SAM 3D Body/MoGe. El seguimiento se revisa antes de enviar las constraints al proceso local de Kimodo. Manos y cuerpo conservan canales separados.

Documentación detallada:

- [Build nativo](../native/kimodo/README.md)
- [Constraints y retarget](retargeting-pipeline.md)
- [Captura Pro](pro-capture-pipeline.md)
- [Revisión de tracking](video-review-workspace.md)
- [Timeline por clips y capas](nla-editor.md)
- [Referencias de imagen](image-pose-references.md)
- [Avatar personalizado](custom-avatar.md)
- [Licencias](LICENSING.md)

No se promete retarget universal ni un consumo máximo de 4 GB de VRAM. El resultado requiere revisión, especialmente contactos de pies, oclusiones y desplazamiento monocular. Los pesos, el avatar y las herramientas nativas deben instalarse antes de generar.
