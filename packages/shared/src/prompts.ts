import Handlebars from "handlebars";

const MAX_CANDIDATE_TEXT_CHARS = 2000;
const DEFAULT_RANKING_RETURN_COUNT = 20;

export interface PromptCandidate {
  id: number;
  title: string;
  previewParagraph: string;
}

export interface RenderedPrompt {
  system: string;
  user: string;
}

const handlebars = Handlebars.create();

function compilePrompt<T>(template: string) {
  return handlebars.compile<T>(template.trim(), { noEscape: true });
}

function truncateToLimit(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars - 3) + "...";
}

const candidateTemplate = compilePrompt<{ candidate: PromptCandidate }>(`
ID: {{candidate.id}}
Title: {{candidate.title}}
First paragraph: {{candidate.previewParagraph}}
`);

const candidateListTemplate = compilePrompt<{ entries: string[] }>(`
{{#each entries}}
{{this}}{{#unless @last}}

---

{{/unless}}
{{/each}}
`);

function renderCandidateList(candidates: PromptCandidate[]): string {
  const entries = candidates.map((candidate) => {
    const previewParagraph = candidate.previewParagraph || "No first paragraph was available.";
    return truncateToLimit(candidateTemplate({ candidate: { ...candidate, previewParagraph } }).trim(), MAX_CANDIDATE_TEXT_CHARS);
  });

  return candidateListTemplate({ entries }).trim();
}

const scoreDocumentsSystemTemplate = compilePrompt(`
You score AI and software news stories against one user's stated interests.
Use only each story title and first paragraph.
Score EVERY document in the candidate list on a 1-100 relevance scale.
Prefer direct matches to the user's domains, workflows, pain points, tools, companies, and product priorities.
Do not invent document IDs and do not include any IDs that are not present in the input.
For each document, write a 'whyRelevant' explanation in 1 or 2 sentences.
Keep every explanation grounded in the supplied text only, and connect it back to the user's saved interests.
You MUST respond with ONLY a valid JSON object, no other text before or after.
The JSON must have this exact shape: {"scores": [{"documentId": <int>, "score": <int 1-100>, "whyRelevant": "..."}]}
`);

const scoreDocumentsUserTemplate = compilePrompt<{ interestStatement: string; candidateList: string }>(`
User interest profile:
{{interestStatement}}

Documents to score:
{{candidateList}}
`);

const rankDocumentsSystemTemplate = compilePrompt<{ returnCount: number }>(`
You rank AI and software news stories against one user's stated interests.
Use only each story title and first paragraph.
Return the {{returnCount}} most relevant stories from the candidate list, ordered from most relevant to less relevant.
The UI will apply source-family caps afterward, so provide enough strong candidates to still surface a top 10.
Prefer direct matches to the user's domains, workflows, pain points, tools, companies, and product priorities.
Do not invent document IDs and do not include any IDs that are not present in the input.
For each selected story, write a 'whyRelevant' explanation in 2 or 3 sentences.
Keep every explanation grounded in the supplied text only, and connect it back to the user's saved interests.
You MUST respond with ONLY a valid JSON object, no other text before or after.
The JSON must have this exact shape: {"shortlistSummary": "...", "selectedDocuments": [{"documentId": <int>, "score": <int 1-100>, "whyRelevant": "..."}]}
`);

const rankDocumentsUserTemplate = compilePrompt<{
  interestStatement: string;
  candidateList: string;
}>(`
User interest profile:
{{interestStatement}}

Candidates:
{{candidateList}}
`);

export function renderScoreDocumentsPrompt({
  interestStatement,
  candidates,
}: {
  interestStatement: string;
  candidates: PromptCandidate[];
}): RenderedPrompt {
  return {
    system: scoreDocumentsSystemTemplate({}).trim(),
    user: scoreDocumentsUserTemplate({
      interestStatement,
      candidateList: renderCandidateList(candidates),
    }).trim(),
  };
}

export function renderRankDocumentsPrompt({
  interestStatement,
  candidates,
  returnCount = DEFAULT_RANKING_RETURN_COUNT,
}: {
  interestStatement: string;
  candidates: PromptCandidate[];
  returnCount?: number;
}): RenderedPrompt {
  return {
    system: rankDocumentsSystemTemplate({ returnCount }).trim(),
    user: rankDocumentsUserTemplate({
      interestStatement,
      candidateList: renderCandidateList(candidates),
    }).trim(),
  };
}
