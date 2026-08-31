import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { callLiveMeasurementsProvider } from "../server/liveMeasurements.mjs";

const servers = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

describe("Node live measurement provider adapter", () => {
  it("sends the upstream multipart field names and normalizes its response", async () => {
    let requestBody = "";
    const server = createServer((request, response) => {
      const chunks = [];
      request.on("data", (chunk) => chunks.push(chunk));
      request.on("end", () => {
        requestBody = Buffer.concat(chunks).toString("utf8");
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ measurements: { chest_circumference: 100.1, waist: 82.2 } }));
      });
    });
    servers.push(server);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    const result = await callLiveMeasurementsProvider({
      apiUrl: `http://127.0.0.1:${port}/measurements`,
      apiKey: "test-provider-key",
      scan: { height_value: 170, height_unit: "cm" },
      assets: [
        { asset_type: "front", storage_path: "front.jpg", metadata: { content_type: "image/jpeg" } },
        { asset_type: "side", storage_path: "side.png", metadata: { content_type: "image/png" } },
        { asset_type: "back", storage_path: "back.jpg", metadata: { content_type: "image/jpeg" } },
      ],
      readAsset: async (asset) => Buffer.from(asset.asset_type),
      timeoutMs: 5_000,
    });

    expect(result.measurements.map(({ key }) => key)).toEqual(["chest_circumference", "waist"]);
    expect(requestBody).toContain('name="front"');
    expect(requestBody).toContain('name="left_side"');
    expect(requestBody).toContain('name="height_cm"');
    expect(requestBody).toContain("170.00");
  });
});
