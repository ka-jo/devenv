import { parseGeneratorContext } from "./context.ts";
import { GeneratorError } from "./errors.ts";
import { generateWorktreeConfig } from "./generate.ts";

// Entry point for lib/container.sh: `bun devcontainer/generator/src/cli.ts`
// with a GeneratorContext as JSON on stdin. Prints a JSON result on stdout;
// failures print `error: ...` on stderr and exit 1.

try {
  const stdin = await Bun.stdin.text();
  const context = parseGeneratorContext(stdin);
  const result = await generateWorktreeConfig(context);
  console.log(JSON.stringify(result));
} catch (error) {
  if (!(error instanceof GeneratorError)) {
    throw error;
  }
  console.error(`error: ${error.message}`);
  process.exit(1);
}
