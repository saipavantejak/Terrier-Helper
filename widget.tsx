import "./styles/terrier.css";
export { default as TerrierHelper } from "./App";
export type { TerrierHelperProps } from "./App";
export type { Answer, Citation, KnowledgeDocument } from "./types";
export { api, ask, uploadDocument } from "./geminiService";

export { domainProfiles, domainProfile } from "./domain";
export type { DomainProfile } from "./domain";
