import test, { Test } from "tape";
import { createReadStream } from "fs";
import { CloudBlobClient } from "../src/CloudBlobClient";
import { rootFilepath } from "./config";
import { RepresentationMetadata } from "@solid/community-server";

const client = new CloudBlobClient(rootFilepath);
let plainTextContent = createReadStream("./tests/fixtures/plain.txt");
let plainTextFilename = "cloud-blob-client/plain.txt";
let fixtures = [
  { name: "cloud-blob-client/.__container", path: "./tests/fixtures/.__container" },
  { name: "cloud-blob-client/plain.css", path: "./tests/fixtures/plain.css" },
  { name: "cloud-blob-client/plain.html", path: "./tests/fixtures/plain.html" },
  { name: "cloud-blob-client/plain.js", path: "./tests/fixtures/plain.js" },
  { name: "cloud-blob-client/plain.json", path: "./tests/fixtures/plain.json" },
  { name: "cloud-blob-client/plain.txt", path: "./tests/fixtures/plain.txt" }
];

test('CloudBlobClient: Write container to storage.', async (t: Test) => {
  let metadata = new RepresentationMetadata();
  let written = await client.writeContainer("cloud-blob-client/", metadata);
  t.ok(written, "Wrote container cloud-blob-client/.");
  t.end();
});

test('CloudBlobClient: Write file to storage.', async (t: Test) => {
  let written = await client.write(plainTextFilename, plainTextContent);
  t.ok(written, "Wrote plain.txt.");
  t.end();
});

test('CloudBlobClient: Read file from storage.', async (t: Test) => {
  let read = await client.read(plainTextFilename);
  t.ok(read, 'Read is not null.');
  read.destroy(); // so we don't leak a handle of this stream
  t.end();
});

test('CloudBlobClient: List files.', async (t: Test) => {
  t.plan(fixtures.length * 2);

  for (const file of fixtures) {
    let data = createReadStream(file.path);
    let written = await client.write(file.name, data);
    t.ok(written, `Wrote ${file.name}`);
  }

  let files = await client.list("cloud-blob-client/");
  // this offsets the fact fixtures does not include .meta file
  t.ok(files.length, "files exist.");
  for (const file of files) {
    t.ok(file, `Listed: ${file}.`);
  }
});

test('CloudBlobClient: Delete file from storage.', async (t: Test) => {
  let deleted = await client.delete(plainTextFilename);
  t.ok(deleted, "Deleted plain.txt");
  t.end();
});
