/**
 * Local AI's sentences, and the one piece of logic in them: folding progress events into a bar that
 * starts over with each install and never moves back within one.
 */
import type { LocalAiHardware, LocalAiPlan, LocalAiProgress, LocalAiRuntimeStatus } from '@we/backend-shared';
import { describe, expect, it } from 'vitest';

import {
  computeText,
  describeLocalAi,
  gpuText,
  planItems,
  planNotes,
  progressView,
  reduceProgress,
  runtimeView,
  sizeText,
} from '../src/frameworks/solid/stores/localAiView';

const event = (overrides: Partial<LocalAiProgress> = {}): LocalAiProgress => ({
  phase: 'download',
  item: 'm',
  itemDoneBytes: 0,
  itemTotalBytes: 0,
  doneBytes: 0,
  totalBytes: 100,
  detail: '',
  ...overrides,
});

const runtime = (overrides: Partial<LocalAiRuntimeStatus> = {}): LocalAiRuntimeStatus => ({
  id: 'nemo-speech',
  version: 'v1',
  build: 'linux-x64-cpu',
  kinds: ['transcription'],
  phase: 'running',
  restarts: 0,
  detail: '',
  onGpu: null,
  ...overrides,
});

describe('reduceProgress', () => {
  it('starts over with a new install', () => {
    // The backend sends `download` events, then `done` or `failed`: the next install starts after either.
    expect(reduceProgress(event({ phase: 'done', doneBytes: 100 }), event({ doneBytes: 5 })).doneBytes).toBe(5);
    expect(reduceProgress(event({ phase: 'failed', doneBytes: 60 }), event({ doneBytes: 5 })).doneBytes).toBe(5);
  });

  it('never moves back within one install, but follows a new total', () => {
    expect(reduceProgress(event({ doneBytes: 60 }), event({ doneBytes: 40 })).doneBytes).toBe(60);
    expect(reduceProgress(event({ doneBytes: 60 }), event({ doneBytes: 70 })).doneBytes).toBe(70);
    expect(reduceProgress(event({ doneBytes: 60 }), event({ doneBytes: 10, totalBytes: 200 })).doneBytes).toBe(10);
  });
});

describe('progressView', () => {
  it('says each phase, and a finished install is all the way', () => {
    expect(progressView(event({ itemDoneBytes: 40e6, itemTotalBytes: 2.5e9, doneBytes: 40 })).text).toBe(
      'Downloading m — 40 MB of 2.5 GB',
    );
    // Every file in, the servers start: the backend sends nothing more until `done`.
    expect(progressView(event({ itemDoneBytes: 2.5e9, itemTotalBytes: 2.5e9, doneBytes: 100 }))).toEqual({
      percent: 100,
      text: 'Starting the model servers',
      failed: false,
    });
    expect(progressView(event({ phase: 'done', doneBytes: 0, totalBytes: 0 }))).toEqual({
      percent: 100,
      text: 'Installed',
      failed: false,
    });
    expect(progressView(event({ phase: 'failed' })).text).toBe('The install failed');
    expect(progressView(event({ totalBytes: 0 })).percent).toBe(0);
  });
});

describe('sentences', () => {
  it('sizes in gigabytes, else megabytes, never zero', () => {
    expect(sizeText(3.14e9)).toBe('3.1 GB');
    expect(sizeText(480e6)).toBe('480 MB');
    expect(sizeText(12)).toBe('1 MB');
  });

  it('describes a GPU by its kind and memory', () => {
    expect(gpuText({ vendor: 'apple', type: 'unified', name: 'Test GPU' })).toBe('Test GPU · unified memory');
    expect(gpuText({ vendor: 'nvidia', type: 'discrete', name: 'Test GPU', vramBytes: 12e9 })).toBe(
      'Test GPU · discrete · 12.0 GB',
    );
    expect(gpuText({ vendor: 'intel', type: 'integrated', name: 'Test GPU' })).toBe('Test GPU · integrated');
  });

  it('says when the models would run on the CPU', () => {
    const cpuOnly = { backends: ['cpu'] } as LocalAiHardware;
    expect(computeText(cpuOnly)).toBe('Runs models on the CPU: no usable GPU was found');
    expect(computeText({ backends: ['cpu', 'cuda', 'vulkan'] } as LocalAiHardware)).toBe(
      'Can run models on the GPU with CUDA or Vulkan',
    );
  });

  it('says how a server runs: on the CPU against its build, and how often it restarted', () => {
    expect(runtimeView(runtime())).toMatchObject({
      label: 'Transcription · nemo-speech v1 · the CPU',
      stateText: 'Running',
      ok: true,
    });
    expect(runtimeView(runtime({ build: 'linux-x64-vulkan', onGpu: false, restarts: 2 }))).toMatchObject({
      stateText: 'Running · on the CPU: the GPU build found no device · restarted 2 times',
      ok: false,
    });
    expect(runtimeView(runtime({ phase: null })).stateText).toBe('Not running');
    expect(runtimeView(runtime({ phase: 'failed', detail: 'exited with 1' }))).toMatchObject({
      stateText: 'Failed · exited with 1',
      ok: false,
    });
  });

  it('draws a server stopped on purpose, or never started, as idle rather than as a fault', () => {
    expect(runtimeView(runtime()).tone).toBe('success');
    expect(runtimeView(runtime({ phase: null })).tone).toBe('idle');
    expect(runtimeView(runtime({ phase: 'stopped' })).tone).toBe('idle');
    expect(runtimeView(runtime({ phase: 'stopped', detail: 'exited with 1' })).tone).toBe('warning');
    expect(runtimeView(runtime({ phase: 'restarting' })).tone).toBe('warning');
    expect(runtimeView(runtime({ phase: 'failed' })).tone).toBe('warning');
    expect(runtimeView(runtime({ build: 'linux-x64-vulkan', onGpu: false })).tone).toBe('warning');
  });
});

