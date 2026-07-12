## Instructions

create a function that exposes XAUTOCLAIM from the redisClient package, use that to pick up jobs that have been in the queue for IDLE_THRESHOLD_MS. Pick up those jobs but first check "const deliveryCount = pendingInfo?.[0]?.[3] ?? 1" from xpending, if the deliveryCount is more than MAX_RETRIES then update document status to: FAILED and send xAck to remove it from PEL, if not, then process the document and xAck.

run this function that claims stale processes in a setInterval alongside the main XREADGROUP, so any live worker can go pick up leftover jobs.