import axios from "axios"
import { API_BASE_CONNECTORS, authHeaders } from "../api"

export type ConnectorType = "github" | "rss" | "url" | "notion"

export type Connector = {
  id: string
  type: ConnectorType
  name: string
  config: Record<string, unknown>
  status: string
  lastSyncedAt: string | null
  lastError: string | null
  syncInterval: number
  createdAt: string
  updatedAt: string
  jobs?: {
    id: string
    status: string
    documentsCreated: number
    error: string | null
    startedAt: string
    finishedAt: string | null
  }[]
}

export async function fetchConnectors(): Promise<Connector[]> {
  const { data } = await axios.get(`${API_BASE_CONNECTORS}/`, {
    headers: authHeaders(),
  })
  return data.connectors ?? []
}

export async function createConnector(body: {
  type: ConnectorType
  name: string
  config: Record<string, unknown>
  syncInterval?: number
}): Promise<Connector> {
  const { data } = await axios.post(`${API_BASE_CONNECTORS}/`, body, {
    headers: authHeaders(),
  })
  return data.connector
}

export async function syncConnector(id: string): Promise<{
  documentsCreated: number
  error?: string
}> {
  const { data } = await axios.post(
    `${API_BASE_CONNECTORS}/${id}/sync`,
    {},
    { headers: authHeaders() }
  )
  return data
}

export async function deleteConnector(id: string): Promise<void> {
  await axios.delete(`${API_BASE_CONNECTORS}/${id}`, {
    headers: authHeaders(),
  })
}

export async function setConnectorStatus(
  id: string,
  status: "ACTIVE" | "PAUSED"
): Promise<Connector> {
  const { data } = await axios.patch(
    `${API_BASE_CONNECTORS}/${id}`,
    { status },
    { headers: authHeaders() }
  )
  return data.connector
}
