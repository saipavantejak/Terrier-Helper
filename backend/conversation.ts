/** Non-factual conversational turns only. Full-string matching prevents a greeting
 * from swallowing a policy question or bypassing document grounding. */
export function conversationalReply(question: string): string | undefined {
  const text = question
    .normalize("NFKC")
    .toLowerCase()
    .trim()
    .replace(/[’]/g, "'")
    .replace(/[!?.,]+$/g, "")
    .replace(/\s+/g, " ");
  if (
    /^(hi|hey|hello|hiya|good morning|good afternoon|good evening)( there| terrierhelper| terrier helper)?$/.test(
      text,
    )
  )
    return "Hey! What would you like to figure out? Ask me a question about the college documents, and I’ll help you find the answer with sources you can check.";
  if (
    /^(thanks|thank you|thanks a lot|thank you so much|thanks for your help|thank you for your help|cheers)$/.test(
      text,
    )
  )
    return "You’re welcome! If anything needs a closer look, just ask.";
  if (
    /^(help|help me|what can you do|how can you help( me)?|what can i ask( you)?|who are you)$/.test(
      text,
    )
  )
    return "I’m TerrierHelper. I can help you understand the published documents, compare what they say, or explain a passage in simpler language. What are you trying to find out? I’ll cite supporting passages and tell you when the documents don’t have enough information.";
  if (/^(how are you|how are you doing|how's it going)$/.test(text))
    return "I’m here and ready to help. What would you like to understand from the documents?";
}
export function isFollowUp(question: string): boolean {
  return (
    /\b(it|that|those|they|this|also|what about)\b/i.test(question) ||
    /^(and\b|why\b|explain\b|tell me more\b|can you (explain|simplify|elaborate)\b|in (simple|simpler|plain)\b)/i.test(
      question.trim(),
    )
  );
}
export function retrievalQuestion(question: string, previous?: string): string {
  return previous && !conversationalReply(previous) && isFollowUp(question)
    ? `Earlier user context (not evidence): ${previous}\nCurrent question: ${question}`
    : question;
}
