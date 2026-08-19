import { writeFile } from "node:fs/promises";
import {
  compileSchema,
  loadSchemaFile,
  type GeneratorOptions,
  type SchemaSource,
} from "@viewql/schema";

const HELP = `Usage: viewql schema <schema-file-or-url> [options]

Compile a GraphQL schema into a ViewQL TypeScript facade.

Arguments:
  schema-file-or-url             SDL file (.graphql, .graphqls, or .gql),
                                 introspection JSON file, or GraphQL endpoint URL

Options:
  -o, --output <file>            Write generated TypeScript to a file (default: stdout)
  -H, --header <name:value>      Add an HTTP introspection header (repeatable)
  --scalar <name=type>           Map a custom scalar to a TypeScript type (repeatable)
  --spec-module <module>         GraphQL spec module (default: @viewql/spec)
  --unmapped-scalars <behavior>  "unknown" (default) or "error"
  -h, --help                     Show this help
`;

export interface CliIO {
  readonly stdout: { write(value: string): unknown };
  readonly stderr: { write(value: string): unknown };
}

interface SchemaCommand {
  source: string;
  output?: string;
  headers: Record<string, string>;
  options: GeneratorOptions;
}

function valueAfter(
  args: readonly string[],
  index: number,
  option: string,
): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("-"))
    throw new TypeError(`${option} requires a value.`);
  return value;
}

function parseAssignment(
  value: string,
  option: string,
  separator: string,
): [string, string] {
  const index = value.indexOf(separator);
  if (index <= 0 || index === value.length - 1)
    throw new TypeError(
      `${option} must be in ${separator === ":" ? "name:value" : "name=type"} form.`,
    );
  return [value.slice(0, index).trim(), value.slice(index + 1).trim()];
}

function parseSchemaCommand(args: readonly string[]): SchemaCommand {
  let source: string | undefined;
  let output: string | undefined;
  let specModule: string | undefined;
  let unmappedCustomScalar: "unknown" | "error" | undefined;
  const headers: Record<string, string> = {};
  const scalarMappings: Record<string, string> = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "-o" || arg === "--output")
      output = valueAfter(args, index++, arg);
    else if (arg === "-H" || arg === "--header") {
      const [name, value] = parseAssignment(
        valueAfter(args, index++, arg),
        arg,
        ":",
      );
      headers[name] = value;
    } else if (arg === "--scalar") {
      const [name, value] = parseAssignment(
        valueAfter(args, index++, arg),
        arg,
        "=",
      );
      scalarMappings[name] = value;
    } else if (arg === "--spec-module")
      specModule = valueAfter(args, index++, arg);
    else if (arg === "--unmapped-scalars") {
      const value = valueAfter(args, index++, arg);
      if (value !== "unknown" && value !== "error")
        throw new TypeError('--unmapped-scalars must be "unknown" or "error".');
      unmappedCustomScalar = value;
    } else if (arg.startsWith("-"))
      throw new TypeError(`Unknown option: ${arg}`);
    else if (source === undefined) source = arg;
    else throw new TypeError(`Unexpected argument: ${arg}`);
  }
  if (source === undefined)
    throw new TypeError(
      "The schema command requires a schema file or endpoint URL.",
    );

  const options: GeneratorOptions = {
    ...(Object.keys(scalarMappings).length === 0 ? {} : { scalarMappings }),
    ...(specModule === undefined ? {} : { specModule }),
    ...(unmappedCustomScalar === undefined ? {} : { unmappedCustomScalar }),
  };
  return {
    source,
    ...(output === undefined ? {} : { output }),
    headers,
    options,
  };
}

function endpointSource(
  value: string,
  headers: Readonly<Record<string, string>>,
): SchemaSource | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new TypeError(`Unsupported schema URL protocol: ${url.protocol}`);
  return {
    kind: "url",
    url: url.href,
    ...(Object.keys(headers).length === 0 ? {} : { headers }),
  };
}

async function compile(command: SchemaCommand): Promise<string> {
  const endpoint = endpointSource(command.source, command.headers);
  if (endpoint !== undefined) return compileSchema(endpoint, command.options);
  if (Object.keys(command.headers).length > 0)
    throw new TypeError("HTTP headers can only be used with an endpoint URL.");
  return compileSchema(
    { kind: "schema", schema: await loadSchemaFile(command.source) },
    command.options,
  );
}

/** Runs the ViewQL command line and returns the intended process exit code. */
export async function runCli(
  args: readonly string[],
  io: CliIO = process,
): Promise<number> {
  if (args.length === 0 || args[0] === "-h" || args[0] === "--help") {
    io.stdout.write(HELP);
    return 0;
  }
  if (args[0] !== "schema") {
    io.stderr.write(`Unknown command: ${args[0]}\n\n${HELP}`);
    return 1;
  }
  if (args[1] === "-h" || args[1] === "--help") {
    io.stdout.write(HELP);
    return 0;
  }
  try {
    const command = parseSchemaCommand(args.slice(1));
    const generated = await compile(command);
    if (command.output === undefined) io.stdout.write(generated);
    else await writeFile(command.output, generated, "utf8");
    return 0;
  } catch (error) {
    io.stderr.write(
      `viewql: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  }
}
