let rerankerPromise;

async function getReranker(modelName) {
  if (!rerankerPromise) {
    rerankerPromise = (async () => {
      const { AutoModelForSequenceClassification, AutoTokenizer } =
        await import("@huggingface/transformers");
      const [tokenizer, model] = await Promise.all([
        AutoTokenizer.from_pretrained(modelName),
        AutoModelForSequenceClassification.from_pretrained(modelName),
      ]);
      return { tokenizer, model };
    })().catch((error) => {
      rerankerPromise = undefined;
      throw error;
    });
  }
  return rerankerPromise;
}

function getRelevanceScore(logits) {
  const values = logits.tolist();
  if (!Array.isArray(values)) {
    throw new Error("The reranker returned an invalid score tensor.");
  }
  const scores = values.map((value) => {
    const row = Array.isArray(value) ? value : [value];
    if (!row.every((score) => typeof score === "number" && Number.isFinite(score))) {
      throw new Error("The reranker returned a non-numeric relevance score.");
    }
    return row.length === 1 ? row[0] : row[row.length - 1];
  });
  return scores;
}

export async function rerankDocuments(query, documents) {
  const modelName = process.env.RERANKER_MODEL;
  if (!modelName || documents.length < 2) {
    return documents;
  }

  const candidates = Number.parseInt(
    process.env.RERANKER_CANDIDATES || "24",
    10,
  );
  const candidateCount =
    Number.isInteger(candidates) && candidates > 0
      ? Math.min(candidates, documents.length)
      : 24;
  const candidatesToRerank = documents.slice(0, candidateCount);
  const { tokenizer, model } = await getReranker(modelName);
  const modelInputs = tokenizer(query, {
    text_pair: candidatesToRerank.map((document) => document.pageContent),
    padding: true,
    truncation: true,
    max_length: 512,
  });
  const { logits } = await model(modelInputs);
  const scores = getRelevanceScore(logits);

  if (scores.length !== candidatesToRerank.length) {
    throw new Error("The reranker returned an unexpected number of scores.");
  }

  return candidatesToRerank
    .map((document, index) => ({ document, score: scores[index], index }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(({ document }) => document);
}
