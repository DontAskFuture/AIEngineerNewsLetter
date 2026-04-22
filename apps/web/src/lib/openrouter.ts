import { loadWebEnv } from "@/lib/env";

const OPENROUTER_RESPONSES_URL = "https://openrouter.ai/api/v1/responses";

export interface InterestRankingCandidate {
  id: number;
  title: string;
  previewParagraph: string;
}

export interface InterestRankingSelection {
  documentId: number;
  score: number;
  whyRelevant: string;
}

export interface InterestRankingResponse {
  shortlistSummary: string;
  selectedDocuments: InterestRankingSelection[];
}

function buildCandidateList(candidates: InterestRankingCandidate[]) {
  return candidates
    .map(
      (candidate) =>
        [
          `ID: ${candidate.id}`,
          `Title: ${candidate.title}`,
          `First paragraph: ${candidate.previewParagraph || "No first paragraph was available."}`,
        ].join("\n"),
    )
    .join("\n\n---\n\n");
}

function extractOutputText(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const payloadRecord = payload as Record<string, unknown>;

  if (typeof payloadRecord.output_text === "string" && payloadRecord.output_text.trim().length > 0) {
    return payloadRecord.output_text.trim();
  }

  const output = payloadRecord.output;

  if (!Array.isArray(output)) {
    return null;
  }

  const textParts: string[] = [];

  for (const item of output) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const itemRecord = item as Record<string, unknown>;
    const content = itemRecord.content;

    if (!Array.isArray(content)) {
      continue;
    }

    for (const contentItem of content) {
      if (!contentItem || typeof contentItem !== "object") {
        continue;
      }

      const contentRecord = contentItem as Record<string, unknown>;

      if (typeof contentRecord.text === "string" && contentRecord.text.trim().length > 0) {
        textParts.push(contentRecord.text.trim());
      }
    }
  }

  return textParts.length > 0 ? textParts.join("\n").trim() : null;
}

function parseRankingResponse(rawText: string) {
  const parsed = JSON.parse(rawText) as unknown;
  const parsedRecord = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;

  const selectedDocuments = Array.isArray(parsedRecord?.selectedDocuments)
    ? parsedRecord.selectedDocuments
        .map((selection) => {
          if (!selection || typeof selection !== "object") {
            return null;
          }

          const record = selection as Record<string, unknown>;
          const documentId = Number(record.documentId);
          const score = Number(record.score);
          const whyRelevant = typeof record.whyRelevant === "string" ? record.whyRelevant.trim() : "";

          if (!Number.isInteger(documentId) || !Number.isFinite(score) || !whyRelevant) {
            return null;
          }

          return {
            documentId,
            score: Math.max(1, Math.min(100, Math.round(score))),
            whyRelevant,
          };
        })
        .filter((selection): selection is InterestRankingSelection => selection !== null)
    : [];

  return {
    shortlistSummary:
      typeof parsedRecord?.shortlistSummary === "string" && parsedRecord.shortlistSummary.trim().length > 0
        ? parsedRecord.shortlistSummary.trim()
        : "Selected the stories that best match the saved interest profile.",
    selectedDocuments,
  } satisfies InterestRankingResponse;
}

export async function rankDocumentsForInterest({
  interestStatement,
  profileSlug,
  windowLabel,
  candidates,
}: {
  interestStatement: string;
  profileSlug: string;
  windowLabel: string;
  candidates: InterestRankingCandidate[];
}) {
  const env = loadWebEnv();

  if (!env.openRouterApiKey) {
    throw new Error("OPENROUTER_API_KEY is not set");
  }

  const response = await fetch(OPENROUTER_RESPONSES_URL, {
    method: "POST",
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${env.openRouterApiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": env.appBaseUrl ?? "http://localhost:3000",
      "X-Title": "AI Builder Intelligence",
    },
    body: JSON.stringify({
      model: env.openRouterModel,
      store: false,
      user: profileSlug,
      temperature: 0.1,
      max_output_tokens: 1800,
      instructions: [
        "You rank AI and software news stories against one user's stated interests.",
        "Use only each story title and first paragraph.",
        "Select the 10 most relevant stories from the candidate list.",
        "Prefer direct matches to the user's domains, workflows, pain points, tools, companies, and product priorities.",
        "Do not invent document IDs and do not include any IDs that are not present in the input.",
        "For each selected story, write a 'why relevant to you' explanation in 2 or 3 sentences.",
        "Keep every explanation grounded in the supplied text only, and connect it back to the user's saved interests.",
      ].join(" "),
      input: [
        `User interest profile:\n${interestStatement}`,
        `Window:\n${windowLabel}`,
        `Candidates:\n${buildCandidateList(candidates)}`,
      ].join("\n\n"),
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: "daily_interest_shortlist",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["shortlistSummary", "selectedDocuments"],
            properties: {
              shortlistSummary: {
                type: "string",
                minLength: 1,
                maxLength: 240,
              },
              selectedDocuments: {
                type: "array",
                minItems: 1,
                maxItems: 10,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["documentId", "score", "whyRelevant"],
                  properties: {
                    documentId: {
                      type: "integer",
                    },
                    score: {
                      type: "integer",
                      minimum: 1,
                      maximum: 100,
                    },
                    whyRelevant: {
                      type: "string",
                      minLength: 80,
                      maxLength: 420,
                    },
                  },
                },
              },
            },
          },
        },
      },
    }),
  });

  const payload = (await response.json()) as Record<string, unknown>;

  if (!response.ok) {
    const errorMessage =
      typeof payload?.error === "object" &&
      payload.error &&
      typeof (payload.error as Record<string, unknown>).message === "string"
        ? ((payload.error as Record<string, unknown>).message as string)
        : `OpenRouter request failed with HTTP ${response.status}`;

    throw new Error(errorMessage);
  }

  const outputText = extractOutputText(payload);

  if (!outputText) {
    throw new Error("OpenRouter returned no output text");
  }

  const ranking = parseRankingResponse(outputText);

  return {
    model: typeof payload.model === "string" ? payload.model : env.openRouterModel,
    responseId: typeof payload.id === "string" ? payload.id : null,
    ranking,
  };
}
