/**
 * Handoff functionality for session continuation.
 *
 * Provides tools and commands for creating handoff prompts that allow
 * work to continue seamlessly in new sessions with preloaded context.
 */

export {
  createHandoffCommandManager,
  type HandoffCommandManager,
} from './command';
export {
  buildSyntheticFileParts,
  FILE_REGEX,
  parseFileReferences,
} from './files';
export { createHandoffState, type HandoffState } from './state';
export {
  createHandoffSessionTool,
  createReadSessionTool,
  type OpencodeClient,
} from './tools';
export {
  DEFAULT_READ_LIMIT,
  formatFileContent,
  isBinaryFile,
  MAX_BYTES,
  MAX_LINE_LENGTH,
} from './vendor';
