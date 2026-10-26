import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "./config/index.ts";
import { createExtension } from "./extension/index.ts";
import { createHerdrHost } from "./herdr/index.ts";
import { readLastAssistant } from "./session/index.ts";

const extension: ExtensionFactory = createExtension({ host: createHerdrHost(), readLastAssistant, loadConfig });

export default extension;
