/**
 * Container Runner for BastionClaw
 * Spawns agent execution in Apple Container and handles IPC
 */
import { ChildProcess, execFile, spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  CONTAINER_IMAGE,
  CONTAINER_MAX_OUTPUT_SIZE,
  CONTAINER_TIMEOUT,
  DATA_DIR,
  GROUPS_DIR,
  IDLE_TIMEOUT,
  TIMEZONE,
  getContainerRuntime,
} from './config.js';
import { isValidGroupFolder } from './group-folder.js';
import { logger } from './logger.js';
import { validateAdditionalMounts } from './mount-security.js';
import { RegisteredGroup } from './types.js';

// Sentinel markers for robust output parsing (must match agent-runner)
const OUTPUT_START_MARKER = '---BASTIONCLAW_OUTPUT_START---';
const OUTPUT_END_MARKER = '---BASTIONCLAW_OUTPUT_END---';

function getHomeDir(): string {
  const home = process.env.HOME || os.homedir();
  if (!home) {
    throw new Error(
      'Unable to determine home directory: HOME environment variable is not set and os.homedir() returned empty',
    );
  }
  return home;
}

export interface ContainerInput {
  prompt: string;
  sessionId?: string;
  groupFolder: string;
  chatJid: string;
  isMain: boolean;
  isScheduledTask?: boolean;
  assistantName?: string;
  secrets?: Record<string, string>;
}

export interface ContainerOutput {
  status: 'success' | 'error';
  result: string | null;
  newSessionId?: string;
  error?: string;
}

interface VolumeMount {
  hostPath: string;
  containerPath: string;
  readonly: boolean;
}

