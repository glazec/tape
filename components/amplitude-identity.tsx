"use client";

import { useEffect } from "react";

import { identifyAmplitudeUser } from "@/lib/amplitude/client";

export function AmplitudeIdentity({
  teamId,
  userId,
}: {
  teamId?: string;
  userId: string;
}) {
  useEffect(() => {
    identifyAmplitudeUser(userId, teamId);
  }, [teamId, userId]);

  return null;
}
