import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { createExtension } from "./extension/index.ts";
import { createHerdrHost } from "./herdr/index.ts";

const extension: ExtensionFactory = createExtension({ host: createHerdrHost() });

export default extension;
