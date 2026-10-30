import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth/server";

export const runtime = "nodejs";
export const { GET, POST, PUT, DELETE, PATCH } = toNextJsHandler(auth);
