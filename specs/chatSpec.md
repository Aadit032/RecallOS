## Instructions for building the chat router

1. create the table for chats in ./packages/db/prisma/schema.prisma. The user and chat will have a one-to-many relationship.
2. when the user starts a new session (by default should land in a new session), on the first message, create the session and start the chat.
3. the query sent by the user has to first be converted to a vector embeddings (./packages/embed/index.ts has the code for embedddings) and apply cosine similarity on vector search + splade ranking. Each should return the top 20 most similar chunks from the qdrant db.
4. These top 20 chunks will then be sent to a cross encoder that will compare the query and the top 20 chunks and will return the top 5 chunks.
5. The top 5 chunks are then sent in the LLM call as the context for the query. (use the openrouter package for any LLM calls).