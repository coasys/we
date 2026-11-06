/**
 * Local AI, as the settings page displays it — the machine, the plan, an install's progress and the
 * running state, folded into display strings so the template renders fields rather than deriving them.
 *
 * Pure, next to `aiModelDraft.ts`, so the sentences are checkable without a store or a backend.
 */
import type {
  AiEndpoint,
  AiModelKind,
  LocalAiHardware,
  LocalAiPlan,
  LocalAiProgress,
  LocalAiRuntimeStatus,
  LocalAiStatus,
} from '@we/backend-shared';

import { MODEL_KIND_LABELS } from './aiModelDraft';

/** "3.1 GB", or "480 MB" below a gigabyte — never "0 MB" for something that has a size. */
export function sizeText(bytes: number): string {
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`;
}

const BACKEND_LABELS: Record<string, string> = {
  cpu: 'the CPU',
  metal: 'Metal',
  vulkan: 'Vulkan',
  cuda: 'CUDA',
  rocm: 'ROCm',
};

const backendLabel = (backend: string) => BACKEND_LABELS[backend] ?? backend;

const kindsText = (kinds: AiModelKind[]) => kinds.map((kind) => MODEL_KIND_LABELS[kind]).join(', ');

/** The machine in a line: its processor and memory. */
export function deviceText(hardware: LocalAiHardware): string {
  return `${hardware.cpu || hardware.arch} · ${sizeText(hardware.ramBytes)} memory`;
}

/** One line per GPU: "Test GPU · integrated · 4.0 GB", "Test GPU · unified memory". */
export function gpuText(gpu: LocalAiHardware['gpus'][number]): string {
  if (gpu.type === 'unified') return `${gpu.name} · unified memory`;
  return [gpu.name, gpu.type, gpu.vramBytes ? sizeText(gpu.vramBytes) : ''].filter(Boolean).join(' · ');
}

/** What the models would compute with: the best backend found besides the CPU, else the CPU. */
export function computeText(hardware: LocalAiHardware): string {
  const gpuBackends = hardware.backends.filter((backend) => backend !== 'cpu');
  return gpuBackends.length
    ? `Can run models on the GPU with ${gpuBackends.map(backendLabel).join(' or ')}`
    : 'Runs models on the CPU: no usable GPU was found';
}

/** A row of what an install brings: a model or a server program, and how big it is. */
export interface LocalAiPlanItem {
  key: string;
  label: string;
  name: string;
  sizeText: string;
  /** A model's licence and the memory it uses, which an install agrees to. Empty for a server program. */
  detail: string;
  /** Already downloaded. */
  done: boolean;
}

export function planItems(plan: LocalAiPlan): LocalAiPlanItem[] {
  return [
    ...plan.models.map((model) => ({
      key: `model:${model.kind}:${model.model}`,
      label: MODEL_KIND_LABELS[model.kind],
      name: model.model,
      sizeText: model.installed ? 'Downloaded' : sizeText(model.sizeBytes),
      detail: `${model.license} licence · uses ${sizeText(model.memoryBytes)} of memory`,
      done: model.installed,
    })),
    ...plan.runtimes.map((runtime) => ({
      key: `runtime:${runtime.id}`,
      label: 'Model server',
      name: `${runtime.id} ${runtime.version} · ${backendLabel(runtime.backend)}`,
      sizeText: runtime.installed ? 'Downloaded' : sizeText(runtime.sizeBytes),
      detail: '',
      done: runtime.installed,
    })),
  ];
}

/** "Downloads 3.1 GB · fits this device". */
export function planSummary(plan: LocalAiPlan): string {
  const download = plan.downloadBytes > 0 ? `Downloads ${sizeText(plan.downloadBytes)}` : 'Everything is downloaded';
  return `${download} · ${plan.fits ? 'fits this device' : 'does not fit this device'}`;
}

/**
 * What the plan was chosen by, where a reader would otherwise assume it was measured: the kinds
 * nothing was measured for on this class of device, which take the smallest model there is; and the
 * backend the node's settings hold it to, which the plan follows rather than the best one found.
 */
export function planNotes(plan: LocalAiPlan): string[] {
  const notes: string[] = [];
  const defaults = plan.models.filter((model) => model.basis === 'default');
  if (defaults.length) {
    const kinds = defaults.map((model) => MODEL_KIND_LABELS[model.kind].toLowerCase()).join(', ');
    notes.push(
      `No measurements exist for this class of device (${plan.hardwareClass}), so the plan takes the smallest model for ${kinds}`,
    );
  }
  if (plan.device) notes.push(`The node's settings hold local AI to ${backendLabel(plan.device)}`);
  return notes;
}

