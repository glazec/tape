import { describe, expect, it } from "vitest";
import { getDatabaseClaimsJson, withDatabaseWorkspace } from "@/db/rls-context";
describe("trusted background speaker context",()=>{
 it("isolates concurrent callers and restores the surrounding claims",async()=>{
  const original=getDatabaseClaimsJson();
  const observed=await Promise.all(["a","b"].map(userId=>withDatabaseWorkspace({teamId:"team",userId},async()=>{
   await new Promise(resolve=>setTimeout(resolve,userId==="a"?3:1));
   return JSON.parse(getDatabaseClaimsJson()!).app_user_id;
  })));
  expect(observed).toEqual(["a","b"]);
  expect(getDatabaseClaimsJson()).toBe(original);
 });
 it("restores the context after a failing operation",async()=>{
  const original=getDatabaseClaimsJson();
  await expect(withDatabaseWorkspace({teamId:"team",userId:"a"},async()=>{throw new Error("failed");})).rejects.toThrow("failed");
  expect(getDatabaseClaimsJson()).toBe(original);
 });
});
