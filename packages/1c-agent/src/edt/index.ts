// Публичный интерфейс модуля поддержки формата 1C:EDT.

export { editedFilePath, mdoFeedbackText } from "./feedback.ts";
export { describeConfiguration, describeObject } from "./info-service.ts";
export { readMdo } from "./mdo-reader.ts";
export { findKind, KINDS, parseObjectRef } from "./metadata-kinds.ts";
export { findEdtProjects, findProjectForFile, readConfigurationIndex } from "./project-locator.ts";
export { addToObject, createObject } from "./scaffold-service.ts";
export { isReadOnlyMdCall, registerMetadataTools, resolveEdtProject, runMdAction } from "./tools.ts";
export { parseTypeSpec } from "./type-spec.ts";
export type * from "./types.ts";
export { formatDiagnostics as formatMdoDiagnostics, validateProject } from "./validate-project.ts";
