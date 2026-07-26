import axios from "axios"
import { API_BASE_AUTH } from "../api"

export async function signin(username: string, password: string) {
  const { data } = await axios.post(`${API_BASE_AUTH}/signin`, {
    username,
    password,
  })
  return data as { token: string; message?: string }
}

export async function signup(username: string, password: string) {
  const { data } = await axios.post(`${API_BASE_AUTH}/signup`, {
    username,
    password,
  })
  return data as { message?: string }
}
