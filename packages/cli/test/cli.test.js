import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildSchema, graphql } from "graphql";
import { runCli } from "../dist/cli.js";

const SDL = "scalar DateTime\ntype Query { now: DateTime! }";

function capture() {
  let stdout = "";
  let stderr = "";
  return {
    io: {
      stdout: {
        write: (value) => {
          stdout += value;
        },
      },
      stderr: {
        write: (value) => {
          stderr += value;
        },
      },
    },
    output: () => ({ stdout, stderr }),
  };
}

test("compiles a local SDL file to an output file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "viewql-cli-"));
  const input = join(directory, "schema.graphql");
  const output = join(directory, "schema.ts");
  await writeFile(input, SDL);
  const stream = capture();

  assert.equal(
    await runCli(
      ["schema", input, "--scalar", "DateTime=Date", "-o", output],
      stream.io,
    ),
    0,
  );
  assert.match(await readFile(output, "utf8"), /export type DateTime = Date;/);
  assert.deepEqual(stream.output(), { stdout: "", stderr: "" });
});

test("introspects a GraphQL endpoint with custom headers", async (context) => {
  const schema = buildSchema(SDL);
  const server = createServer(async (request, response) => {
    assert.equal(request.headers.authorization, "Bearer test-token");
    let body = "";
    for await (const chunk of request) body += chunk;
    const result = await graphql({ schema, source: JSON.parse(body).query });
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(result));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const stream = capture();

  assert.equal(
    await runCli(
      [
        "schema",
        `http://127.0.0.1:${address.port}/graphql`,
        "-H",
        "authorization:Bearer test-token",
      ],
      stream.io,
    ),
    0,
  );
  assert.match(stream.output().stdout, /export interface Query/);
  assert.equal(stream.output().stderr, "");
});

test("prints actionable usage errors without throwing", async () => {
  const stream = capture();
  assert.equal(
    await runCli(
      ["schema", "schema.graphql", "--header", "invalid"],
      stream.io,
    ),
    1,
  );
  assert.match(stream.output().stderr, /--header must be in name:value form/);
});
