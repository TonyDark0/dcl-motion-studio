# Licencias del código, los modelos y los recursos

Revisión: **2 de noviembre de 2026**. Propietario indicado: [TonyDark0](https://github.com/TonyDark0).

## Licencia elegida para la aplicación

El código original y la documentación técnica original de DCL Motion Studio se publican bajo **Apache-2.0**. Ver [LICENSE](../LICENSE) y [NOTICE](../NOTICE). Permite usar, modificar y redistribuir el código, incluido uso comercial, respetando sus condiciones y avisos. No obliga a que todos los derivados tengan código público. No concede derechos sobre marcas ni cambia las licencias de terceros.

La elección mantiene coherencia con los fragmentos derivados de NVIDIA Kimodo y kimodo.cpp, ambos registrados como Apache-2.0 en sus avisos. No se aplica una licencia nueva a material ajeno.

## Requisito de DCL y alcance de la comprobación

El [RFC del programa Regenesis](https://forum.decentraland.org/t/rfc-regenesis-grants-program-request-for-comments/25003) exige proyectos abiertos y disponibles públicamente. La fuente consultada no prescribe MIT o Apache como única opción. Apache-2.0 es una [licencia aprobada por OSI](https://opensource.org/license/apache-2.0), adecuada para ese criterio de apertura del código.

El [RFC de Season 2](https://forum.decentraland.org/t/rfc-regenesis-grants-season-2/25688), publicado el 30 de octubre, todavía recoge comentarios hasta el 6 de noviembre. No equivale a unas condiciones finales de adjudicación. Esta revisión no certifica elegibilidad ni presume que el programa acepte cualquier dependencia con términos propios.

La declaración precisa para una candidatura es: **el código de la herramienta es Apache-2.0; los motores y checkpoints externos conservan las licencias identificadas aquí, se instalan por separado y no se incluyen en el repositorio fuente**. No describir el sistema completo como un modelo de IA íntegramente abierto bajo Apache.

## Matriz de modelos y motores

| Componente usado                              | Términos identificados                                                       | Aplicación a esta distribución                                                                                                        |
| --------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| kimodo.cpp y parche Studio                    | Apache-2.0                                                                   | Conservar licencias, avisos y modificaciones. Se distribuye el parche, no los binarios.                                               |
| Kimodo SOMA RP v1.1 F32 GGUF                  | NVIDIA Open Model License                                                    | La model card oficial declara uso comercial. El cambio a GGUF no cambia sus términos. Pesos externos.                                 |
| Llama-3-Kimodo Q4_K_M y tokenizer             | Meta Llama 3 Community License; adaptadores LLM2Vec MIT                      | Encoder separado; conservar atribución, licencia y AUP de Meta. No es Apache-2.0.                                                     |
| MediaPipe Tasks Vision y Pose Landmarker Full | Código Tasks Apache-2.0; revisar términos/model card del modelo por separado | Runtime incluido con sus términos; `.task` se descarga aparte. No inferir licencia del peso únicamente por la del paquete.            |
| RTMW3D ONNX de Soykaf                         | Repositorio del peso declara Apache-2.0; fuente MMPose Apache-2.0            | Descarga externa fijada por revisión y hash. La declaración del publicador no demuestra permisos de todos los datos de entrenamiento. |
| SAM 3D Body DINOv3 (Pro)                      | SAM License de Meta                                                          | Acceso sujeto a condiciones del proveedor; preservar acuerdo y restricciones. No es una licencia OSI estándar. Integración opcional.  |
| MoGe-2 ViT-S normal                           | Model card MIT; MoGe MIT                                                     | Conservar aviso MIT y términos de componentes incorporados. Modelo externo.                                                           |
| Prior SOMAHand/SOMA-X                         | Apache-2.0 según el recurso registrado                                       | Conservar aviso NVIDIA, procedencia y licencia; no se incluye malla ni checkpoint de identidad.                                       |

Versiones exactas, revisiones y hashes usados por esta copia están en [THIRD_PARTY.md](../THIRD_PARTY.md), `scripts/setup-models.mjs` y `scripts/download-pro-models.py`. La instalación de Pro tiene proveedores y términos adicionales; comprobar el conjunto instalado, incluido DINOv3, antes de redistribuir un entorno o imagen con esos componentes. La licencia SAM no sustituye automáticamente la de componentes que se obtengan aparte.

### Fuentes de los modelos

- [Kimodo SOMA RP v1.1 oficial](https://huggingface.co/nvidia/Kimodo-SOMA-RP-v1.1) y [conversión GGUF](https://huggingface.co/LocalAI-io/Kimodo-SOMA-RP-v1.1-GGML): permiso comercial declarado y licencia NVIDIA. Su dataset Rigplay es propietario; licencia comercial del modelo no equivale a acceso ni permiso para redistribuir ese dataset.
- [Encoder convertido](https://huggingface.co/LocalAI-io/Llama-3-Kimodo-GGML) y [acuerdo Meta Llama 3](https://huggingface.co/meta-llama/Meta-Llama-3-8B-Instruct): requieren atribución, conservación de avisos y cumplimiento de su política de uso; incluyen condiciones adicionales para determinados operadores a gran escala. En el README se incluye **Built with Meta Llama 3**. Las obligaciones no desaparecen por usar el encoder localmente o no incluirlo en Git.
- [RTMW3D ONNX](https://huggingface.co/Soykaf/RTMW3D-x): Apache-2.0 declarado por quien publica la conversión.
- [SAM License](https://huggingface.co/facebook/sam-3d-body-dinov3/blob/main/LICENSE): permite usos y distribución sujetos al acuerdo, con restricciones de uso y obligación de adjuntarlo cuando se distribuyan sus materiales. Copia informativa en `licenses/SAM-LICENSE.txt`.
- [MoGe-2](https://huggingface.co/Ruicheng/moge-2-vits-normal): metadatos MIT; copia del aviso del código en `licenses/MOGE-MIT.txt`.

No sustituir el checkpoint SOMA por **Kimodo SMPL-X RP** como si fueran equivalentes: el [port documenta restricciones de investigación interna y de redistribución](https://github.com/localai-org/kimodo.cpp). No está instalado por el setup de Studio.

## Dependencias de interfaz y multimedia

`licenses/direct-dependencies.json` registra versiones y declaraciones de licencia de las dependencias npm directas instaladas durante esta preparación. Es un inventario parcial, no una auditoría transitiva completa.

GSAP pertenecía a la landing del proyecto alojado. Fue retirado del código, package.json y lockfile de esta distribución local; su licencia no es una dependencia del repositorio local.

FFmpeg/FFprobe son programas externos. Su licencia depende de la compilación y de los codecs; no se incluyen binarios. Las fuentes y otros recursos suministrados por paquetes de UI conservan sus condiciones. El permiso del código del paquete no debe usarse para inventar derechos sobre una fuente tipográfica.

## Avatar, entradas, salidas y futuros datasets

- El avatar base del proyecto se incluye en Git y en el ZIP por instrucción del propietario. Los ejemplos GLB/vídeo del proyecto alojado permanecen excluidos. Los recursos de terceros conservan sus avisos; ninguna licencia de los modelos se aplica automáticamente al avatar ni a los wearables de una wallet.
- No se asigna automáticamente Apache, CC0 ni exclusividad a las animaciones exportadas. Derechos sobre referencias, avatares y material de terceros siguen siendo relevantes.
- La licencia del software no autoriza entrenar con emotes ya publicados por otros creadores. Cualquier dataset propio necesita permisos o licencias que cubran el uso propuesto, con procedencia y alcance registrados.
- Un consentimiento del beta tester cubre únicamente lo que esa persona tiene derecho a autorizar y lo indicado en el aviso; no concede derechos sobre material ajeno.
- No se ha verificado consentimiento individual de todo el entrenamiento original a partir de las licencias. No usar esta matriz como prueba para la regla de contenido IA de r/godot.

## Conclusión para publicación

La licencia del código original queda resuelta como Apache-2.0. Los checkpoints permanecen fuera del ZIP y de Git, con instalación desde sus proveedores. Antes de afirmar que toda la cadena cumple requisitos de apertura de una convocatoria, contrastar sus términos finales con estas dependencias; quedan especialmente visibles términos de modelos Meta. Este documento registra alcance y pendientes, sin cambiar las licencias de esos proveedores.
