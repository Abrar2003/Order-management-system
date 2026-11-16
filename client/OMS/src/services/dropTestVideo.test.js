import assert from "node:assert/strict";
import test from "node:test";
import axios from "axios";
import api from "../api/axios.js";
import { uploadDropTestVideo } from "./dropTestVideo.service.js";

test("Drop Test video skips saved parts and retries just the interrupted Wasabi PUT", async (t) => {
  const appRequests = [];
  const partRequests = [];
  const savedApiAdapter = api.defaults.adapter;
  const savedStorageAdapter = axios.defaults.adapter;
  t.after(() => {
    api.defaults.adapter = savedApiAdapter;
    axios.defaults.adapter = savedStorageAdapter;
  });
  api.defaults.adapter = async (request) => {
    appRequests.push(request);
    const data = request.url.endsWith("/video-uploads")
      ? { upload_id: "local", part_size: 5, uploaded_parts: [1] }
      : { upload_url: "https://storage.example.test/video?part=2" };
    return { data: { data }, status: 200 };
  };
  axios.defaults.adapter = async (request) => {
    partRequests.push(request);
    if (partRequests.length === 1) throw new Error("network disconnected");
    return { status: 200, data: "" };
  };
  const progress = [];
  const uploadId = await uploadDropTestVideo({
    endpoint: "/tests/qc/qc-id/test-id",
    scope: { request_key: "history:request-id", test_version: "1" },
    file: new File(["skip-sent"], "test.mp4"),
    onProgress: (message) => progress.push(message),
  });
  assert.equal(uploadId, "local");
  assert.match(JSON.parse(appRequests[0].data).fingerprint, /^[a-f0-9]{64}$/);
  assert.ok(appRequests.slice(1).every((request) => request.url.endsWith("/parts/2")));
  assert.ok(appRequests.every((request) => typeof request.data === "string"));
  assert.deepEqual(await Promise.all(partRequests.map((request) => request.data.text())), ["sent", "sent"]);
  assert.ok(partRequests.every((request) => request.url.startsWith("https://storage.example.test/")));
  assert.ok(progress.some((message) => message.includes("Retrying")));
  assert.equal(progress.at(-1), "100% uploaded");
});