function buildVolumeMounts(
  group: RegisteredGroup,
  isMain: boolean,
): VolumeMount[] {
  if (!isValidGroupFolder(group.folder)) {
    throw new Error(`Invalid group folder name: ${group.folder}`);
  }

  const mounts: VolumeMount[] = [];
  const homeDir = getHomeDir();
  const projectRoot = process.cwd();

  if (isMain) {
    // Main gets the entire project root mounted (read-only to prevent sandbox escape
    // via modification of dist/ or container scripts)
    mounts.push({
      hostPath: projectRoot,
      containerPath: '/workspace/project',
      readonly: true,
    });

    // Shadow .env inside the project mount to prevent secret leakage.
    // The project root bind mount exposes .env (contains OAuth tokens, API keys).
    // Mounting /dev/null over it makes it appear empty and read-only.
    // Secrets are passed securely via stdin instead (see readSecrets()).
    const envFile = path.join(projectRoot, '.env');
    if (fs.existsSync(envFile)) {
      mounts.push({
        hostPath: '/dev/null',
        containerPath: '/workspace/project/.env',
        readonly: true,
      });
    }

    // Main also gets its group folder as the working directory
    mounts.push({
      hostPath: path.join(GROUPS_DIR, group.folder),
      containerPath: '/workspace/group',
      readonly: false,
    });
  } else {
    // Other groups only get their own folder
    mounts.push({
      hostPath: path.join(GROUPS_DIR, group.folder),
      containerPath: '/workspace/group',
      readonly: false,
    });

    // Global memory directory (read-only for non-main)
    const globalDir = path.join(GROUPS_DIR, 'global');
    if (fs.existsSync(globalDir)) {
      mounts.push({
        hostPath: globalDir,
        containerPath: '/workspace/global',
        readonly: true,
      });
    }
  }

  // Per-group Claude sessions directory (isolated from other groups)
  // Each group gets their own .claude/ to prevent cross-group session access
  const groupSessionsDir = path.join(
    DATA_DIR,
    'sessions',
    group.folder,
    '.claude',
  );
  fs.mkdirSync(groupSessionsDir, { recursive: true });
  // Ensure the agent container (runs as 'node' uid 1000) can write to this directory.
  // nanoclaw runs as root, so created dirs are root:root by default.
  try {
    fs.chmodSync(groupSessionsDir, 0o777);
  } catch {
    /* non-fatal: may fail in test environments */
  }

  const settingsFile = path.join(groupSessionsDir, 'settings.json');

  // Read existing settings to preserve manually configured fields (e.g. mcpServers).
  let existingSettings: Record<string, unknown> = {};
  if (fs.existsSync(settingsFile)) {
    try {
      existingSettings = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
    } catch {
      /* invalid JSON — will rewrite */
    }
  }

  const existingEnv = (existingSettings.env as Record<string, string>) ?? {};
  const missingApiKey =
    !existingEnv.ANTHROPIC_API_KEY &&
    !existingEnv.CLAUDE_CODE_OAUTH_TOKEN &&
    !!process.env.ANTHROPIC_API_KEY;

  if (!fs.existsSync(settingsFile) || missingApiKey) {
    const settingsEnv: Record<string, string> = {
      ...existingEnv,
      // Enable agent swarms (subagent orchestration)
      // https://code.claude.com/docs/en/agent-teams#orchestrate-teams-of-claude-code-sessions
      CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1',
      // Load CLAUDE.md from additional mounted directories
      // https://code.claude.com/docs/en/memory#load-memory-from-additional-directories
      CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD: '1',
      // Enable Claude's memory feature (persists user preferences between sessions)
      // https://code.claude.com/docs/en/memory#manage-auto-memory
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: '0',
    };
    // Propagate API auth from host environment so all groups can authenticate
    if (process.env.ANTHROPIC_BASE_URL)
      settingsEnv.ANTHROPIC_BASE_URL = process.env.ANTHROPIC_BASE_URL;
    if (process.env.ANTHROPIC_API_KEY)
      settingsEnv.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

    fs.writeFileSync(
      settingsFile,
      JSON.stringify({ ...existingSettings, env: settingsEnv }, null, 2) + '\n',
    );
  }

  // Sync skills from container/skills/ into each group's .claude/skills/
  const skillsSrc = path.join(process.cwd(), 'container', 'skills');
  const skillsDst = path.join(groupSessionsDir, 'skills');
  if (fs.existsSync(skillsSrc)) {
    for (const skillDir of fs.readdirSync(skillsSrc)) {
      const srcDir = path.join(skillsSrc, skillDir);
      if (!fs.statSync(srcDir).isDirectory()) continue;
      const dstDir = path.join(skillsDst, skillDir);
      // Use recursive copy to handle subdirectories (avoids EISDIR crash)
      fs.cpSync(srcDir, dstDir, { recursive: true });
    }
  }
  mounts.push({
    hostPath: groupSessionsDir,
    containerPath: '/home/node/.claude',
    readonly: false,
  });

  // Per-group IPC namespace: each group gets its own IPC directory
  // This prevents cross-group privilege escalation via IPC
  const groupIpcDir = path.join(DATA_DIR, 'ipc', group.folder);
  fs.mkdirSync(path.join(groupIpcDir, 'messages'), { recursive: true });
  fs.mkdirSync(path.join(groupIpcDir, 'tasks'), { recursive: true });
  fs.mkdirSync(path.join(groupIpcDir, 'input'), { recursive: true });
  fs.mkdirSync(path.join(groupIpcDir, 'responses'), { recursive: true });
  mounts.push({
    hostPath: groupIpcDir,
    containerPath: '/workspace/ipc',
    readonly: false,
  });

  // Mount agent-runner source from host — recompiled on container startup.
  // Bypasses Apple Container's sticky build cache for code changes.
  const agentRunnerSrc = path.join(
    projectRoot,
    'container',
    'agent-runner',
    'src',
  );
  mounts.push({
    hostPath: agentRunnerSrc,
    containerPath: '/app/src',
    readonly: true,
  });

  // Additional mounts validated against external allowlist (tamper-proof from containers)
  if (group.containerConfig?.additionalMounts) {
    const validatedMounts = validateAdditionalMounts(
      group.containerConfig.additionalMounts,
      group.name,
      isMain,
    );
    mounts.push(...validatedMounts);
  }

  return mounts;
}

