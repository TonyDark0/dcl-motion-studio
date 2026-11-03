# Componentes, modelos y procedencia

Este inventario registra procedencia; no sustituye las licencias originales.

- FFmpeg / FFprobe: <https://ffmpeg.org>. Herramientas externas del sistema para preparar videos; no se incluyen binarios en el proyecto. La licencia depende de la compilación (LGPL/GPL); la distribución con libx264 usada para H.264 puede estar bajo GPL. `setup:video` verifica la instalación y usa Winget/Gyan en Windows si falta. SDPose-OOD y RT-DETRv4 solo se evaluaron; no se redistribuye su código ni sus pesos.

- SOMAHand / SOMA-X (NVIDIA): <https://github.com/NVlabs/SOMA-X>. El recurso compacto `src/assets/somahand-prior.json` deriva del PCA de articulación y bind skeleton oficiales, bajo Apache-2.0; licencia incluida en `public/licenses/SOMA-X.txt`. Assets fijados en la revisión Hugging Face `104578ed58857f6faa7592fb83d0a2dad43c36fa`. Hash, extracción, conversiones y alcance de la adaptación en `docs/somahand-source-motion.md`. El ajuste a landmarks de Studio no incluye la malla ni la inferencia del modelo de identidad SOMAHand.

- `public/assets/Avatar.glb`: avatar base del proyecto, incluido en Git y en el ZIP por instrucción expresa del propietario. Se utiliza como referencia del rig y para exportar con avatar; la exportación de emote conserva su rig animado sin mallas. No contiene wearables importados desde una wallet. Los avisos de terceros aplicables a recursos originales no se sustituyen por las licencias de los modelos.
- Referencia Blender: `tests/fixtures/blender-rest.json` contiene matrices extraídas del `.blend` proporcionado, sin ejecutar scripts incluidos en ese documento.
- Decentraland UI2 3.23.3: <https://github.com/decentraland/ui2>, Apache-2.0; conservar el archivo de licencia incluido en el paquete instalado.
- Render de avatar DCL: referencias visuales y de comportamiento en `decentraland/marketplace` y el avatar preview renderer oficial de `decentraland/unity-explorer`, Apache-2.0. `src/dcl-rendering.ts` es una adaptación nativa a Three.js con `MeshToonMaterial`, gradiente de cuatro bandas y contorno de pantalla; no copia código ShaderLab/HLSL y conserva texturas y modos alpha del glTF.
- Three.js, React, Vite, Fastify, Zustand y Zod: dependencias abiertas con sus licencias conservadas por npm.
- ONNX Runtime Node 1.23.2: <https://github.com/microsoft/onnxruntime>, MIT.
- MediaPipe Tasks Vision 0.10.32 y Pose Landmarker: <https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker>. El paquete de código usa Apache-2.0; conservar la atribución y revisar la model card del archivo `.task` al redistribuirlo.
- MMPose/RTMW3D: <https://github.com/open-mmlab/mmpose>, Apache-2.0. El ONNX usado por el MVP proviene de `Soykaf/RTMW3D-x`, revisión `a4f0d54c52ee44ee4e1dda1936d714490c6234d2`, archivo `rtmw3d-x_8xb64_cocktail14-384x288-b0a0eab7_20240626.onnx`, SHA-256 `4a289c0e99d47eb595e99679d9d4a2d1def1b4241f9adcbafba44b9ff585ebcd`. Revisar las licencias de los datasets de entrenamiento antes de redistribuir pesos o usarlos comercialmente.
- SAM 3D Body DINOv3: <https://github.com/facebookresearch/sam-3d-body>, fuente fijada en `b5c765a0d89d789985e186d396315e7590887b94`. El checkpoint `facebook/sam-3d-body-dinov3`, revisión `11aaa346c7204874a1cbafe3d39a979080b2c55a`, está restringido y se rige por la licencia de Meta incluida con el proyecto/modelo; requiere acceso aprobado en Hugging Face. No se incluye en el repositorio ni se descarga sin el token del usuario.
- MoGe-2 ViT-S normal: <https://github.com/microsoft/MoGe>, fuente fijada en `74fbce054ebed49800de42d0ad0e83495065719a`; checkpoint público `Ruicheng/moge-2-vits-normal`. MoGe declara MIT y usa componentes con sus propias atribuciones. `utils3d-moge` queda fijado en `62f09d58509485564e24d5d9f6aac9ee9ebc0c37`.
- PyTorch 2.7.1 + CUDA 12.8 y torchvision 0.22.1 se instalan en un entorno aislado bajo `data/runtime/vision`; se aplican las licencias y avisos de PyTorch y de los paquetes Python instalados.
- BlendCap: <https://github.com/Arcomade/BlendCap>, GPL-3.0, se usó como referencia de arquitectura y de categorías de postproceso. Este proyecto no copia ni distribuye código de BlendCap: la reparación de fallos, el filtro de profundidad, la rigidización anatómica y el solver de dedos son una implementación nueva en TypeScript.
- kimodo.cpp: <https://github.com/localai-org/kimodo.cpp>, Apache-2.0 para el port y herramientas originales. El binario local se compiló desde `5679ff19ba0a522c0b0516e9a9d402fe1af2c027`; GGML y LLVM MinGW conservan sus licencias propias.
- Kimodo SOMA RP v1.1 GGUF: repositorio `LocalAI-io/Kimodo-SOMA-RP-v1.1-GGML`, revisión `65f8b8ab34ee7524161cc87b20ae4cb4f5d3a12d`. Archivo F32 SHA-256 `3bf1229f4c1eff1d28f5196a854113da2df9a11a5e21c60694630903bf948ee4`. El checkpoint SOMA usa NVIDIA Open Model License según su model card.
- Encoder `Llama-3-Kimodo-Q4_K_M.gguf`: repositorio `LocalAI-io/Llama-3-Kimodo-GGML`, revisión `3e8d958803beaddb6011ac534f2be972e2710c7d`, SHA-256 `c06f2cb6a7615e949bcbb5b582ad35a191338b68b5a51abe17d259ebe574c005`. Incluye material derivado de Meta Llama 3 y LLM2Vec; se aplican sus términos por separado. El tokenizer usado tiene SHA-256 `81614aca62a98846c02b72cc2e5378e5bdce8b4d507b88f96eb1faa90dae607e`.

No sustituir SOMA por el checkpoint Kimodo SMPL-X sin revisar sus términos: el proyecto kimodo.cpp documenta ese checkpoint como limitado a investigación y desarrollo internos. Los pesos SOMA, el encoder y RTMW3D no se incluyen en el ZIP fuente. Esta copia para Git incluye el avatar base y excluye videos/GLB de ejemplos del proyecto alojado y el modelo MediaPipe .task. Los archivos runtime de MediaPipe se conservan; setup:public descarga el modelo por separado.

Los paquetes transitivos y sus avisos se conservan mediante npm y `package-lock.json`.

## Alcance de la licencia de Studio

El código original se ofrece bajo Apache-2.0; ver LICENSE y NOTICE. Los pesos y los componentes externos no se relicencian. Built with Meta Llama 3. La matriz revisada de modelos y datos y requisitos DCL está en [docs/LICENSING.md](docs/LICENSING.md).

## Grabaciones de demostración

Los archivos de docs/media registran ejemplos ya existentes de la landing. Se incluyen como documentación por solicitud del propietario; no son modelos, dependencias de ejecución ni datos de entrenamiento. El código de la landing y los GLB de esos ejemplos siguen separados. Véase docs/media/README.md para el alcance; la licencia Apache del código no sustituye los derechos sobre referencias de vídeo o recursos representados.
