## Instructions



## Memory architecture

LAYER 1: SESSION METADATA Device, location, subscription tier, and usage patterns. Injected once at session start. 

LAYER 2: EXPLICIT FACTS Long-term user preferences stored as text (e.g., "User prefers Python over JavaScript"). 

LAYER 3: CONVERSATION SUMMARIES ~15 lightweight digests of recent chats. Only includes user messages, not assistant replies. 

LAYER 4: CURRENT SESSION The full sliding window of the active conversation.