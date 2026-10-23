import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { createExtension } from "./extension/index.ts";
import { createHerdrHost } from "./herdr/index.ts";
import { readLastAssistant } from "./session/index.ts";

const extension: ExtensionFactory = createExtension({ host: createHerdrHost(), readLastAssistant });

export default extension;
