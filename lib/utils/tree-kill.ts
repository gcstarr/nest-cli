import { execSync } from 'child_process';

type Signal = NodeJS.Signals | number | undefined;
type ProcessTree = Record<number, number[]>;

function errorIndicatesNoChildProcesses(error: any): boolean {
  if (process.platform === 'darwin') {
    // pgrep exits with status 1 if no children are found
    // other errors are 2+
    return error.status === 1;
  }

  // ps exits with status 1 for any error but there is specifically
  // no output if "error" is that no children are found
  return (
    error.status === 1 &&
    (!error.stderr || error.stderr.trim() === '') &&
    (!error.stdout || error.stdout.trim() === '')
  );
}

function buildProcessTree(pid: number): ProcessTree {
  const tree: ProcessTree = { [pid]: [] };
  const toProcess = [pid];

  while (toProcess.length > 0) {
    const currentPid = toProcess.shift()!;
    const treeOutput = callProcessTreeUtility(currentPid);
    if (!treeOutput) {
      tree[currentPid] = [];
      continue;
    }

    const childPids = (treeOutput.match(/\d+/g) || [])
      .map(Number)
      .filter((pid) => !Number.isNaN(pid));
    tree[currentPid] = childPids;
    childPids.forEach((childPid) => {
      tree[childPid] = [];
      toProcess.push(childPid);
    });
  }

  return tree;
}

function killProcess(pid: number, signal: Signal = 'SIGTERM'): void {
  try {
    process.kill(pid, signal);
  } catch (error: any) {
    // ESRCH means process doesn't exist, which is fine
    if (error.code !== 'ESRCH') {
      throw error;
    }
  }
}

function callProcessTreeUtility(pid: number) {
  let cmd: string;
  if (process.platform === 'darwin') {
    cmd = `pgrep -P ${pid}`;
  } else {
    cmd = `ps -o pid --no-headers --ppid ${pid}`;
  }

  try {
    return execSync(cmd, {
      encoding: 'utf8',
      timeout: 2000,
      stdio: 'pipe',
    });
  } catch (error: any) {
    if (errorIndicatesNoChildProcesses(error)) {
      return null;
    }

    throw error;
  }
}

function killWindowsProcess(pid: number): void {
  try {
    execSync(`taskkill /pid ${pid} /T /F`, {
      stdio: 'pipe',
      timeout: 5000,
    });
  } catch (error: any) {
    if (!error.message?.includes('not found')) {
      throw error;
    }
  }
}

function terminateProcessAndDescendants(
  pid: number,
  tree: ProcessTree,
  signal: Signal,
): void {
  const descendants = tree[pid] || [];
  descendants.forEach((descendantPid) => {
    terminateProcessAndDescendants(descendantPid, tree, signal);
  });

  killProcess(pid, signal);
}

/**
 * Kill a process and any subprocesses
 */
export default function killProcessTree(
  pid: number,
  signal: Signal = 'SIGTERM',
): void {
  if (process.platform === 'win32') {
    killWindowsProcess(pid);
  } else {
    const tree = buildProcessTree(pid);
    terminateProcessAndDescendants(pid, tree, signal);
  }
}
