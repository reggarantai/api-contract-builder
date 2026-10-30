import { notFound } from "@tanstack/react-router";
import { ApiError } from "./api";

/** For route loaders: turns an API 404 into the router's not-found page. */
export async function ensureFound<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      throw notFound();
    }
    throw error;
  }
}
