import { execSync } from 'child_process';
import { treeKillSync } from '../../../lib/utils/tree-kill';

jest.mock('child_process');
const mockExecSync = execSync as jest.MockedFunction<typeof execSync>;

describe('treeKillSync', () => {
  const originalPlatform = process.platform;
  const originalKill = process.kill;
  let mockProcessKill: jest.MockedFunction<typeof process.kill>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockProcessKill = jest.fn();
    Object.defineProperty(process, 'kill', {
      value: mockProcessKill,
      writable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
      writable: true,
    });
    Object.defineProperty(process, 'kill', {
      value: originalKill,
      writable: true,
    });
  });

  describe('Windows platform', () => {
    beforeEach(() => {
      Object.defineProperty(process, 'platform', {
        value: 'win32',
        writable: true,
      });
    });

    it('should use wmic to find and kill child processes', () => {
      const parentPid = 1234;
      const childPids = ['5678', '9012'];
      
      // Mock wmic output
      mockExecSync
        .mockReturnValueOnce(`ProcessId\r\n${childPids[0]}\r\n${childPids[1]}\r\n`)
        .mockReturnValueOnce('') // No grandchildren for first child
        .mockReturnValueOnce(''); // No grandchildren for second child

      treeKillSync(parentPid);

      // Should call wmic for parent process
      expect(mockExecSync).toHaveBeenCalledWith(
        `wmic process where (ParentProcessId=${parentPid}) get ProcessId`,
        { encoding: 'utf8', timeout: 5000 }
      );

      // Should kill child processes first
      expect(mockProcessKill).toHaveBeenCalledWith(5678, undefined);
      expect(mockProcessKill).toHaveBeenCalledWith(9012, undefined);
      
      // Should kill parent process last
      expect(mockProcessKill).toHaveBeenCalledWith(parentPid, undefined);
      
      expect(mockProcessKill).toHaveBeenCalledTimes(3);
    });

    it('should fallback to PowerShell if wmic fails', () => {
      const parentPid = 1234;
      const childPid = 5678;

      // Mock wmic failure and PowerShell success
      mockExecSync
        .mockImplementationOnce(() => {
          throw new Error('wmic failed');
        })
        .mockReturnValueOnce(`${childPid}\n`)
        .mockReturnValueOnce(''); // No grandchildren

      treeKillSync(parentPid);

      // Should try wmic first
      expect(mockExecSync).toHaveBeenCalledWith(
        `wmic process where (ParentProcessId=${parentPid}) get ProcessId`,
        { encoding: 'utf8', timeout: 5000 }
      );

      // Should fallback to PowerShell
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('powershell'),
        { encoding: 'utf8', timeout: 5000 }
      );

      expect(mockProcessKill).toHaveBeenCalledWith(childPid, undefined);
      expect(mockProcessKill).toHaveBeenCalledWith(parentPid, undefined);
    });

    it('should handle case where no child processes exist', () => {
      const parentPid = 1234;

      // Mock empty wmic output
      mockExecSync.mockReturnValue('ProcessId\r\n');

      treeKillSync(parentPid);

      // Should only kill parent process
      expect(mockProcessKill).toHaveBeenCalledWith(parentPid, undefined);
      expect(mockProcessKill).toHaveBeenCalledTimes(1);
    });
  });

  describe('Unix-like platforms (Linux/macOS)', () => {
    beforeEach(() => {
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        writable: true,
      });
    });

    it('should use pgrep to find and kill child processes', () => {
      const parentPid = 1234;
      const childPids = [5678, 9012];

      // Mock pgrep output
      mockExecSync
        .mockReturnValueOnce(`${childPids[0]}\n${childPids[1]}\n`)
        .mockReturnValueOnce('') // No grandchildren for first child
        .mockReturnValueOnce(''); // No grandchildren for second child

      treeKillSync(parentPid);

      // Should call pgrep for parent process
      expect(mockExecSync).toHaveBeenCalledWith(
        `pgrep -P ${parentPid}`,
        { encoding: 'utf8', timeout: 5000 }
      );

      // Should kill child processes first
      expect(mockProcessKill).toHaveBeenCalledWith(childPids[0], undefined);
      expect(mockProcessKill).toHaveBeenCalledWith(childPids[1], undefined);
      
      // Should kill parent process last
      expect(mockProcessKill).toHaveBeenCalledWith(parentPid, undefined);
      
      expect(mockProcessKill).toHaveBeenCalledTimes(3);
    });

    it('should handle recursive child processes (grandchildren)', () => {
      const parentPid = 1234;
      const childPid = 5678;
      const grandchildPid = 9012;

      // Mock pgrep output: parent has child, child has grandchild
      mockExecSync
        .mockReturnValueOnce(`${childPid}\n`) // Parent's children
        .mockReturnValueOnce(`${grandchildPid}\n`) // Child's children (grandchildren)
        .mockReturnValueOnce(''); // Grandchild has no children

      treeKillSync(parentPid);

      // Should kill grandchild first, then child, then parent
      expect(mockProcessKill).toHaveBeenCalledWith(grandchildPid, undefined);
      expect(mockProcessKill).toHaveBeenCalledWith(childPid, undefined);
      expect(mockProcessKill).toHaveBeenCalledWith(parentPid, undefined);
      
      expect(mockProcessKill).toHaveBeenCalledTimes(3);
    });

    it('should fallback to ps command if pgrep fails', () => {
      const parentPid = 1234;
      const childPid = 5678;

      // Mock pgrep failure and ps success
      mockExecSync
        .mockImplementationOnce(() => {
          throw new Error('pgrep failed');
        })
        .mockReturnValueOnce(`${childPid}\n`) // ps output
        .mockReturnValueOnce(''); // No grandchildren

      treeKillSync(parentPid);

      // Should try pgrep first
      expect(mockExecSync).toHaveBeenCalledWith(
        `pgrep -P ${parentPid}`,
        { encoding: 'utf8', timeout: 5000 }
      );

      // Should fallback to ps
      expect(mockExecSync).toHaveBeenCalledWith(
        `ps -o pid,ppid -ax | awk '$2 == ${parentPid} { print $1 }'`,
        { encoding: 'utf8', timeout: 5000 }
      );

      expect(mockProcessKill).toHaveBeenCalledWith(childPid, undefined);
      expect(mockProcessKill).toHaveBeenCalledWith(parentPid, undefined);
    });

    it('should use basic ps as final fallback', () => {
      const parentPid = 1234;
      const childPid = 5678;

      // Mock both pgrep and advanced ps failure, basic ps success
      mockExecSync
        .mockImplementationOnce(() => {
          throw new Error('pgrep failed');
        })
        .mockImplementationOnce(() => {
          throw new Error('ps with awk failed');
        })
        .mockReturnValueOnce(`${childPid}\n`) // basic ps output
        .mockReturnValueOnce(''); // No grandchildren

      treeKillSync(parentPid);

      // Should try basic ps as final fallback
      expect(mockExecSync).toHaveBeenCalledWith(
        `ps -A -o pid,ppid | grep " ${parentPid}$" | awk '{print $1}'`,
        { encoding: 'utf8', timeout: 5000 }
      );

      expect(mockProcessKill).toHaveBeenCalledWith(childPid, undefined);
      expect(mockProcessKill).toHaveBeenCalledWith(parentPid, undefined);
    });

    it('should handle case where no child processes exist (pgrep returns exit code 1)', () => {
      const parentPid = 1234;

      // Mock pgrep returning empty (throws because exit code 1)
      mockExecSync.mockImplementation(() => {
        const error = new Error('Command failed') as any;
        error.status = 1;
        throw error;
      });

      treeKillSync(parentPid);

      // Should only kill parent process
      expect(mockProcessKill).toHaveBeenCalledWith(parentPid, undefined);
      expect(mockProcessKill).toHaveBeenCalledTimes(1);
    });
  });

  describe('Signal handling', () => {
    beforeEach(() => {
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        writable: true,
      });
    });

    it('should pass custom signal to process.kill', () => {
      const parentPid = 1234;
      const signal = 'SIGTERM';

      mockExecSync.mockReturnValue(''); // No children

      treeKillSync(parentPid, signal);

      expect(mockProcessKill).toHaveBeenCalledWith(parentPid, signal);
    });

    it('should pass numeric signal to process.kill', () => {
      const parentPid = 1234;
      const signal = 9; // SIGKILL

      mockExecSync.mockReturnValue(''); // No children

      treeKillSync(parentPid, signal);

      expect(mockProcessKill).toHaveBeenCalledWith(parentPid, signal);
    });
  });

  describe('Error handling', () => {
    beforeEach(() => {
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        writable: true,
      });
    });

    it('should handle ESRCH error (process not found) gracefully', () => {
      const parentPid = 1234;
      
      mockExecSync.mockReturnValue(''); // No children
      mockProcessKill.mockImplementation(() => {
        const error = new Error('Process not found') as any;
        error.code = 'ESRCH';
        throw error;
      });

      expect(() => treeKillSync(parentPid)).not.toThrow();
    });

    it('should handle EPERM error (permission denied) gracefully', () => {
      const parentPid = 1234;
      
      mockExecSync.mockReturnValue(''); // No children
      mockProcessKill.mockImplementation(() => {
        const error = new Error('Permission denied') as any;
        error.code = 'EPERM';
        throw error;
      });

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      
      expect(() => treeKillSync(parentPid)).not.toThrow();
      // EPERM errors are silently ignored in our implementation
      expect(consoleSpy).not.toHaveBeenCalled();
      
      consoleSpy.mockRestore();
    });

    it('should handle other process.kill errors by logging warning', () => {
      const parentPid = 1234;
      
      mockExecSync.mockReturnValue(''); // No children
      mockProcessKill.mockImplementation(() => {
        const error = new Error('Some other error') as any;
        error.code = 'EOTHER';
        throw error;
      });

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      
      expect(() => treeKillSync(parentPid)).not.toThrow();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Warning: Failed to kill process'),
        'Some other error'
      );
      
      consoleSpy.mockRestore();
    });

    it('should handle complete system command failure gracefully', () => {
      const parentPid = 1234;

      // Mock all system commands failing
      mockExecSync.mockImplementation(() => {
        throw new Error('System command failed');
      });

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      expect(() => treeKillSync(parentPid)).not.toThrow();
      
      // Should still try to kill parent process
      expect(mockProcessKill).toHaveBeenCalledWith(parentPid, undefined);
      
      consoleSpy.mockRestore();
    });
  });

  describe('Edge cases', () => {
    beforeEach(() => {
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        writable: true,
      });
    });

    it('should handle malformed process output', () => {
      const parentPid = 1234;

      // Mock pgrep returning malformed data for parent, empty for child
      mockExecSync
        .mockReturnValueOnce('not-a-number\n\n  \n5678\ninvalid')
        .mockReturnValue(''); // All subsequent calls return empty (no grandchildren)

      treeKillSync(parentPid);

      // Should only kill valid PID (5678) and parent
      expect(mockProcessKill).toHaveBeenCalledWith(5678, undefined);
      expect(mockProcessKill).toHaveBeenCalledWith(parentPid, undefined);
      expect(mockProcessKill).toHaveBeenCalledTimes(2);
    });

    it('should handle empty/whitespace-only output', () => {
      const parentPid = 1234;

      mockExecSync.mockReturnValue('  \n\t\n  \r\n  ');

      treeKillSync(parentPid);

      // Should only kill parent process
      expect(mockProcessKill).toHaveBeenCalledWith(parentPid, undefined);
      expect(mockProcessKill).toHaveBeenCalledTimes(1);
    });
  });
});