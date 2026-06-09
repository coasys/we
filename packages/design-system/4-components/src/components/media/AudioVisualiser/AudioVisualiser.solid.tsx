import { createEffect, createSignal, onCleanup, onMount } from 'solid-js';

import type { AudioVisualiserProps } from './AudioVisualiser.types';

export type { AudioVisualiserProps } from './AudioVisualiser.types';

export function AudioVisualiser(props: AudioVisualiserProps) {
  let containerRef!: HTMLDivElement;
  let staticCanvasRef!: HTMLCanvasElement;
  let dynamicCanvasRef!: HTMLCanvasElement;
  let audioRef!: HTMLAudioElement;

  const [playing, setPlaying] = createSignal(false);
  const [currentTime, setCurrentTime] = createSignal(0);
  const [duration, setDuration] = createSignal(0);
  const [waveformData, setWaveformData] = createSignal<number[]>([]);

  let audioCtx: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let source: MediaElementAudioSourceNode | null = null;
  let animFrame: number | null = null;

  const numBars = () => props.bars ?? 80;
  const canvasHeight = () => props.height ?? 48;
  const color = () => props.color ?? 'var(--we-color-neutral-200)';
  const activeColor = () => props.activeColor ?? 'var(--we-color-primary-500)';

  // Canvas fillStyle does not resolve CSS variables — resolve them against the document root.
  function resolveColor(value: string): string {
    const match = value.match(/^var\((--[^)]+)\)$/);
    if (!match) return value;
    return getComputedStyle(document.documentElement).getPropertyValue(match[1]).trim() || value;
  }

  // --- Drawing helpers ---

  function drawBars(ctx: CanvasRenderingContext2D, data: number[], w: number, h: number, fillStyle: string) {
    const n = data.length;
    if (n === 0) return;
    const spacing = 2;
    const barW = Math.max(1, (w - spacing * (n - 1)) / n);
    ctx.fillStyle = fillStyle;
    for (let i = 0; i < n; i++) {
      const barH = Math.max(2, data[i] * h);
      const x = i * (barW + spacing);
      const y = (h - barH) / 2;
      ctx.fillRect(x, y, barW, barH);
    }
  }

  function drawStatic(data: number[], progress: number) {
    if (!staticCanvasRef || data.length === 0) return;
    const ctx = staticCanvasRef.getContext('2d')!;
    const w = staticCanvasRef.width;
    const h = staticCanvasRef.height;
    ctx.clearRect(0, 0, w, h);

    // All bars in muted colour
    drawBars(ctx, data, w, h, resolveColor(color()));

    // Clip and redraw the played portion in active colour
    if (progress > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, w * progress, h);
      ctx.clip();
      drawBars(ctx, data, w, h, resolveColor(activeColor()));
      ctx.restore();
    }
  }

  // Redraw static canvas whenever waveform data, playback position, or colours change
  createEffect(() => {
    const data = waveformData();
    const progress = duration() > 0 ? currentTime() / duration() : 0;
    // colour() and activeColor() are also tracked here via their getters
    void color();
    void activeColor();
    drawStatic(data, progress);
  });

  // --- Audio decoding (static waveform) ---

  createEffect(() => {
    const src = props.src;
    if (!src) {
      setWaveformData([]);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const decodeCtx = new AudioContext();
        const response = await fetch(src);
        if (cancelled) {
          decodeCtx.close();
          return;
        }
        const arrayBuffer = await response.arrayBuffer();
        if (cancelled) {
          decodeCtx.close();
          return;
        }
        const audioBuffer = await decodeCtx.decodeAudioData(arrayBuffer);
        await decodeCtx.close();
        if (cancelled) return;

        const rawData = audioBuffer.getChannelData(0);
        const n = numBars();
        const blockSize = Math.floor(rawData.length / n);
        const barValues: number[] = [];

        for (let i = 0; i < n; i++) {
          const blockStart = blockSize * i;
          let sum = 0;
          for (let v = 0; v < blockSize; v++) sum += Math.abs(rawData[blockStart + v]);
          barValues.push(sum / blockSize);
        }

        const max = Math.max(...barValues);
        const normalized = barValues.map((v) => (max > 0 ? v / max : 0));
        setWaveformData(normalized);
      } catch (e) {
        console.error('AudioVisualiser: decode failed', e);
      }
    })();

    onCleanup(() => {
      cancelled = true;
    });
  });

  // --- Web Audio analyser (dynamic vis) ---

  function setupAudioContext() {
    if (audioCtx) return;
    audioCtx = new AudioContext();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    source = audioCtx.createMediaElementSource(audioRef);
    source.connect(analyser);
    source.connect(audioCtx.destination);
  }

  function renderDynamic() {
    if (!analyser || !dynamicCanvasRef) return;
    const ctx = dynamicCanvasRef.getContext('2d')!;
    const w = dynamicCanvasRef.width;
    const h = dynamicCanvasRef.height;
    const bins = analyser.frequencyBinCount;
    const totalBars = Math.min(numBars(), bins);
    const freqData = new Uint8Array(bins);
    analyser.getByteFrequencyData(freqData);

    const spacing = 2;
    const barW = Math.max(1, (w - spacing * (totalBars - 1)) / totalBars);

    ctx.clearRect(0, 0, w, h);
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = resolveColor(activeColor());
    for (let i = 0; i < totalBars; i++) {
      const amplitude = freqData[i] / 255;
      const barH = amplitude * h;
      if (barH < 1) continue;
      const x = i * (barW + spacing);
      const y = (h - barH) / 2;
      ctx.fillRect(x, y, barW, barH);
    }
    ctx.globalAlpha = 1;

    animFrame = requestAnimationFrame(renderDynamic);
  }

  function stopDynamic() {
    if (animFrame !== null) {
      cancelAnimationFrame(animFrame);
      animFrame = null;
    }
    if (dynamicCanvasRef) {
      dynamicCanvasRef.getContext('2d')!.clearRect(0, 0, dynamicCanvasRef.width, dynamicCanvasRef.height);
    }
  }

  // --- Canvas sizing ---

  function syncCanvasSize() {
    if (!containerRef) return;
    const w = containerRef.offsetWidth;
    if (w === 0) return;
    const h = canvasHeight();
    for (const canvas of [staticCanvasRef, dynamicCanvasRef]) {
      canvas.width = w;
      canvas.height = h;
    }
    // Redraw after resize
    const progress = duration() > 0 ? currentTime() / duration() : 0;
    drawStatic(waveformData(), progress);
  }

  onMount(() => {
    syncCanvasSize();
    const ro = new ResizeObserver(syncCanvasSize);
    ro.observe(containerRef);
    onCleanup(() => ro.disconnect());
  });

  // --- Playback controls ---

  function togglePlay() {
    if (playing()) {
      audioRef.pause();
    } else {
      if (!audioCtx) setupAudioContext();
      audioCtx?.resume().catch(() => {});
      audioRef.play().catch(console.error);
    }
  }

  function handleCanvasClick(e: MouseEvent) {
    if (duration() === 0) return;
    const rect = staticCanvasRef.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audioRef.currentTime = frac * duration();
  }

  onCleanup(() => {
    stopDynamic();
    source?.disconnect();
    audioCtx?.close();
  });

  function formatTime(s: number): string {
    if (!isFinite(s) || s < 0) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  }

  return (
    <div class="audio-visualiser">
      <audio
        ref={audioRef}
        src={props.src}
        preload="metadata"
        onPlay={() => {
          setPlaying(true);
          if (!audioCtx) setupAudioContext();
          audioCtx?.resume().catch(() => {});
          renderDynamic();
        }}
        onPause={() => {
          setPlaying(false);
          stopDynamic();
        }}
        onEnded={() => {
          setPlaying(false);
          stopDynamic();
        }}
        onTimeUpdate={() => setCurrentTime(audioRef.currentTime)}
        onLoadedMetadata={() => setDuration(audioRef.duration)}
      />

      <div ref={containerRef} class="audio-visualiser__canvas-wrap" onClick={handleCanvasClick}>
        <canvas ref={staticCanvasRef} class="audio-visualiser__canvas" />
        <canvas ref={dynamicCanvasRef} class="audio-visualiser__canvas audio-visualiser__canvas--dynamic" />
      </div>

      <div class="audio-visualiser__controls">
        <we-button square variant="ghost" size="sm" onClick={togglePlay}>
          <we-icon name={playing() ? 'pause' : 'play'} size="xs" />
        </we-button>
        <span class="audio-visualiser__time">
          {formatTime(currentTime())} / {formatTime(duration())}
        </span>
      </div>
    </div>
  );
}