/**
 * Folds one progress event into the install's progress so far.
 *
 * A `plan` event starts an install over; otherwise the bytes done never go backwards within one
 * install, so an event that arrives late does not make the bar jump back.
 */
export function reduceProgress(prev: LocalAiProgress | null, event: LocalAiProgress): LocalAiProgress {
  if (!prev || event.phase === 'plan' || prev.phase === 'done' || prev.phase === 'failed') return event;
  if (event.totalBytes !== prev.totalBytes) return event;
  return { ...event, doneBytes: Math.max(prev.doneBytes, event.doneBytes) };
}

export interface LocalAiProgressView {
  /** 0–100, over everything the install downloads. */
  percent: number;
  text: string;
  failed: boolean;
}

export function progressView(progress: LocalAiProgress): LocalAiProgressView {
  const percent =
    progress.phase === 'done'
      ? 100
      : progress.totalBytes > 0
        ? Math.min(100, Math.round((progress.doneBytes / progress.totalBytes) * 100))
        : 0;
  const text = (() => {
    switch (progress.phase) {
      case 'plan':
        return 'Checking what to download';
      case 'download':
        // Every file is in: the backend starts the servers next, which for a large model takes a while
        // and sends no event of its own.
        if (progress.totalBytes > 0 && progress.doneBytes >= progress.totalBytes) return 'Starting the model servers';
        return progress.item
          ? `Downloading ${progress.item} — ${sizeText(progress.itemDoneBytes)} of ${sizeText(progress.itemTotalBytes)}`
          : 'Downloading';
      case 'start':
        return 'Starting the model servers';
      case 'register':
        return 'Registering the models';
      case 'done':
        return 'Installed';
      case 'failed':
        return progress.detail ? `The install failed — ${progress.detail}` : 'The install failed';
    }
  })();
  return { percent, text, failed: progress.phase === 'failed' };
}

/** A server program as its row says it: what it serves, how it runs, on what. */
export interface LocalAiRuntimeView {
  key: string;
  label: string;
  stateText: string;
  /** Running, and on the GPU where a GPU build was checked. */
  ok: boolean;
  /**
   * How the row is drawn: `success` running as it should; `idle` not running and nothing wrong —
   * never started, or stopped on purpose; `warning` anything else (starting, restarting, failed, or
   * running on the CPU when the GPU build found no device).
   */
  tone: 'success' | 'idle' | 'warning';
}

const PHASE_TEXT: Record<NonNullable<LocalAiRuntimeStatus['phase']>, string> = {
  starting: 'Starting',
  running: 'Running',
  restarting: 'Restarting',
  stopped: 'Stopped',
  failed: 'Failed',
};

export function runtimeView(runtime: LocalAiRuntimeStatus): LocalAiRuntimeView {
  const parts = [runtime.phase ? PHASE_TEXT[runtime.phase] : 'Not running'];
  if (runtime.phase === 'running' && runtime.onGpu === true) {
    parts.push(runtime.gpuBytes ? `on the GPU (${sizeText(runtime.gpuBytes)})` : 'on the GPU');
  }
  if (runtime.phase === 'running' && runtime.onGpu === false) parts.push('on the CPU: the GPU build found no device');
  if (runtime.restarts > 0) parts.push(`restarted ${runtime.restarts} ${runtime.restarts === 1 ? 'time' : 'times'}`);
  if (runtime.detail) parts.push(runtime.detail);
  const backend = runtime.build.split('-').pop() ?? '';
  const ok = runtime.phase === 'running' && runtime.onGpu !== false;
  const idle = (!runtime.phase || runtime.phase === 'stopped') && !runtime.detail;
  return {
    key: runtime.id,
    label: `${kindsText(runtime.kinds)} · ${runtime.id} ${runtime.version}${backend ? ` · ${backendLabel(backend)}` : ''}`,
    stateText: parts.join(' · '),
    ok,
    tone: ok ? 'success' : idle ? 'idle' : 'warning',
  };
}