/**
 * Read allowed secrets from .env for passing to the container via stdin.
 * These are merged into the Claude SDK process environment, which means:
 *   1. The SDK uses CLAUDE_CODE_OAUTH_TOKEN / ANTHROPIC_API_KEY to authenticate.
 *   2. Bash tool calls inherit the full env, so API keys like TRANSCRIPT_API_KEY
 *      are available to scripts (e.g. Python) run by the agent.
 * This is the ONLY path for secrets into containers — nothing is mounted as files.
 */
function readSecrets(): Record<string, string> {
  // SDK auth + API keys needed by agent Bash tool calls
  const allowedVars = [
    'CLAUDE_CODE_OAUTH_TOKEN',
    'ANTHROPIC_API_KEY',
    'TRANSCRIPT_API_KEY',
    'GEMINI_API_KEY',
    'PAPERCLIP_API_KEY',
    'PAPERCLIP_API_URL',
    'LOCAL_REST_API_KEY',
    'GITHUB_TOKEN',
  ];

  const envFile = path.join(process.cwd(), '.env');
  if (!fs.existsSync(envFile)) {
    // In K8s, secrets are injected via env_from (Infisical operator) — fall back to process.env
    const secrets: Record<string, string> = {};
    for (const key of allowedVars) {
      const val = process.env[key];
      if (val) secrets[key] = val;
    }
    return secrets;
  }

  const secrets: Record<string, string> = {};
  const content = fs.readFileSync(envFile, 'utf-8');

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    if (!allowedVars.includes(key)) continue;
    let value = trimmed.slice(eqIdx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value) secrets[key] = value;
  }

  return secrets;
}

function buildContainerArgs(
  mounts: VolumeMount[],
  containerName: string,
): string[] {
  const runtime = getContainerRuntime();
  const args: string[] = ['run', '-i', '--rm', '--name', containerName];

  // Resource limits: prevent CPU/memory exhaustion from runaway or malicious processes
  args.push('--cpus', '2', '--memory', '1G');

  if (runtime === 'docker') {
    // Docker: cgroup-based PID limit and privilege escalation prevention
    args.push('--pids-limit', '256');
    args.push('--security-opt', 'no-new-privileges:true');
  } else {
    // Apple Container: VM isolation handles privilege escalation;
    // use ulimit for process count limit (--pids-limit not supported)
    args.push('--ulimit', 'nproc=256:256');
  }

  // Pass host timezone so scheduled tasks fire at correct local times
  args.push('-e', `TZ=${TIMEZONE}`);

  for (const mount of mounts) {
    if (runtime === 'container') {
      // Apple Container: -v for all mounts (supports both files and directories).
      // --mount only supports directories, so we use -v universally with :ro suffix.
      if (mount.readonly) {
        args.push('-v', `${mount.hostPath}:${mount.containerPath}:ro`);
      } else {
        args.push('-v', `${mount.hostPath}:${mount.containerPath}`);
      }
    } else {
      // Docker: -v with :ro suffix for readonly
      if (mount.readonly) {
        args.push('-v', `${mount.hostPath}:${mount.containerPath}:ro`);
      } else {
        args.push('-v', `${mount.hostPath}:${mount.containerPath}`);
      }
    }
  }

  args.push(CONTAINER_IMAGE);

  return args;
}