describe('describeLocalAi', () => {
  it('is not loaded, and offers no install, until the machine and the plan are read', () => {
    const view = describeLocalAi({
      hardware: null,
      plan: null,
      status: null,
      progress: null,
      installingHere: false,
      operator: true,
    });
    expect(view).toMatchObject({ loaded: false, canInstall: false, installLabel: 'Install', progress: null });
  });

  it('offers no install to a connection that is not the operator, however well it fits', () => {
    const plan: LocalAiPlan = {
      hardwareClass: 'linux-x64-cpu',
      runtimes: [],
      models: [],
      unavailable: [],
      downloadBytes: 3.7e9,
      totalBytes: 3.7e9,
      memoryBytes: 0,
      memoryBudgetBytes: 8e9,
      fits: true,
      reasons: [],
    };
    const base = { hardware: null, plan, status: null, progress: null, installingHere: false };
    expect(describeLocalAi({ ...base, operator: true }).canInstall).toBe(true);
    expect(describeLocalAi({ ...base, operator: false }).canInstall).toBe(false);
  });

  it('counts an install the backend reports as running, whoever started it', () => {
    const view = describeLocalAi({
      hardware: null,
      plan: null,
      status: { installed: false, installing: true, autostart: true, runtimes: [], models: [] },
      progress: event({ doneBytes: 50 }),
      installingHere: false,
      operator: true,
    });
    expect(view.installing).toBe(true);
    expect(view.progress?.percent).toBe(50);
  });

  it('counts an install it hears progress for, though the status read before it said none', () => {
    // An install started from the launcher after the settings opened: the status was read before it.
    const view = describeLocalAi({
      hardware: null,
      plan: null,
      status: { installed: false, installing: false, autostart: true, runtimes: [], models: [] },
      progress: event({ doneBytes: 50 }),
      installingHere: false,
      operator: true,
    });
    expect(view.installing).toBe(true);
    expect(view.canInstall).toBe(false);
    expect(view.progress?.percent).toBe(50);
  });

  it('offers Stop for any server the backend still runs, whatever state it is in', () => {
    // `anyRunning` picks Stop over Start. A failed server stays the backend's until it is stopped,
    // and a start leaves it as it is: Start would do nothing for it.
    const live = (phase: LocalAiRuntimeStatus['phase']) =>
      describeLocalAi({
        hardware: null,
        plan: null,
        status: { installed: true, installing: false, autostart: true, runtimes: [runtime({ phase })], models: [] },
        progress: null,
        installingHere: false,
        operator: true,
      }).anyRunning;
    expect(live('failed')).toBe(true);
    expect(live('starting')).toBe(true);
    expect(live('restarting')).toBe(true);
    expect(live('running')).toBe(true);
    expect(live('stopped')).toBe(false);
    expect(live(null)).toBe(false);
  });

  describe('an install of part of the plan', () => {
    // The backend installs one service by itself the first time an app asks for its default model,
    // and an install can name kinds: either leaves the plan partly downloaded and `installed` true.
    const partPlan: LocalAiPlan = {
      hardwareClass: 'linux-x64-cpu',
      runtimes: [
        {
          id: 'llama-server',
          version: 'b1',
          build: 'linux-x64-cpu',
          backend: 'cpu',
          sizeBytes: 40e6,
          installed: false,
          kinds: ['llm'],
        },
        {
          id: 'nemo-speech',
          version: 'v1',
          build: 'linux-x64-cpu',
          backend: 'cpu',
          sizeBytes: 200e6,
          installed: true,
          kinds: ['transcription'],
        },
      ],
      models: [
        {
          kind: 'llm',
          model: 'test-chat',
          sizeBytes: 2.5e9,
          memoryBytes: 3e9,
          license: 'MIT',
          installed: false,
          basis: 'measured',
          fromClass: 'linux-x64-cpu',
        },
      ],
      unavailable: [],
      downloadBytes: 2.54e9,
      totalBytes: 2.74e9,
      memoryBytes: 3e9,
      memoryBudgetBytes: 8e9,
      fits: true,
      reasons: [],
    };
    const installedStatus = { installed: true, installing: false, autostart: true, runtimes: [], models: [] };
    const base = { hardware: null, status: installedStatus, progress: null, installingHere: false };

    it('offers the operator the rest of the plan, with what is left to download', () => {
      const view = describeLocalAi({ ...base, plan: partPlan, operator: true });
      expect(view).toMatchObject({ installed: true, incomplete: true, canInstall: true });
      expect(view.installLabel).toBe('Install the rest (2.5 GB)');
    });

    it('offers nothing more once every item is downloaded', () => {
      const whole: LocalAiPlan = {
        ...partPlan,
        downloadBytes: 0,
        runtimes: partPlan.runtimes.map((r) => ({ ...r, installed: true })),
        models: partPlan.models.map((m) => ({ ...m, installed: true })),
      };
      expect(describeLocalAi({ ...base, plan: whole, operator: true }).incomplete).toBe(false);
    });

    it('is not the rest of anything before a first install', () => {
      const view = describeLocalAi({ ...base, status: null, plan: partPlan, operator: true });
      expect(view.incomplete).toBe(false);
      expect(view.installLabel).toBe('Install (2.5 GB)');
    });

    it('offers the rest to the operator only', () => {
      expect(describeLocalAi({ ...base, plan: partPlan, operator: false }).canInstall).toBe(false);
    });
  });

  it('drops a finished install’s bar once it is over', () => {
    const view = describeLocalAi({
      hardware: null,
      plan: null,
      status: null,
      progress: event({ phase: 'done' }),
      installingHere: false,
      operator: true,
    });
    expect(view.progress).toBeNull();
  });
});

