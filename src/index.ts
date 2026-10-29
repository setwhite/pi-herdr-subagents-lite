import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "./config/index.ts";
import { createExtension } from "./extension/index.ts";
import { createHerdrHost } from "./herdr/index.ts";
import { agentDir, loadProfiles } from "./profile/index.ts";
import { readExitReceipt, readLastAssistant, writeExitReceipt } from "./session-file/index.ts";

const extension: ExtensionFactory = createExtension({
  createHost: (config) => createHerdrHost(config.herdrBin),
  readLastAssistant,
  readExitReceipt,
  loadConfig: () => loadConfig(agentDir()),
  loadProfiles,
  writeExitReceipt,
});

export default extension;