export async function runContainerAgent(
  group: RegisteredGroup,
  input: ContainerInput,
  onProcess: (proc: ChildProcess, containerName: string) => void,
  onOutput?: (output: ContainerOutput) => Promise<void>,
): Promise<ContainerOutput> {
  const startTime = Date.now();

  const groupDir = path.join(GROUPS_DIR, group.folder);
  fs.mkdirSync(groupDir, { recursive: true });

  const mounts = buildVolumeMounts(group, input.isMain);
  const safeName = group.folder.replace(/[^a-zA-Z0-9-]/g, '-');
  const containerName = `bastionclaw-${safeName}-${Date.now()}`;
  const containerArgs = buildContainerArgs(mounts, containerName);

  logger.debug(
    {
      group: group.name,
      containerName,
      mounts: mounts.map(
        (m) =>
          `${m.hostPath} -> ${m.containerPath}${m.readonly ? ' (ro)' : ''}`,
      ),
      containerArgs: containerArgs.join(' '),
    },
    'Container mount configuration',
  );

  logger.info(
    {
      group: group.name,
      containerName,
      mountCount: mounts.length,
      isMain: input.isMain,
      chatJid: input.chatJid,
      prompt: input.prompt,
    },
    'Spawning container agent',
  );

  const logsDir = path.join(GROUPS_DIR, group.folder, 'logs');
  fs.mkdirSync(logsDir, { recursive: true });

  return new Promise((resolve) => {
    const runtime = getContainerRuntime();
    const container = spawn(runtime, containerArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Create live log file for real-time monitoring (tail -f)
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const logFile = path.join(logsDir, `container-${timestamp}.log`);
    const logStream = fs.createWriteStream(logFile, { flags: 'a' });

    logStream.write(`=== Container Live Log ===\n`);
    logStream.write(`Started: ${new Date().toISOString()}\n`);
    logStream.write(`Group: ${group.name}\n`);
    logStream.write(`Container: ${containerName}\n`);
    logStream.write(`IsMain: ${input.isMain}\n\n`);

    // Symlink for convenience: groups/{folder}/logs/latest.log → this file
    const latestLink = path.join(logsDir, 'latest.log');
    try {
      fs.unlinkSync(latestLink);
    } catch {
      /* ignore */
    }
    try {
      fs.symlinkSync(path.basename(logFile), latestLink);
    } catch {
      /* ignore */
    }

    onProcess(container, containerName);

    let stdout = '';
    let stderr = '';
    let stdoutTruncated = false;
    let stderrTruncated = false;

    // Pass secrets via stdin (never written to disk or mounted as files)
    input.secrets = readSecrets();
    container.stdin.write(JSON.stringify(input));
    container.stdin.end();
    // Remove secrets from input so they don't appear in logs
    delete input.secrets;

    // Streaming output: parse OUTPUT_START/END marker pairs as they arrive
    let parseBuffer = '';
    let newSessionId: string | undefined;
    let outputChain = Promise.resolve();

    container.stdout.on('data', (data) => {
      const chunk = data.toString();

      // Write non-marker lines to live log (skip raw JSON output markers)
      for (const line of chunk.split('\n')) {
        if (
          line &&
          !line.includes('BASTIONCLAW_OUTPUT') &&
          !line.startsWith('{')
        ) {
          logStream.write(`[stdout] ${line}\n`);
        }
      }

      // Always accumulate for logging
      if (!stdoutTruncated) {
        const remaining = CONTAINER_MAX_OUTPUT_SIZE - stdout.length;
        if (chunk.length > remaining) {
          stdout += chunk.slice(0, remaining);
          stdoutTruncated = true;
          logger.warn(
            { group: group.name, size: stdout.length },
            'Container stdout truncated due to size limit',
          );
        } else {
          stdout += chunk;
        }
      }

      // Stream-parse for output markers
      if (onOutput) {
        parseBuffer += chunk;
        let startIdx: number;
        while ((startIdx = parseBuffer.indexOf(OUTPUT_START_MARKER)) !== -1) {
          const endIdx = parseBuffer.indexOf(OUTPUT_END_MARKER, startIdx);
          if (endIdx === -1) break; // Incomplete pair, wait for more data

          const jsonStr = parseBuffer
            .slice(startIdx + OUTPUT_START_MARKER.length, endIdx)
            .trim();
          parseBuffer = parseBuffer.slice(endIdx + OUTPUT_END_MARKER.length);

          try {
            const parsed: ContainerOutput = JSON.parse(jsonStr);
            if (parsed.newSessionId) {
              newSessionId = parsed.newSessionId;
            }
            hadStreamingOutput = true;
            // Activity detected — reset the hard timeout
            resetTimeout();
            // Call onOutput for all markers (including null results)
            // so idle timers start even for "silent" query completions.
            outputChain = outputChain.then(() => onOutput(parsed));
          } catch (err) {
            logger.warn(
              { group: group.name, error: err },
              'Failed to parse streamed output chunk',
            );
          }
        }
      }
    });

    container.stderr.on('data', (data) => {
      const chunk = data.toString();
      logStream.write(chunk);
      const lines = chunk.trim().split('\n');
      for (const line of lines) {
        if (line) logger.debug({ container: group.folder }, line);
      }
      // Don't reset timeout on stderr — SDK writes debug logs continuously.
      // Timeout only resets on actual output (OUTPUT_MARKER in stdout).
      if (stderrTruncated) return;
      const remaining = CONTAINER_MAX_OUTPUT_SIZE - stderr.length;
      if (chunk.length > remaining) {
        stderr += chunk.slice(0, remaining);
        stderrTruncated = true;
        logger.warn(
          { group: group.name, size: stderr.length },
          'Container stderr truncated due to size limit',
        );
      } else {
        stderr += chunk;
      }
    });

    let timedOut = false;
    let hadStreamingOutput = false;
    const configTimeout = group.containerConfig?.timeout || CONTAINER_TIMEOUT;
    // Grace period: hard timeout must be at least IDLE_TIMEOUT + 30s so the
    // graceful _close sentinel has time to trigger before the hard kill fires.
    const timeoutMs = Math.max(configTimeout, IDLE_TIMEOUT + 30_000);

    const killOnTimeout = () => {
      timedOut = true;
      logger.error(
        { group: group.name, containerName },
        'Container timeout, stopping gracefully',
      );
      execFile(
        getContainerRuntime(),
        ['stop', containerName],
        { timeout: 15000 },
        (err) => {
          if (err) {
            logger.warn(
              { group: group.name, containerName, err },
              'Graceful stop failed, force killing',
            );
            container.kill('SIGKILL');
          }
        },
      );
    };

    let timeout = setTimeout(killOnTimeout, timeoutMs);

    // Reset the timeout whenever there's activity (streaming output)
    const resetTimeout = () => {
      clearTimeout(timeout);
      timeout = setTimeout(killOnTimeout, timeoutMs);
    };

    container.on('close', (code) => {
      clearTimeout(timeout);
      const duration = Date.now() - startTime;

      if (timedOut) {
        logStream.write(`\n=== Container Completed (TIMEOUT) ===\n`);
        logStream.write(`Duration: ${duration}ms\n`);
        logStream.write(`Exit Code: ${code}\n`);
        logStream.write(`Had Streaming Output: ${hadStreamingOutput}\n`);
        logStream.end();

        // Timeout after output = idle cleanup, not failure.
        // The agent already sent its response; this is just the
        // container being reaped after the idle period expired.
        if (hadStreamingOutput) {
          logger.info(
            { group: group.name, containerName, duration, code },
            'Container timed out after output (idle cleanup)',
          );
          outputChain.then(() => {
            resolve({
              status: 'success',
              result: null,
              newSessionId,
            });
          });
          return;
        }

        logger.error(
          { group: group.name, containerName, duration, code },
          'Container timed out with no output',
        );

        resolve({
          status: 'error',
          result: null,
          error: `Container timed out after ${configTimeout}ms`,
        });
        return;
      }

      const isVerbose =
        process.env.LOG_LEVEL === 'debug' || process.env.LOG_LEVEL === 'trace';
      const isError = code !== 0;

      // Append completion summary to live log
      logStream.write(`\n=== Container Completed ===\n`);
      logStream.write(`Duration: ${duration}ms\n`);
      logStream.write(`Exit Code: ${code}\n`);
      logStream.write(`Stdout Truncated: ${stdoutTruncated}\n`);
      logStream.write(`Stderr Truncated: ${stderrTruncated}\n`);

      if (isVerbose || isError) {
        logStream.write(`\n=== Input ===\n${JSON.stringify(input, null, 2)}\n`);
        logStream.write(
          `\n=== Container Args ===\n${containerArgs.join(' ')}\n`,
        );
      }
      logStream.end();
      logger.debug({ logFile, verbose: isVerbose }, 'Container log written');

      if (code !== 0) {
        // code === null means the process was killed by a signal (SIGKILL).
        // Most common cause: OOM killer when container exceeds memory limit.
        const isOomLikely = code === null;
        const errorDetail = isOomLikely
          ? 'Container was killed (likely out of memory)'
          : `Container exited with code ${code}`;

        logger.error(
          {
            group: group.name,
            code,
            duration,
            stderr,
            stdout,
            logFile,
            isOomLikely,
          },
          isOomLikely ? 'Container OOM killed' : 'Container exited with error',
        );

        resolve({
          status: 'error',
          result: null,
          error: `${errorDetail}: ${stderr.slice(-200)}`,
        });
        return;
      }

      // Streaming mode: wait for output chain to settle, return completion marker
      if (onOutput) {
        outputChain.then(() => {
          logger.info(
            { group: group.name, duration, newSessionId },
            'Container completed (streaming mode)',
          );
          resolve({
            status: 'success',
            result: null,
            newSessionId,
          });
        });
        return;
      }

      // Legacy mode: parse the last output marker pair from accumulated stdout
      try {
        // Extract JSON between sentinel markers for robust parsing
        const startIdx = stdout.indexOf(OUTPUT_START_MARKER);
        const endIdx = stdout.indexOf(OUTPUT_END_MARKER);

        let jsonLine: string;
        if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
          jsonLine = stdout
            .slice(startIdx + OUTPUT_START_MARKER.length, endIdx)
            .trim();
        } else {
          // Fallback: last non-empty line (backwards compatibility)
          const lines = stdout.trim().split('\n');
          jsonLine = lines[lines.length - 1];
        }

        const output: ContainerOutput = JSON.parse(jsonLine);

        logger.info(
          {
            group: group.name,
            duration,
            status: output.status,
            hasResult: !!output.result,
          },
          'Container completed',
        );

        resolve(output);
      } catch (err) {
        logger.error(
          {
            group: group.name,
            stdout,
            stderr,
            error: err,
          },
          'Failed to parse container output',
        );

        resolve({
          status: 'error',
          result: null,
          error: `Failed to parse container output: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    });

    container.on('error', (err) => {
      clearTimeout(timeout);
      logger.error(
        { group: group.name, containerName, error: err },
        'Container spawn error',
      );
      resolve({
        status: 'error',
        result: null,
        error: `Container spawn error: ${err.message}`,
      });
    });
  });
}

export function writeTasksSnapshot(
  groupFolder: string,
  isMain: boolean,
  tasks: Array<{
    id: string;
    groupFolder: string;
    prompt: string;
    schedule_type: string;
    schedule_value: string;
    status: string;
    next_run: string | null;
  }>,
): void {
  // Write filtered tasks to the group's IPC directory
  const groupIpcDir = path.join(DATA_DIR, 'ipc', groupFolder);
  fs.mkdirSync(groupIpcDir, { recursive: true });

  // All groups see all tasks so agents can answer questions about scheduled tasks
  // regardless of which group they're running in.
  const filteredTasks = tasks;

  const tasksFile = path.join(groupIpcDir, 'current_tasks.json');
  fs.writeFileSync(tasksFile, JSON.stringify(filteredTasks, null, 2));
}

export interface AvailableGroup {
  jid: string;
  name: string;
  lastActivity: string;
  isRegistered: boolean;
}

/**
 * Write available groups snapshot for the container to read.
 * Only main group can see all available groups (for activation).
 * Non-main groups only see their own registration status.
 */
export function writeGroupsSnapshot(
  groupFolder: string,
  isMain: boolean,
  groups: AvailableGroup[],
  registeredJids: Set<string>,
): void {
  const groupIpcDir = path.join(DATA_DIR, 'ipc', groupFolder);
  fs.mkdirSync(groupIpcDir, { recursive: true });

  // Main sees all groups; others see nothing (they can't activate groups)
  const visibleGroups = isMain ? groups : [];

  const groupsFile = path.join(groupIpcDir, 'available_groups.json');
  fs.writeFileSync(
    groupsFile,
    JSON.stringify(
      {
        groups: visibleGroups,
        lastSync: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}