describe('planNotes', () => {
  const model = (overrides: Partial<LocalAiPlan['models'][number]>): LocalAiPlan['models'][number] => ({
    kind: 'llm',
    model: 'm',
    sizeBytes: 1e9,
    memoryBytes: 1e9,
    license: 'MIT',
    installed: false,
    basis: 'measured',
    fromClass: 'linux-x64-cpu',
    ...overrides,
  });
  const plan = (overrides: Partial<LocalAiPlan>): LocalAiPlan => ({
    hardwareClass: 'linux-x64-dgpu-intel',
    runtimes: [],
    models: [],
    unavailable: [],
    downloadBytes: 0,
    totalBytes: 0,
    memoryBytes: 0,
    memoryBudgetBytes: 0,
    fits: true,
    reasons: [],
    ...overrides,
  });

  it('says nothing for a plan measured on this class of device, held to no backend', () => {
    expect(planNotes(plan({ models: [model({})] }))).toEqual([]);
  });

  it('names the kinds nothing was measured for, which take the smallest model', () => {
    const notes = planNotes(
      plan({
        models: [
          model({}),
          model({ kind: 'transcription', basis: 'default' }),
          model({ kind: 'embedding', basis: 'default' }),
        ],
      }),
    );
    expect(notes).toEqual([
      'No measurements exist for this class of device (linux-x64-dgpu-intel), so the plan takes the smallest model for transcription, embeddings',
    ]);
  });

  it('says each model’s licence and memory, which an install agrees to', () => {
    const items = planItems(
      plan({
        models: [model({ license: 'Apache-2.0', memoryBytes: 3e9 })],
        runtimes: [
          {
            id: 'llama-server',
            version: 'b1',
            build: 'linux-x64-cpu',
            backend: 'cpu',
            sizeBytes: 40e6,
            installed: false,
            kinds: ['llm'],
          },
        ],
      }),
    );
    expect(items.map((item) => item.detail)).toEqual(['Apache-2.0 licence · uses 3.0 GB of memory', '']);
  });

  it('says which backend the settings hold it to', () => {
    expect(planNotes(plan({ device: 'vulkan' }))).toEqual(["The node's settings hold local AI to Vulkan"]);
  });
});
