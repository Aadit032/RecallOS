## Rubric for scoring the confidence and importance for each memory:
```text
Extract durable memories from this conversation.

For each memory output:

{
  "content": "...",
  "importance": 1-10
}

Importance rubric:

10 = Core long-term preference, identity, or ongoing project.
7-9 = Frequently useful preference or active long-term goal.
4-6 = Useful background information.
1-3 = Minor fact that may become irrelevant.

Confidence rubric:

1.0 = User explicitly stated this.
0.8 = Strongly implied.
0.5 = Reasonable inference.
0.2 = Weak inference.

Importance = LLM score
           + retrieval bonus
           + reconfirmation bonus
           - age decay
```

## Memory architecture

### Layer 1: Session Metadata

* Stores information relevant only to the current session.
* Examples:

  * Device
  * Location
  * Timezone
  * Language
  * Subscription tier
  * Usage patterns
* Lifetime: Current session only.
* Retrieval:

  * No embeddings or vector search.
  * Injected once into the system prompt at the start of the session.
* Updated only if session metadata changes.

---

### Layer 2: Explicit Facts

* Stores long-term, persistent user information.
* Examples:

  * "User prefers Python over JavaScript."
  * "User is building RecallOS."
  * "User prefers concise explanations."
* Represents distilled facts, not conversations.
* Storage:

  * Database (e.g., Postgres).
  * Optionally store embeddings for semantic retrieval.
* Update pipeline:

  * Run a fact extraction step after a conversation (or periodically).
  * Add new facts.
  * Update changed facts.
  * Remove outdated facts.
* Retrieval:

  * Semantic search using the current query.
  * Return only the most relevant facts.

---

### Layer 3: Conversation Summaries

* Stores compressed summaries of previous conversations.
* Each summary represents approximately 20–50 conversation turns.
* Summaries include only:

  * User goals
  * User decisions
  * User questions
  * User problems
* Excludes assistant responses.
* Maintain a rolling history (e.g., latest 15 summaries).
* Storage:

  * Summary text
  * Embedding
  * Timestamp
* Retrieval:

  * Embed the current query.
  * Perform vector search over summaries.
  * Retrieve only the top-k relevant summaries.
* When the current session becomes large:

  * Summarize older messages.
  * Store the summary.
  * Remove those messages from the active context.

---

### Layer 4: Current Session

* Contains the active conversation in its original form.
* Implemented as a sliding window of recent messages.
* No summarization.
* No embeddings.
* Always included in the prompt.
* Older messages are periodically summarized and moved into Layer 3.

---

## Retrieval Flow

1. User sends a new message.
2. Embed the user query.
3. Retrieve relevant explicit facts.
4. Retrieve relevant conversation summaries.
5. Fetch session metadata.
6. Include the current session messages.
7. Assemble the final prompt.
8. Send the prompt to the LLM.

---

## Memory Update Flow

After a conversation (or every 20–50 messages):

1. Pass the conversation to a fact extraction model.
2. Update explicit facts.
3. Pass the conversation to a summarization model.
4. Store the generated summary.
5. Keep only the latest fixed number of summaries (e.g., 15).
