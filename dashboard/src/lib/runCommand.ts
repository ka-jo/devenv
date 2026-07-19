import { logDebug } from "./log.ts";

const SHOW_CURSOR = "\x1b[?25h";
const HIDE_CURSOR = "\x1b[?25l";
const CLEAR_SCREEN = "\x1b[2J\x1b[H";
// Ink's own alternate screen closes on unmount (App.tsx unmounts before calling
// runCommand, to hand stdin control to the child), so without these the child's
// output would land in the primary buffer's scrollback instead of being discarded
// with the rest of the dashboard's alt-screen contents on quit.
const ENTER_ALT_SCREEN = "\x1b[?1049h";
const EXIT_ALT_SCREEN = "\x1b[?1049l";

/** Ctrl-] (0x1d) — a classic telnet/console escape byte, forces the child to be killed. */
const DETACH_KEY = 0x1d;

/** Normalizes a `process.stdin` "data" chunk to a `Buffer`, decoding latin1 if it arrived as a string. */
function toBuffer(chunk: Buffer | string): Buffer {
    // Ink's handleSetRawMode calls stdin.setEncoding('utf8') once any useInput hook goes
    // active, with no public API to undo it — latin1 is a lossless single-byte round trip,
    // unlike utf8 which would corrupt non-UTF8 bytes in the raw pty stream.
    return typeof chunk === "string" ? Buffer.from(chunk, "latin1") : chunk;
}

/** Bytes signaling a completed input line, used to detect the "press Enter to continue" gate. */
const isEnterKeypress = (chunk: Buffer): boolean => chunk.includes(0x0d) || chunk.includes(0x0a);

/** Whether a chunk contains the detach key ({@link DETACH_KEY}). */
const isDetachKeypress = (chunk: Buffer): boolean => chunk.includes(DETACH_KEY);

/**
 * Runs a devenv subcommand under a real pseudo-terminal, bridging the
 * dashboard's stdin/stdout to it so the child sees a genuine TTY.
 * @param command - The command text as typed, for the echoed prompt line.
 * @param args - Arguments to pass to the `devenv` binary (already split).
 * @returns The subprocess's exit code.
 */
export async function runCommand(command: string, args: readonly string[]): Promise<number> {
    // Reads raw stdin directly, bypassing Ink — callers must fully unmount Ink first, not
    // just deactivate useInput hooks, since Ink disables raw mode once no hook is active.
    let child: ReturnType<typeof Bun.spawn> | undefined;

    const terminal = new Bun.Terminal({
        cols: process.stdout.columns ?? 80,
        rows: process.stdout.rows ?? 24,
        data: (_terminal, data): void => {
            process.stdout.write(data);
        },
    });

    const forwardInput = (rawChunk: Buffer | string): void => {
        const chunk = toBuffer(rawChunk);
        if (isDetachKeypress(chunk)) {
            logDebug("runCommand", "detach key pressed, killing child");
            child?.kill();
            return;
        }
        terminal.write(chunk);
    };
    const forwardResize = (): void => {
        terminal.resize(process.stdout.columns ?? 80, process.stdout.rows ?? 24);
    };

    try {
        if (process.stdin.isTTY) {
            process.stdin.setRawMode(true);
        }
        process.stdin.setEncoding("latin1");
        process.stdin.resume();

        process.stdout.write(
            `${ENTER_ALT_SCREEN}${CLEAR_SCREEN}${SHOW_CURSOR}\x1b[91mdevenv › ${command}\x1b[0m  \x1b[2m(Ctrl-] to force-detach)\x1b[0m\r\n\r\n`,
        );

        child = Bun.spawn(["devenv", ...args], { terminal });

        process.stdin.on("data", forwardInput);
        process.stdout.on("resize", forwardResize);

        logDebug("runCommand", `spawned, waiting for exit: ${args.join(" ")}`);
        const exitCode = await child.exited;
        logDebug("runCommand", `child exited with code ${exitCode}`);

        process.stdin.off("data", forwardInput);
        process.stdout.off("resize", forwardResize);

        // Wait for Enter/Ctrl-] before returning, so the child's output stays on screen
        // instead of being replaced by the dashboard's next repaint.
        process.stdout.write(`\r\n\x1b[2m[exit ${exitCode} — press Enter to continue]\x1b[0m`);
        await new Promise<void>((resolve): void => {
            const waitForContinue = (rawChunk: Buffer | string): void => {
                const chunk = toBuffer(rawChunk);
                logDebug("runCommand", `waitForContinue saw bytes: ${JSON.stringify([...chunk])}`);
                if (isEnterKeypress(chunk) || isDetachKeypress(chunk)) {
                    process.stdin.off("data", waitForContinue);
                    resolve();
                }
            };
            process.stdin.on("data", waitForContinue);
        });

        return exitCode;
    } finally {
        process.stdin.off("data", forwardInput);
        process.stdout.off("resize", forwardResize);
        terminal.close();
        process.stdout.write(`${HIDE_CURSOR}${EXIT_ALT_SCREEN}`);
    }
}
