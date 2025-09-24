import { ChildProcess, spawn } from 'child_process';
import * as fs from 'fs';
import { StartAction } from '../../actions/start.action';
import { Input } from '../../commands';
import { treeKillSync } from '../../lib/utils/tree-kill';

// Mock external dependencies
jest.mock('child_process');
jest.mock('fs');
jest.mock('../../lib/utils/tree-kill');

const mockSpawn = spawn as jest.MockedFunction<typeof spawn>;
const mockTreeKillSync = treeKillSync as jest.MockedFunction<typeof treeKillSync>;
const mockFs = fs as jest.Mocked<typeof fs>;

// Mock child process
const createMockChildProcess = (pid = 1234): Partial<ChildProcess> => ({
  pid,
  stdin: {
    pause: jest.fn(),
  } as any,
  removeAllListeners: jest.fn(),
  on: jest.fn(),
  kill: jest.fn(),
});

describe('StartAction', () => {
  let startAction: StartAction;
  let mockChildProcess: Partial<ChildProcess>;
  let consoleLogSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;
  let processExitSpy: jest.SpyInstance;

  const mockCommandInputs: Input[] = [
    { name: 'app', value: 'test-app' }
  ];

  const mockCommandOptions: Input[] = [
    { name: 'config', value: 'nest-cli.json' },
    { name: 'watch', value: true },
    { name: 'debug', value: false }
  ];

  const mockConfiguration = {
    sourceRoot: 'src',
    entryFile: 'main',
    exec: 'node',
    compilerOptions: {},
  };

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup spies
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    processExitSpy = jest.spyOn(process, 'exit').mockImplementation();

    // Setup mock child process
    mockChildProcess = createMockChildProcess();
    mockSpawn.mockReturnValue(mockChildProcess as ChildProcess);

    // Setup file system mocks
    mockFs.existsSync.mockReturnValue(true);

    // Create StartAction instance with mocked dependencies
    startAction = new StartAction();
    
    // Mock the loader
    (startAction as any).loader = {
      load: jest.fn().mockResolvedValue(mockConfiguration),
    };

    // Mock the tsConfigProvider
    (startAction as any).tsConfigProvider = {
      getByConfigFilename: jest.fn().mockReturnValue({
        options: { outDir: 'dist' }
      }),
    };

    // Mock runBuild method from parent BuildAction
    jest.spyOn(startAction, 'runBuild').mockResolvedValue(undefined);
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  describe('handle', () => {
    it('should execute build and success callback', async () => {
      await startAction.handle(mockCommandInputs, mockCommandOptions);

      expect((startAction as any).loader.load).toHaveBeenCalledWith('nest-cli.json');
      expect(startAction.runBuild).toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
      const error = new Error('Build failed');
      jest.spyOn(startAction, 'runBuild').mockRejectedValue(error);

      await startAction.handle(mockCommandInputs, mockCommandOptions);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Build failed')
      );
    });

    it('should handle non-Error exceptions', async () => {
      const errorMessage = 'String error message';
      jest.spyOn(startAction, 'runBuild').mockRejectedValue(errorMessage);

      await startAction.handle(mockCommandInputs, mockCommandOptions);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining(errorMessage)
      );
    });
  });

  describe('createOnSuccessHook', () => {
    let onSuccessHook: () => void;
    let mockProcessOn: jest.SpyInstance;

    beforeEach(() => {
      mockProcessOn = jest.spyOn(process, 'on').mockImplementation();
      onSuccessHook = startAction.createOnSuccessHook(
        'main',
        'src',
        false,
        'dist',
        'node',
        { shell: false, envFile: [] }
      );
    });

    afterEach(() => {
      mockProcessOn.mockRestore();
    });

    it('should register process exit handler with treeKillSync', () => {
      expect(mockProcessOn).toHaveBeenCalledWith(
        'exit',
        expect.any(Function)
      );

      // Simulate process exit
      const exitHandler = mockProcessOn.mock.calls[0][1];
      exitHandler();

      // Should not call treeKillSync since no child process exists yet
      expect(mockTreeKillSync).not.toHaveBeenCalled();
    });

    describe('when no child process exists', () => {
      it('should spawn new child process', () => {
        onSuccessHook();

        expect(mockSpawn).toHaveBeenCalledWith(
          'node',
          expect.arrayContaining([
            '--enable-source-maps',
            expect.stringContaining('dist')
          ]),
          expect.objectContaining({
            stdio: 'inherit',
            shell: false
          })
        );
      });

      it('should handle shell option', () => {
        const hookWithShell = startAction.createOnSuccessHook(
          'main',
          'src',
          false,
          'dist',
          'node',
          { shell: true, envFile: [] }
        );

        hookWithShell();

        expect(mockSpawn).toHaveBeenCalledWith(
          'node',
          expect.any(Array),
          expect.objectContaining({
            shell: true
          })
        );
      });

      it('should handle debug flag', () => {
        const hookWithDebug = startAction.createOnSuccessHook(
          'main',
          'src',
          true,
          'dist',
          'node',
          { shell: false, envFile: [] }
        );

        hookWithDebug();

        expect(mockSpawn).toHaveBeenCalledWith(
          'node',
          expect.arrayContaining(['--inspect']),
          expect.any(Object)
        );
      });

      it('should handle custom debug port', () => {
        const hookWithDebugPort = startAction.createOnSuccessHook(
          'main',
          'src',
          '0.0.0.0:9229',
          'dist',
          'node',
          { shell: false, envFile: [] }
        );

        hookWithDebugPort();

        expect(mockSpawn).toHaveBeenCalledWith(
          'node',
          expect.arrayContaining(['--inspect=0.0.0.0:9229']),
          expect.any(Object)
        );
      });

      it('should handle env files', () => {
        const hookWithEnvFile = startAction.createOnSuccessHook(
          'main',
          'src',
          false,
          'dist',
          'node',
          { shell: false, envFile: ['.env', '.env.local'] }
        );

        hookWithEnvFile();

        expect(mockSpawn).toHaveBeenCalledWith(
          'node',
          expect.arrayContaining([
            '--env-file=.env --env-file=.env.local'
          ]),
          expect.any(Object)
        );
      });

      it('should handle command line arguments', () => {
        const originalArgv = process.argv;
        process.argv = ['node', 'nest', 'start', '--', 'arg1', 'arg2'];

        onSuccessHook();

        expect(mockSpawn).toHaveBeenCalledWith(
          'node',
          expect.arrayContaining(['"arg1"', '"arg2"']),
          expect.any(Object)
        );

        process.argv = originalArgv;
      });
    });

    describe('when child process exists', () => {
      beforeEach(() => {
        // First call creates child process
        onSuccessHook();
        jest.clearAllMocks();
      });

      it('should kill existing process and restart', () => {
        const mockChildProcess = createMockChildProcess();
        mockSpawn.mockReturnValue(mockChildProcess as ChildProcess);

        onSuccessHook();

        expect(mockChildProcess.removeAllListeners).toHaveBeenCalledWith('exit');
        expect((mockChildProcess.stdin as any)?.pause).toHaveBeenCalled();
        expect(mockTreeKillSync).toHaveBeenCalledWith(1234);
      });

      it('should handle process exit during restart', () => {
        const mockChildProcess = createMockChildProcess();
        let exitCallback: () => void;

        mockChildProcess.on = jest.fn().mockImplementation((event, callback) => {
          if (event === 'exit') {
            exitCallback = callback;
          }
        });

        mockSpawn.mockReturnValue(mockChildProcess as ChildProcess);

        onSuccessHook();

        // Simulate exit event
        exitCallback!();

        // Should spawn a new process after exit
        expect(mockSpawn).toHaveBeenCalledTimes(2);
      });
    });

    describe('process exit handler', () => {
      it('should call treeKillSync when process exits with active child', () => {
        // Create child process
        onSuccessHook();

        // Get the exit handler that was registered
        const exitHandler = mockProcessOn.mock.calls[0][1];
        
        // Simulate process exit
        exitHandler();

        expect(mockTreeKillSync).toHaveBeenCalledWith(1234);
      });

      it('should not call treeKillSync when no child process exists', () => {
        // Don't create child process, just get exit handler
        const exitHandler = mockProcessOn.mock.calls[0][1];
        
        // Simulate process exit
        exitHandler();

        expect(mockTreeKillSync).not.toHaveBeenCalled();
      });
    });
  });

  describe('spawnChildProcess (via onSuccessHook)', () => {
    it('should create process with correct arguments', () => {
      const onSuccessHook = startAction.createOnSuccessHook(
        'main',
        'src',
        false,
        'dist',
        'node',
        { shell: false, envFile: [] }
      );

      onSuccessHook();

      expect(mockSpawn).toHaveBeenCalledWith(
        'node',
        expect.arrayContaining([
          '--enable-source-maps',
          expect.stringMatching(/dist.*main/)
        ]),
        expect.objectContaining({
          stdio: 'inherit',
          shell: false
        })
      );
    });

    it('should handle spaces in output path', () => {
      mockFs.existsSync.mockReturnValue(true);

      const onSuccessHook = startAction.createOnSuccessHook(
        'main with spaces',
        'src',
        false,
        'dist',
        'node',
        { shell: false, envFile: [] }
      );

      onSuccessHook();

      expect(mockSpawn).toHaveBeenCalledWith(
        'node',
        expect.arrayContaining([
          expect.stringMatching(/^".*main with spaces.*"$/)
        ]),
        expect.any(Object)
      );
    });

    it('should fallback to alternative output path when file does not exist', () => {
      mockFs.existsSync.mockReturnValue(false);

      const onSuccessHook = startAction.createOnSuccessHook(
        'main',
        'src',
        false,
        'dist',
        'node',
        { shell: false, envFile: [] }
      );

      onSuccessHook();

      // Should check both paths
      expect(mockFs.existsSync).toHaveBeenCalledWith(expect.stringMatching(/dist.*src.*main\.js/));
      expect(mockSpawn).toHaveBeenCalledWith(
        'node',
        expect.arrayContaining([
          expect.stringMatching(/dist.*main/)
        ]),
        expect.any(Object)
      );
    });

    it('should handle different binary executors', () => {
      const onSuccessHook = startAction.createOnSuccessHook(
        'main',
        'src',
        false,
        'dist',
        'tsx',
        { shell: false, envFile: [] }
      );

      onSuccessHook();

      expect(mockSpawn).toHaveBeenCalledWith('tsx', expect.any(Array), expect.any(Object));
    });
  });

  describe('Integration scenarios', () => {
    it('should handle complete start workflow with watch mode', async () => {
      const watchOptions: Input[] = [
        { name: 'config', value: 'nest-cli.json' },
        { name: 'watch', value: true }
      ];

      await startAction.handle(mockCommandInputs, watchOptions);

      // Should load configuration
      expect((startAction as any).loader.load).toHaveBeenCalled();
      
      // Should run build with watch enabled
      expect(startAction.runBuild).toHaveBeenCalledWith(
        mockCommandInputs,
        watchOptions,
        true, // watch enabled
        false, // watch assets disabled
        false, // debug disabled
        expect.any(Function) // onSuccess callback
      );
    });

    it('should handle process lifecycle correctly', () => {
      const onSuccessHook = startAction.createOnSuccessHook(
        'main',
        'src',
        false,
        'dist',
        'node',
        { shell: false, envFile: [] }
      );

      // Start process
      onSuccessHook();
      expect(mockSpawn).toHaveBeenCalledTimes(1);

      // Restart process (simulate file change)
      onSuccessHook();
      expect(mockTreeKillSync).toHaveBeenCalledWith(1234);
      expect(mockSpawn).toHaveBeenCalledTimes(2);
    });

    it('should handle multiple rapid restarts', () => {
      const onSuccessHook = startAction.createOnSuccessHook(
        'main',
        'src',
        false,
        'dist',
        'node',
        { shell: false, envFile: [] }
      );

      // Simulate rapid restarts
      onSuccessHook(); // First start
      onSuccessHook(); // First restart
      onSuccessHook(); // Second restart

      expect(mockTreeKillSync).toHaveBeenCalledTimes(2);
      expect(mockSpawn).toHaveBeenCalledTimes(3);
    });
  });
});