/** Everything the "This device" section shows, from what the backend last said. */
export interface LocalAiView {
  /** The machine and the plan have been read. */
  loaded: boolean;
  device: string;
  gpus: string[];
  compute: string;
  budget: string;
  notes: string[];
  items: LocalAiPlanItem[];
  unavailable: string[];
  reasons: string[];
  /** How the plan was chosen, where it was not by measurement on this class of device. */
  planNotes: string[];
  fits: boolean;
  summary: string;
  /** "Install (2.5 GB)", or "Install the rest (2.5 GB)" where part of the plan is installed. */
  installLabel: string;
  /**
   * Something is installed. Not the whole plan: the backend installs one service by itself the first
   * time an app asks for its default model, and an install can name kinds — see `incomplete`.
   */
  installed: boolean;
  /** Installed, and the plan still has something not downloaded, which an install fetches. */
  incomplete: boolean;
  installing: boolean;
  /** Every server program is running. */
  running: boolean;
  /**
   * At least one runs in some state — running, starting, restarting or failed — so there is something
   * to stop. A failed server stays the backend's until it is stopped.
   */
  anyRunning: boolean;
  /**
   * At least one is not running and not on its way: never started, stopped, or failed. A start starts
   * those, a failed one included, so a failed server is offered both Start and Stop.
   */
  canStart: boolean;
  runtimes: LocalAiRuntimeView[];
  progress: LocalAiProgressView | null;
  /** An install can be started now. */
  canInstall: boolean;
}

export function describeLocalAi(input: {
  hardware: LocalAiHardware | null;
  plan: LocalAiPlan | null;
  status: LocalAiStatus | null;
  progress: LocalAiProgress | null;
  /** An install call from here is in flight. */
  installingHere: boolean;
  /**
   * This connection may install: it holds the node's operator credential. The executor refuses a
   * grant, whatever it holds, so a non-operator is never in a state where Install is enabled.
   */
  operator: boolean;
}): LocalAiView {
  const { hardware, plan, status, progress } = input;
  // Progress still under way counts too: an install the launcher started after the status was read.
  const underWay = !!progress && progress.phase !== 'done' && progress.phase !== 'failed';
  const installing = input.installingHere || !!status?.installing || underWay;
  const runtimes = status?.runtimes ?? [];
  const runningCount = runtimes.filter((r) => r.phase === 'running').length;
  const liveCount = runtimes.filter((r) => r.phase !== null && r.phase !== 'stopped').length;
  const installed = !!status?.installed;
  // An install with no kinds named installs the whole plan, so the rest is one more install away.
  const incomplete = installed && !!plan && [...plan.models, ...plan.runtimes].some((item) => !item.installed);
  const size = plan && plan.downloadBytes > 0 ? ` (${sizeText(plan.downloadBytes)})` : '';
  return {
    loaded: !!hardware && !!plan,
    device: hardware ? deviceText(hardware) : '',
    gpus: hardware?.gpus.map(gpuText) ?? [],
    compute: hardware ? computeText(hardware) : '',
    budget: plan ? `The models may use up to ${sizeText(plan.memoryBudgetBytes)} of memory` : '',
    notes: hardware?.notes ?? [],
    items: plan ? planItems(plan) : [],
    unavailable: plan?.unavailable.map((u) => `${MODEL_KIND_LABELS[u.kind]}: ${u.reason}`) ?? [],
    reasons: plan?.reasons ?? [],
    planNotes: plan ? planNotes(plan) : [],
    fits: !!plan?.fits,
    summary: plan ? planSummary(plan) : '',
    installLabel: incomplete ? `Install the rest${size}` : `Install${size}`,
    installed,
    incomplete,
    installing,
    running: runtimes.length > 0 && runningCount === runtimes.length,
    anyRunning: liveCount > 0,
    // With none listed, Start stays offered, as it was before a failed server could be started.
    canStart:
      !runtimes.length || runtimes.some((r) => r.phase === null || r.phase === 'stopped' || r.phase === 'failed'),
    runtimes: runtimes.map(runtimeView),
    // Shown while an install runs, and after one fails until the next starts: a failure says why.
    progress: progress && (installing || progress.phase === 'failed') ? progressView(progress) : null,
    canInstall: input.operator && !!plan?.fits && !installing,
  };
}

/** Whether a server is the backend's own, which only local AI may change. */
export const isManaged = (endpoints: AiEndpoint[], id: string): boolean =>
  endpoints.some((endpoint) => endpoint.id === id && endpoint.managed);
