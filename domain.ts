/** Public, non-secret domain presentation. The grounding pipeline is shared by all profiles. */
export interface DomainProfile {
  id: "college" | "medical" | "tech" | "general";
  assistantName: string;
  audience: string;
  hub: string;
  companion: string;
  headline: string;
  description: string;
  placeholder: string;
  suggestions: string[];
  notice: string;
}
export const domainProfiles: Record<DomainProfile["id"], DomainProfile> = {
  college: {
    id: "college",
    assistantName: "TerrierHelper",
    audience: "students",
    hub: "STUDENT KNOWLEDGE HUB",
    companion: "YOUR CAMPUS COMPANION",
    headline: "Your college. Your questions. A clearer path.",
    description:
      "Find guidance in college documents, with a source you can check for every answer.",
    placeholder: "Ask about deadlines, policies, or student services…",
    suggestions: [
      "What requirements are listed?",
      "What deadlines should I know about?",
      "What exceptions does this policy include?",
    ],
    notice:
      "Independent project for the college community. Not an official college service.",
  },
  medical: {
    id: "medical",
    assistantName: "Document Companion",
    audience: "readers",
    hub: "MEDICAL DOCUMENT LIBRARY",
    companion: "YOUR DOCUMENT COMPANION",
    headline: "Understand the source. Check the evidence.",
    description:
      "Explore published medical reference documents with traceable source passages.",
    placeholder: "Ask what a reference document says…",
    suggestions: [
      "What is the scope of this guideline?",
      "What limitations does the document describe?",
      "Which precautions are listed?",
    ],
    notice:
      "For reference education, not diagnosis or personalized treatment. Do not submit patient information. For a medical emergency, contact local emergency services.",
  },
  tech: {
    id: "tech",
    assistantName: "Document Companion",
    audience: "users",
    hub: "TECHNICAL KNOWLEDGE HUB",
    companion: "YOUR TECHNICAL COMPANION",
    headline: "From documentation to understanding.",
    description:
      "Find documented requirements, configuration steps, and limitations with sources you can verify.",
    placeholder: "Ask about setup, requirements, or troubleshooting…",
    suggestions: [
      "What prerequisites are listed?",
      "What configuration steps are documented?",
      "What limitations should I know about?",
    ],
    notice:
      "Answers describe the published documentation. Check source versions before making changes.",
  },
  general: {
    id: "general",
    assistantName: "Document Companion",
    audience: "readers",
    hub: "DOCUMENT KNOWLEDGE HUB",
    companion: "YOUR DOCUMENT COMPANION",
    headline: "Your documents. Clearer answers.",
    description:
      "Understand your published documents, with evidence you can check for every answer.",
    placeholder: "Ask a question about the published documents…",
    suggestions: [
      "What does this document cover?",
      "What requirements are listed?",
      "What exceptions or limitations are described?",
    ],
    notice:
      "An independent document assistant. Check the original source before acting on important information.",
  },
};
export function domainProfile(
  id: string = "college",
  name?: string,
): DomainProfile {
  if (!Object.prototype.hasOwnProperty.call(domainProfiles, id))
    throw new Error("Unknown ASSISTANT_DOMAIN");
  return {
    ...domainProfiles[id as DomainProfile["id"]],
    ...(name ? { assistantName: name.slice(0, 80) } : {}),
  };
}
