import { execSync } from 'child_process';
import killProcessTree from '../../../lib/utils/tree-kill';

jest.mock('child_process');

const mockExecSync = execSync as jest.MockedFunction<typeof execSync>;
const mockProcessKill = jest
  .spyOn(process, 'kill')
  .mockImplementation(() => true);

let mockPlatform: string = 'linux';
Object.defineProperty(process, 'platform', {
  get: () => mockPlatform,
  configurable: true,
});

describe('killProcessTree', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPlatform = 'linux';
    mockProcessKill.mockImplementation(() => true);
  });

  describe('Platform Detection', () => {
    it('should use taskkill on win32', () => {
      mockPlatform = 'win32';

      killProcessTree(1234);

      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringMatching(/^taskkill.*$/),
        expect.any(Object),
      );
    });

    it('should use pgrep on MacOS', () => {
      mockPlatform = 'darwin';
      mockExecSync.mockReturnValue('');

      killProcessTree(1234);

      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringMatching(/^pgrep.*$/),
        { encoding: 'utf8', timeout: 2000, stdio: 'pipe' },
      );
    });

    it('should use ps on linux', () => {
      mockPlatform = 'linux';
      mockExecSync.mockReturnValue('');

      killProcessTree(1234);

      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringMatching(/^ps.*$/),
        expect.any(Object),
      );
    });

    it('should use ps on unknown platforms', () => {
      mockPlatform = 'freebsd';
      mockExecSync.mockReturnValue('');

      killProcessTree(1234);

      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringMatching(/^ps.*$/),
        expect.any(Object),
      );
    });
  });

  describe('Windows Implementation', () => {
    beforeEach(() => {
      mockPlatform = 'win32';
    });

    it('should ignore "not found" errors', () => {
      const error = new Error('Process not found');
      error.message = 'not found';
      mockExecSync.mockImplementation(() => {
        throw error;
      });

      expect(() => killProcessTree(1234)).not.toThrow();
    });

    it('should throw non-"not found" errors', () => {
      const error = new Error('Access denied');
      mockExecSync.mockImplementation(() => {
        throw error;
      });

      expect(() => killProcessTree(1234)).toThrow('Access denied');
    });
  });

  describe('macOS Implementation', () => {
    beforeEach(() => {
      mockPlatform = 'darwin';
      mockExecSync.mockReset();
    });

    it('should handle single process with no children', () => {
      mockExecSync.mockReturnValue('');

      killProcessTree(1234);

      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringMatching(/^pgrep.*$/),
        expect.any(Object),
      );

      expect(mockProcessKill).toHaveBeenCalledWith(1234, 'SIGTERM');
    });

    it('should handle nested process tree', () => {
      mockExecSync
        .mockReturnValueOnce('5678') // Children of 1234
        .mockReturnValueOnce('9012') // Children of 5678
        .mockReturnValueOnce(''); // Children of 9012 (none)

      killProcessTree(1234);

      expect(mockProcessKill).toHaveBeenCalledWith(9012, 'SIGTERM'); // Grandchild first
      expect(mockProcessKill).toHaveBeenCalledWith(5678, 'SIGTERM'); // Child second
      expect(mockProcessKill).toHaveBeenCalledWith(1234, 'SIGTERM'); // Parent last
    });

    it('should handle pgrep status 1 (no processes found) gracefully', () => {
      const error: any = new Error('Command failed');
      error.status = 1;
      error.stderr = ''; // Empty stderr means "no processes found"
      error.stdout = ''; // Empty stdout means "no processes found"
      mockExecSync.mockImplementation(() => {
        throw error;
      });

      killProcessTree(1234);

      expect(mockProcessKill).toHaveBeenCalledWith(1234, 'SIGTERM');
    });
  });

  describe('Unix/Linux Implementation', () => {
    beforeEach(() => {
      mockPlatform = 'linux';
    });

    it('should handle process tree with children', () => {
      mockExecSync
        .mockReturnValueOnce('  5678\n  9012  ') // Children of 1234
        .mockReturnValueOnce('') // Children of 5678 (none)
        .mockReturnValueOnce(''); // Children of 9012 (none)

      killProcessTree(1234);

      expect(mockExecSync).toHaveBeenCalledTimes(3);
      expect(mockProcessKill).toHaveBeenCalledWith(5678, 'SIGTERM');
      expect(mockProcessKill).toHaveBeenCalledWith(9012, 'SIGTERM');
      expect(mockProcessKill).toHaveBeenCalledWith(1234, 'SIGTERM');
    });

    it('should throw on ps error with output', () => {
      const error = new Error('ps command failed') as any;
      error.status = 1;
      error.stderr = 'ps: invalid option';

      mockExecSync.mockImplementation(() => {
        throw error;
      });

      expect(() => killProcessTree(1234)).toThrow(error);
    });

    it('should filter out invalid PIDs from ps output', () => {
      mockExecSync
        .mockReturnValueOnce('  5678\n  invalid\n  9012  ')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('');

      killProcessTree(1234);

      expect(mockProcessKill).toHaveBeenCalledWith(5678, 'SIGTERM');
      expect(mockProcessKill).toHaveBeenCalledWith(9012, 'SIGTERM');
      expect(mockProcessKill).toHaveBeenCalledWith(1234, 'SIGTERM');
      expect(mockProcessKill).toHaveBeenCalledTimes(3); // Should not try to kill 'invalid'
    });

    it('should handle ps status 1 (no processes found) gracefully', () => {
      const error: any = new Error('Command failed');
      error.status = 1;
      error.stderr = ''; // Empty stderr means "no processes found"
      error.stdout = ''; // Empty stdout means "no processes found"
      mockExecSync.mockImplementation(() => {
        throw error;
      });

      killProcessTree(1234);

      expect(mockProcessKill).toHaveBeenCalledWith(1234, 'SIGTERM');
    });

    it('should throw ps status 1 errors with output (unknown error)', () => {
      const error: any = new Error('Command failed');
      error.status = 1;
      error.stderr = 'ps: unknown option'; // Non-empty stderr means unknown error
      error.stdout = '';
      mockExecSync.mockImplementation(() => {
        throw error;
      });

      expect(() => killProcessTree(1234)).toThrow('Command failed');
    });
  });

  describe('Process Killing Logic', () => {
    beforeEach(() => {
      mockPlatform = 'darwin';
    });

    it('should ignore ESRCH errors (process not found)', () => {
      mockExecSync.mockReturnValue('');
      const error: any = new Error('No such process');
      error.code = 'ESRCH';
      mockProcessKill.mockImplementation(() => {
        throw error;
      });

      expect(() => killProcessTree(1234)).not.toThrow();
    });

    it('should throw non-ESRCH errors', () => {
      mockExecSync.mockReturnValue('');
      const error: any = new Error('Permission denied');
      error.code = 'EPERM';
      mockProcessKill.mockImplementationOnce(() => {
        throw error;
      });

      expect(() => killProcessTree(1234)).toThrow('Permission denied');

      // Reset the mock after the test
      mockProcessKill.mockImplementation(() => true);
    });

    it('should kill children before parents', () => {
      mockExecSync
        .mockReturnValueOnce('5678') // Children of 1234
        .mockReturnValueOnce('9012') // Children of 5678
        .mockReturnValueOnce(''); // Children of 9012 (none)

      killProcessTree(1234);

      // Verify all processes were killed
      expect(mockProcessKill).toHaveBeenCalledWith(9012, 'SIGTERM');
      expect(mockProcessKill).toHaveBeenCalledWith(5678, 'SIGTERM');
      expect(mockProcessKill).toHaveBeenCalledWith(1234, 'SIGTERM');
      expect(mockProcessKill).toHaveBeenCalledTimes(3);
    });
  });

  describe('Edge Cases', () => {
    it('should handle custom signals (string and numeric)', () => {
      mockPlatform = 'darwin';
      mockExecSync.mockReturnValue('');

      killProcessTree(1234, 'SIGKILL');
      expect(mockProcessKill).toHaveBeenCalledWith(1234, 'SIGKILL');

      killProcessTree(5678, 9); // SIGKILL is signal 9
      expect(mockProcessKill).toHaveBeenCalledWith(5678, 9);
    });

    it('should handle undefined signal (uses default)', () => {
      mockPlatform = 'darwin';
      mockExecSync.mockReturnValue('');

      killProcessTree(1234, undefined);

      expect(mockProcessKill).toHaveBeenCalledWith(1234, 'SIGTERM');
    });

    it('should handle empty string from command output', () => {
      mockPlatform = 'darwin';
      mockExecSync.mockReturnValue('   \n   \n   ');

      killProcessTree(1234);

      expect(mockProcessKill).toHaveBeenCalledWith(1234, 'SIGTERM');
      expect(mockProcessKill).toHaveBeenCalledTimes(1);
    });
  });
});
