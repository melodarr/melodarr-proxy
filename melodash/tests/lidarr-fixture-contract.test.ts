import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  QUEUE_DETAILS_CONTRACT,
  RELEASE_SEARCH_CONTRACT,
  type ContractFieldDef,
} from "../lib/contracts.ts";
import {
  mockQueueDetails,
  mockReleaseResults,
} from "../lib/lidarr-mock-fixtures.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");

function readGoldenFixture<T>(name: string): T {
  return JSON.parse(
    readFileSync(resolve(repoRoot, "src/fixtures/lidarr", name), "utf8"),
  ) as T;
}

function assertContractKeys(
  resource: Record<string, unknown>,
  contract: ContractFieldDef[],
  label: string,
) {
  const keys = Object.keys(resource).sort();
  const allowedKeys = contract.map((field) => field.key).sort();
  const sourceKeys = contract
    .filter((field) => field.kind === "source field")
    .map((field) => field.key)
    .sort();

  const unexpectedKeys = keys.filter((key) => !allowedKeys.includes(key));
  const missingSourceKeys = sourceKeys.filter((key) => !keys.includes(key));

  assert.deepEqual(unexpectedKeys, [], `${label} has unexpected keys`);
  assert.deepEqual(missingSourceKeys, [], `${label} is missing source fields`);
}

test("release mock fixture matches backend golden fixture exactly", () => {
  const golden = readGoldenFixture<typeof mockReleaseResults>("release-mixed.golden.json");

  assert.deepEqual(mockReleaseResults, golden);
});

test("release mock fixture keys match source-derived contract", () => {
  mockReleaseResults.forEach((resource, index) => {
    assertContractKeys(resource, RELEASE_SEARCH_CONTRACT, `ReleaseResource[${index}]`);
  });
});

test("queue mock fixture matches backend golden fixture exactly", () => {
  const golden = readGoldenFixture<typeof mockQueueDetails>("queue-details-active.golden.json");

  assert.deepEqual(mockQueueDetails, golden);
});

test("queue mock fixture keys match source-derived contract", () => {
  mockQueueDetails.forEach((resource, index) => {
    assertContractKeys(resource, QUEUE_DETAILS_CONTRACT, `QueueResource[${index}]`);
  });
});

test("queue mock fixture follows Lidarr queue/details defaults", () => {
  assert.equal(mockQueueDetails[0]?.artist, null);
  assert.equal(typeof mockQueueDetails[0]?.album, "object");
});
