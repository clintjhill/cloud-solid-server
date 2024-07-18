import test, { Test } from "tape-promise/tape";
import { getDefaultVariables, getTestConfigPath, instantiateFromConfig, internalRootFilepath, rootFilepath } from "./config";
import { App, NotFoundHttpError } from "@solid/community-server";
import { CloudBlobClient } from "../src/CloudBlobClient";

const port = 6001;
const baseUrl = `http://localhost:${port}/`;
let app: App;
let client = new CloudBlobClient(rootFilepath);

test("Integration Tests", async (t: Test) => {

  const variables = {
    ...getDefaultVariables(port, baseUrl),
    'urn:solid-server:default:variable:rootFilePath': rootFilepath,
  };

  // Create and start the server
  const instances = await instantiateFromConfig(
    'urn:solid-server:test:Instances',
    [
      getTestConfigPath('server-file.json'),
    ],
    variables,
  ) as Record<string, any>;
  ({ app } = instances);

  await app.start();
  t.pass("Test Server Started.");
});

test("Integration: can put a document for which the URI path contains URL-encoded separator characters.", async (t: Test) => {
  const url = `${baseUrl}c1/c2/t1%2f`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'content-type': 'text/plain' },
    body: 'abc'
  });
  t.equal(res.status, 201, "Status code.");
  t.equal(res.headers.get('location'), `${baseUrl}c1/c2/t1%2F`, "Location.");

  const check1 = await fetch(`${baseUrl}c1/c2/t1/}`, {
    method: 'GET',
    headers: { accept: 'text/plain' }
  });
  t.equal(check1.status, 404, "Check 1.");

  const check2 = await fetch(url, {
    method: 'GET',
    headers: { accept: 'text/plain' }
  });
  const headers = check2.headers.get('link')!.split(',').map((item: string) => item.trim());
  t.notOk(headers.includes('<http://www.w3.org/ns/ldp#Container>; rel="type"'), "Not Container.");
  let exists = async () => {
    let data = await client.read(`${internalRootFilepath}c1/c2/t1%2F$.txt`);
    data.destroy();
  };
  await t.doesNotReject(exists, NotFoundHttpError, "Exists.");
});

test("Stop Integration Tests.", async (t: Test) => {
  await app.stop();
  t.pass("Test Server Stopped.");
});
