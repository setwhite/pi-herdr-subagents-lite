import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "./config/index.ts";
import { createExtension } from "./extension/index.ts";
import { createHerdrHost } from "./herdr/index.ts";
import { agentDir, loadProfiles } from "./profile/index.ts";
import { readLastAssistant } from "./session-file/index.ts";

const extension: ExtensionFactory = createExtension({
  host: createHerdrHost(),
  readLastAssistant,
  loadConfig: () => loadConfig(agentDir()),
  loadProfiles,
});

export default extension;
