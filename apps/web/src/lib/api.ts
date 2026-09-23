export class ApiError extends Error {
  constructor(
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}
export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
    credentials: "include",
  });
  let result: unknown;
  try {
    result = await response.json();
  } catch {
    throw new ApiError("The service is unavailable. Please try again.");
  }
  if (!response.ok) {
    const error = result as { error?: string; code?: string };
    throw new ApiError(error.error ?? "Request failed", error.code);
  }
  return result as T;
}
export const post = <T>(path: string, body: unknown) =>
  api<T>(path, { method: "POST", body: JSON.stringify(body) });
export function time(seconds: number) {
  return `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0")}`;
}
