import assert from "node:assert/strict";
import test from "node:test";

import { queryRequiresWebSearch } from "./chatGraph.service.js";

test("routes time-sensitive and explicitly online queries to web search", () => {
  const queries = [
    "What is the temperature in Pune?",
    "What's the weather in Pune?",
    "Who won the latest election?",
    "What are the current exchange rates?",
    "What is the price of Bitcoin?",
    "What is the live score?",
    "Search the web for the official React documentation",
  ];

  for (const query of queries) {
    assert.equal(queryRequiresWebSearch(query), true, query);
  }
});

test("leaves stable general-knowledge queries to the chat model", () => {
  const queries = [
    "Explain how photosynthesis works",
    "Write a JavaScript debounce function",
    "What is 12 times 14?",
  ];

  for (const query of queries) {
    assert.equal(queryRequiresWebSearch(query), false, query);
  }
});
