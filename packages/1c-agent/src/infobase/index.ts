// Публичный интерфейс модуля информационной базы: сборка EDT-проекта, проверка и запуск клиента.

export { buildInfobase, checkConfiguration, formatSteps, launchClient, updateDatabase } from "./build-service.ts";
export * from "./commands.ts";
export { moduleSourcePath, parsePlatformOutput } from "./output-parser.ts";
export { locateEdtCli, locatePlatformTools } from "./platform-locator.ts";
export { connectionString, resolveInfobase } from "./project-config.ts";
export { isReadOnlyIbCall, registerInfobaseTools } from "./tools.ts";
export type * from "./types.ts";
