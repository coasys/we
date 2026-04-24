/**
 * JSON reporter — collects benchmark results and writes to results/ dir.
 */
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { Stats, computeStats } from './stats';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);

export interface BenchmarkResult {
  name: string;
  spec: string;
  transport: string;
  samples: number[];
  stats: Stats;
  metadata?: Record<string, unknown>;
}

export interface BenchmarkReport {
  timestamp: string;
  gitBranch?: string;
  gitCommit?: string;
  executor: string;
  linkCount: number;
  results: BenchmarkResult[];
}

const resultsDir = path.resolve(__dirname, '../results');

function getGitInfo(): { branch?: string; commit?: string } {
  try {
    const { execSync } = require('child_process');
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim();
    const commit = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
    return { branch, commit };
  } catch {
    return {};
  }
}

export async function writeReport(
  results: BenchmarkResult[],
  linkCount: number,
  executorInfo = 'ad4m-executor',
): Promise<string> {
  await mkdir(resultsDir, { recursive: true });

  const git = getGitInfo();
  const report: BenchmarkReport = {
    timestamp: new Date().toISOString(),
    gitBranch: git.branch,
    gitCommit: git.commit,
    executor: executorInfo,
    linkCount,
    results,
  };

  const filename = `bench-${report.timestamp.replace(/[:.]/g, '-')}.json`;
  const filepath = path.join(resultsDir, filename);
  await writeFile(filepath, JSON.stringify(report, null, 2));
  return filepath;
}

export function formatMarkdownTable(results: BenchmarkResult[]): string {
  const lines: string[] = [];
  lines.push('| Benchmark | Mean | Median | P95 | P99 | Min | Max | Samples |');
  lines.push('|-----------|------|--------|-----|-----|-----|-----|---------|');

  for (const r of results) {
    const s = r.stats;
    lines.push(
      `| ${r.name} | ${fmt(s.mean)} | ${fmt(s.median)} | ${fmt(s.p95)} | ${fmt(s.p99)} | ${fmt(s.min)} | ${fmt(s.max)} | ${s.count} |`,
    );
  }

  return lines.join('\n');
}

function fmt(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(0)}µs`;
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}
