# Third-party JavaScript notices

The server, fixed emulator UI and loopback browser host contain the dependencies below. Exact versions, retained inputs and bundle/license hashes are recorded in `licenses/bundled-dependencies.json`; package integrity is locked in `pnpm-lock.yaml`. Preserve every listed license. Native dependency and app provenance is in [runtime notices](runtime/THIRD_PARTY_NOTICES.md).

| Package | Version | License | Notice |
|---|---|---|---|
| @cfworker/json-schema | 4.1.1 | MIT | [LICENSE.md](licenses/npm/@cfworker/json-schema/LICENSE.md) |
| @modelcontextprotocol/ext-apps | 1.7.5 | MIT | [LICENSE](licenses/npm/@modelcontextprotocol/ext-apps/LICENSE) |
| @modelcontextprotocol/sdk | 1.29.0 | MIT | [LICENSE](licenses/npm/@modelcontextprotocol/sdk/LICENSE) |
| @openai/mcp-extensions | 0.1.0 | Apache-2.0 | [LICENSE](licenses/npm/@openai/mcp-extensions/LICENSE) |
| ajv | 8.17.1 | MIT | [LICENSE](licenses/npm/ajv/LICENSE) |
| ajv-formats | 3.0.1 | MIT | [LICENSE](licenses/npm/ajv-formats/LICENSE) |
| fast-deep-equal | 3.1.3 | MIT | [LICENSE](licenses/npm/fast-deep-equal/LICENSE) |
| fast-uri | 3.0.1 | MIT | [LICENSE](licenses/npm/fast-uri/LICENSE) |
| json-schema-traverse | 1.0.0 | MIT | [LICENSE](licenses/npm/json-schema-traverse/LICENSE) |
| zod | 4.4.3 | MIT | [LICENSE](licenses/npm/zod/LICENSE) |
| zod-to-json-schema | 3.25.1 | ISC | [LICENSE](licenses/npm/zod-to-json-schema/LICENSE) |

The cfworker 4.1.1 package omitted its license text. The preserved MIT text is from its exact upstream revision, linked in the inventory. Build-only tools are not included in runtime bundles.
