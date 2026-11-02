import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { motionSchema, type Motion } from '../src/motion';
import { compileConstraints, type Constraint } from './kimodo-constraints';
import { supportsConstraints } from './engine-capabilities';
import { type ReferenceRequest } from '../src/pose-reference';
import { videoPoseConstraints, preserveVideoRoot } from './video-pose-constraints';
import type { Capture } from '../src/video-motion';
import { imagePoseConstraints } from './image-pose-constraints';
import { generationPrompt, type EmoteStyle } from '../src/emote-style';
import { REFERENCE_POSE_STRIDE } from '../src/pose-sampling';
import { postprocessVideoMotion } from './video-postprocess';
export { supportsConstraints } from './engine-capabilities';
export type GenerationRequest = {
  prompt: string;
  emoteStyle?: EmoteStyle;
  frames: number;
  seed: number;
  steps: number;
  constraints?: Constraint[];
  referencePoses?: ReferenceRequest;
  videoReference?: Capture;
  loop?: boolean;
  rootMotion?: 'inPlace' | 'source';
};
export type EngineConfig = {
  executable: string;
  model: string;
  text: string;
  device: 'cpu' | 'vulkan';
};
export const emptyConfig: EngineConfig = { executable: '', model: '', text: '', device: 'vulkan' };
export function engineStatus(c: EngineConfig) {
  const missing = (['executable', 'model', 'text'] as const).filter(
    (k) => !c[k] || !existsSync(c[k]),
  );
  return { configured: !missing.length, missing, device: c.device };
}
export class KimodoWorker {
  child: ChildProcessWithoutNullStreams | null = null;
  key = '';
  pending: ((line: string) => void) | null = null;
  tail = '';
  epoch = 0;
  stop() {
    this.epoch++;
    this.child?.kill();
    this.child = null;
    this.pending?.('ERR\tGeneración cancelada');
    this.pending = null;
  }
  async generate(
    config: EngineConfig,
    request: GenerationRequest,
    directory: string,
  ): Promise<Motion> {
    if (this.child && JSON.stringify(config) !== this.key) this.stop();
    const epoch = this.epoch;
    const check = () => {
      if (epoch !== this.epoch) throw Error('Generation cancelled');
    };
    if (
      (request.loop ||
        request.constraints?.length ||
        request.referencePoses ||
        request.videoReference) &&
      !(await supportsConstraints(config.executable))
    )
      throw Error(
        'This Kimodo executable does not support native constraints. Configure the Studio constraints build.',
      );
    check();
    if ((request.loop || request.referencePoses) && request.constraints?.length)
      throw Error('Choose automatic loop or explicit constraints');
    if (request.loop && !request.referencePoses)
      throw Error('Loop animation requires a reviewed start image pose.');
    if (
      request.videoReference &&
      (request.loop || request.referencePoses || request.constraints?.length)
    )
      throw Error('Choose video references or image/explicit constraints.');
    const constraints = request.videoReference
      ? videoPoseConstraints(
          request.videoReference,
          request.frames,
          request.rootMotion !== 'source',
        )
      : request.referencePoses
        ? imagePoseConstraints(
            request.referencePoses,
            request.frames,
            !!request.loop,
            request.rootMotion !== 'source',
          )
        : request.constraints;
    const styledPrompt = generationPrompt(request.prompt, request.emoteStyle);
    const effectivePrompt = request.loop
      ? `${styledPrompt}\nCyclic movement, seamless looping animation, return to the starting pose.`
      : styledPrompt;
    const result = await this.run(
      config,
      { ...request, prompt: effectivePrompt, constraints },
      directory,
      check,
    );
    check();
    if (result.skeleton === 'soma30') {
      if (request.videoReference && constraints)
        preserveVideoRoot(result, request.videoReference, constraints);
      result.prompt = request.prompt;
      result.generation = constraints?.length
        ? {
            conditioning: 'soma30-v1',
            ...(request.videoReference
              ? {
                  video: {
                    provider: request.videoReference.source,
                    poseStride: REFERENCE_POSE_STRIDE,
                    poseSpace: 'dcl-fk-to-soma-v1' as const,
                    file: request.videoReference.metadata.file,
                    rootSpace: 'camera-y-up-v2' as const,
                  },
                }
              : {}),
            loop: !!request.loop,
            rootMotion: request.rootMotion ?? 'inPlace',
          }
        : undefined;
      if (request.videoReference && result.generation?.video)
        result.generation.video.cleanup = postprocessVideoMotion(result, request.videoReference);
    }
    await writeFile(path.join(directory, 'motion.json'), JSON.stringify(result));
    return result;
  }
  private async run(
    config: EngineConfig,
    request: GenerationRequest,
    directory: string,
    check: () => void,
  ): Promise<Motion> {
    if (!engineStatus(config).configured)
      throw Error('Configura el ejecutable kmd-generate y los dos modelos antes de generar.');
    await mkdir(directory, { recursive: true });
    const promptPath = path.join(directory, 'prompt.txt');
    await writeFile(promptPath, request.prompt, 'utf8');
    let protocol = `1\t${request.steps}\t${request.seed}\t${directory}\t${request.frames}\t${promptPath}\n`;
    if (request.constraints?.length) {
      const { observed, mask, firstHeading } = compileConstraints(
        request.constraints,
        request.frames,
      );
      const observationPath = path.join(directory, 'observed.f32'),
        maskPath = path.join(directory, 'mask.f32');
      const encode = (values: Float32Array) => {
        const b = Buffer.alloc(values.length * 4);
        values.forEach((v, i) => b.writeFloatLE(v, i * 4));
        return b;
      };
      await writeFile(observationPath, encode(observed));
      await writeFile(maskPath, encode(mask));
      await writeFile(
        path.join(directory, 'constraints.json'),
        JSON.stringify(request.constraints),
      );
      protocol = `C1\t${request.steps}\t${request.seed}\t${directory}\t${request.frames}\t${promptPath}\t${firstHeading}\t${observationPath}\t${maskPath}\n`;
    }
    check();
    const key = JSON.stringify(config);
    if (this.child && key !== this.key) this.stop();
    if (!this.child) {
      this.key = key;
      this.tail = '';
      const child = spawn(config.executable, ['--server', config.model, config.text], {
        windowsHide: true,
        env: {
          ...process.env,
          KIMODO_BACKEND: config.device,
          KIMODO_TEXT_LAYER_CHUNK: '8',
          KIMODO_TEXT_RESIDENT_LIMIT_MIB: '4096',
        },
        stdio: 'pipe',
      });
      this.child = child;
      createInterface({ input: child.stdout }).on('line', (line) => {
        if (this.child === child && (line.startsWith('OK\t') || line.startsWith('ERR\t')))
          this.pending?.(line);
      });
      child.stderr.on('data', (d) => {
        this.tail = (this.tail + d.toString()).slice(-2000);
      });
      child.on('error', (e) => {
        if (this.child === child) {
          this.child = null;
          this.pending?.('ERR\t' + e.message);
        }
      });
      child.on('exit', (code) => {
        if (this.child === child) {
          this.child = null;
          this.pending?.('ERR\tMotor finalizado (' + code + '): ' + this.tail.slice(-500));
        }
      });
    }
    const line = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = null;
        this.stop();
        reject(Error('El motor superó 15 minutos. Revisa los modelos y el dispositivo.'));
      }, 900000);
      this.pending = (s) => {
        clearTimeout(timer);
        this.pending = null;
        resolve(s);
      };
      this.child!.stdin.write(protocol, (error) => {
        if (error) this.pending?.('ERR\t' + error.message);
      });
    });
    if (!line.startsWith('OK\t')) throw Error(line.slice(4));
    const [, f, j] = line.split('\t');
    if (Number(j) !== 30 || Number(f) !== request.frames)
      throw Error('Se esperaba SOMA de 30 articulaciones con el número de frames solicitado.');
    const floats = async (file: string) => {
      const b = await readFile(path.join(directory, file));
      if (b.length % 4) throw Error('Salida binaria incompleta');
      return Array.from({ length: b.length / 4 }, (_, i) => b.readFloatLE(i * 4));
    };
    const motion = motionSchema.parse({
      version: 1,
      skeleton: 'soma30',
      fps: 30,
      frames: Number(f),
      prompt: request.prompt.slice(0, 2000),
      seed: request.seed,
      source: 'kimodo.cpp',
      roots: await floats('root_positions.f32'),
      rotations: await floats('local_rotations_xyzw.f32'),
    });
    return motion;
  }
}
