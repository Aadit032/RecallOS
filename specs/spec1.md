## Instructions for building the chat router

1. create the table for chats in ./packages/db/prisma/schema.prisma. The user and chat will have a one-to-many relationship.
2. when the user starts a new session (by default should land in a new session), on the first message, create the session then inside that session send that chat message to the backend chatRouter