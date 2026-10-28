# tool

模型的唯一入口：两个 action、一份参数 schema、一份文案。异步结果与提问的信封（`subagent_result`、`subagent_question`，customType、display、triggerTurn、头部格式）在这里；一批结果合成一条消息，块间用空行分隔；超限结果带 `Full result:` 路径，写失败带警告。结果正文与截断属于 [run](run.md)。

`prompts` 覆盖与 `{{profiles}}` / `{{toolName}}` 展开在 `text.ts`；隐藏 `disable-model-invocation` 的 profile。
