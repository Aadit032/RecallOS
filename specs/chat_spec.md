## Instructions for building the chat router

1. create the table for chats in ./packages/db/prisma/schema.prisma. The user and chat will have a one-to-many relationship.

2. By default when the user lands on the chat page it should create a new session on the first message.

3. the query sent by the user has to first be converted to a vector embeddings (@./packages/embed/index.ts has the code for embedddings) and apply cosine similarity on vector search + splade ranking. Each should return the top 50 most similar chunks from qdrant.

4. top 50 chunks from both methods should be retrieved using "rrf" through qdrantdb which will give the combined top 50 chunks from the total of 100 chunks that it received (50 dense vectors + 50 sparse vectors) 

5. then create a cross encoder function in @./packages/embed/index.ts (try diff options like maybe huggingface inference, try for smth free).

6. top 50 chunks will be sent to cross encoder that will compare query and top 50 chunks and return the top 5 chunks.

7. top 5 chunks will be sent in the LLM call as the context for query. (use @./packages/openrouter/index.ts openrouterClient for any LLM calls).