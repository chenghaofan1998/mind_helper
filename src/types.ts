// Compatibility export for integrations that imported the old root module.
// Product code uses the source-neutral contracts directly from knowledge/types.
export type {
  Capability,
  KnowledgeErrorCode,
  KnowledgeResult,
  KnowledgeResultKind,
  KnowledgeSource,
  PinnedResult,
  SearchInput,
  SourceDescriptor,
  SourceLocation,
  UsefulFeedback,
  WriteFailure,
  WriteInput,
  WriteReceipt,
  WriteSuccess,
} from "./knowledge/types";
