import { LinkIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type ShareDialogProps = {
  meetingId: string;
};

export function ShareDialog({ meetingId }: ShareDialogProps) {
  return (
    <Card aria-labelledby="share-dialog-title">
      <CardHeader>
        <CardTitle id="share-dialog-title">Sharing</CardTitle>
        <CardDescription>
          Links expire after 14 days and can be revoked from this meeting.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button type="button">
          <LinkIcon data-icon="inline-start" />
          Create share link
        </Button>
      </CardContent>
      <CardFooter>
        <p className="min-w-0 break-all text-xs text-muted-foreground">
          Meeting ID: {meetingId}
        </p>
      </CardFooter>
    </Card>
  );
}
