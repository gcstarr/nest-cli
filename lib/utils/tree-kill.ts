import { execSync } from 'child_process';

export function treeKillSync(pid: number, signal?: string | number): void {
  try {
    // Get child processes using ps-tree logic but synchronously
    const children = getChildProcesses(pid);
    
    // Kill children first
    children.forEach((childPid) => {
      killPid(childPid, signal);
    });
    
    // Kill the main process
    killPid(pid, signal);
  } catch (err) {
    console.error('Error killing process tree:', err);
  }
}

function getChildProcesses(parentPid: number): number[] {
  try {
    if (process.platform === 'win32') {
      return getWindowsChildProcesses(parentPid);
    } else {
      return getUnixChildProcesses(parentPid);
    }
  } catch (err) {
    // No children found or command failed
    return [];
  }
}

function getWindowsChildProcesses(parentPid: number): number[] {
  try {
    // Try wmic first (traditional Windows)
    const command = `wmic process where (ParentProcessId=${parentPid}) get ProcessId`;
    const result = execSync(command, { encoding: 'utf8', timeout: 5000 });
    const lines = result.split('\n');
    const pids: number[] = [];
    
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line && !isNaN(parseInt(line))) {
        const childPid = parseInt(line);
        pids.push(childPid);
        // Recursively get children of children
        pids.push(...getChildProcesses(childPid));
      }
    }
    return pids;
  } catch (err) {
    // Fallback to PowerShell if wmic fails
    try {
      const psCommand = `powershell "Get-WmiObject -Class Win32_Process | Where-Object { $_.ParentProcessId -eq ${parentPid} } | Select-Object ProcessId | ForEach-Object { $_.ProcessId }"`;
      const result = execSync(psCommand, { encoding: 'utf8', timeout: 5000 });
      const pids = result
        .split('\n')
        .filter(line => line.trim())
        .map(line => parseInt(line.trim()))
        .filter(pid => !isNaN(pid));
      
      const allPids = [...pids];
      for (const childPid of pids) {
        allPids.push(...getChildProcesses(childPid));
      }
      return allPids;
    } catch (psErr) {
      return [];
    }
  }
}

function getUnixChildProcesses(parentPid: number): number[] {
  // Try multiple approaches for maximum compatibility
  
  // Method 1: pgrep (available on macOS v15 and most modern Unix systems)
  // Note: pgrep exits with code 1 when no processes found, which execSync treats as an error
  try {
    const command = `pgrep -P ${parentPid}`;
    const result = execSync(command, { encoding: 'utf8', timeout: 5000 });
    const pids = result
      .split('\n')
      .filter(line => line.trim())
      .map(line => parseInt(line.trim()))
      .filter(pid => !isNaN(pid));
    
    const allPids = [...pids];
    for (const childPid of pids) {
      allPids.push(...getChildProcesses(childPid));
    }
    return allPids;
  } catch (pgrepErr) {
    // pgrep not available or no child processes found (normal case)
    // Method 2: ps command (universal Unix fallback, works on all macOS versions including v15)
    try {
      const psCommand = `ps -o pid,ppid -ax | awk '$2 == ${parentPid} { print $1 }'`;
      const result = execSync(psCommand, { encoding: 'utf8', timeout: 5000 });
      const pids = result
        .split('\n')
        .filter(line => line.trim())
        .map(line => parseInt(line.trim()))
        .filter(pid => !isNaN(pid));
      
      const allPids = [...pids];
      for (const childPid of pids) {
        allPids.push(...getChildProcesses(childPid));
      }
      return allPids;
    } catch (psErr) {
      // Method 3: Fallback using basic ps (should work everywhere)
      try {
        const basicPsCommand = `ps -A -o pid,ppid | grep " ${parentPid}$" | awk '{print $1}'`;
        const result = execSync(basicPsCommand, { encoding: 'utf8', timeout: 5000 });
        const pids = result
          .split('\n')
          .filter(line => line.trim())
          .map(line => parseInt(line.trim()))
          .filter(pid => !isNaN(pid));
        
        const allPids = [...pids];
        for (const childPid of pids) {
          allPids.push(...getChildProcesses(childPid));
        }
        return allPids;
      } catch (basicErr) {
        return [];
      }
    }
  }
}

function killPid(pid: number, signal?: string | number) {
  try {
    process.kill(pid, signal);
  } catch (err) {
    // ESRCH: No such process (already dead)
    // EPERM: Operation not permitted (not our process)
    // These are expected and should not cause the whole operation to fail
    if (err.code !== 'ESRCH' && err.code !== 'EPERM') {
      console.warn(`Warning: Failed to kill process ${pid}:`, err.message);
    }
  }
}
